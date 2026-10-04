// Serwer pośredniczący dla zdjęcia AI (Vercel / Netlify-style serverless).
// Klucz API zostaje na serwerze, nie trafia do przeglądarki klienta.
//
// Zmienne środowiskowe:
//   GEMINI_API_KEY             (wymagane) Twój klucz z Google AI Studio
//   FREE_LIMIT                 (opcjonalne) ile darmowych zdjęć na adres IP, domyślnie 1
//   UPSTASH_REDIS_REST_URL     (zalecane) trwały licznik; bez niego licznik jest w pamięci
//   UPSTASH_REDIS_REST_TOKEN   i resetuje się przy każdym restarcie funkcji
//
// W index.html ustaw: CONFIG.gemini.proxy = 'https://TWOJA-DOMENA/api/render'

const ALLOWED_ORIGINS = ['https://starecegly.com', 'https://www.starecegly.com', 'https://konfigurator-drzwi-3d.vercel.app'];
const ALLOWED_MODELS = ['gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'];
const LIMIT = parseInt(process.env.FREE_LIMIT || '1', 10);
const TTL = 60 * 60 * 24 * 30; // licznik wygasa po 30 dniach

const memory = new Map();
async function redis(cmd) {
  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN },
    body: JSON.stringify(cmd)
  });
  return (await r.json()).result;
}
const hasRedis = () => process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

async function getCount(id) {
  if (hasRedis()) return parseInt((await redis(['GET', id])) || '0', 10);
  return memory.get(id) || 0;
}
async function addCount(id) {
  if (hasRedis()) { await redis(['INCR', id]); await redis(['EXPIRE', id, TTL]); return; }
  memory.set(id, (memory.get(id) || 0) + 1);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden origin' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Brak GEMINI_API_KEY na serwerze' });

  const { image, mimeType, prompt, model, refImage } = req.body || {};
  if (!image || typeof image !== 'string' || image.length > 6_000_000)
    return res.status(400).json({ error: 'Nieprawidłowy obraz' });
  if (refImage && (typeof refImage !== 'string' || refImage.length > 2_000_000))
    return res.status(400).json({ error: 'Nieprawidłowy obraz referencyjny' });
  const useModel = ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0];

  // limit darmowych zdjęć: na adres IP; zużywa się dopiero po udanym wygenerowaniu
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const id = 'ai:' + ip;
  try {
    if ((await getCount(id)) >= LIMIT) return res.status(429).json({ error: 'free_limit' });
  } catch (e) { /* awaria licznika nie blokuje generowania */ }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: String(prompt || '').slice(0, 2000) },
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }
          ].concat(refImage ? [{ inlineData: { mimeType: 'image/jpeg', data: refImage } }] : []) }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: (j.error && j.error.message) || 'Błąd Gemini' });
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const p = parts.map(x => x.inlineData || x.inline_data).find(x => x && x.data);
    if (!p) return res.status(502).json({ error: 'Model nie zwrócił obrazu' });
    try { await addCount(id); } catch (e) {}
    return res.status(200).json({ image: p.data, mimeType: p.mimeType || p.mime_type || 'image/png' });
  } catch (e) {
    return res.status(502).json({ error: 'Brak połączenia z Gemini' });
  }
};
