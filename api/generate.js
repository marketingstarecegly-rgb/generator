// /api/generate.js
// Vercel Serverless Function — proxy do Gemini 2.5 Flash Image ("Nano Banana")
// Wymaga zmiennej środowiskowej GEMINI_API_KEY ustawionej w Vercel (Project Settings → Environment Variables).

const GEMINI_MODEL = "gemini-2.5-flash-image";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SURFACE_LABELS = {
  "elewacja": "elewację budynku (zewnętrzną ścianę)",
  "sciana-wewnetrzna": "wewnętrzną ścianę pomieszczenia",
  "kominek": "obudowę kominka lub zabudowę",
  "inna": "wskazaną powierzchnię"
};

const LAYOUT_LABELS = {
  "klasyczne-przesuniecie": "klasyczny układ z przesunięciem (jak w tradycyjnym murowaniu, cegła na cegłę z przesunięciem o pół długości)",
  "prosty": "prosty, równoległy układ bez przesunięcia",
  "mieszanka": "naturalną, nieregularną mieszankę formatów i odcieni",
  "jodelka": "układ w jodełkę"
};

function dataUrlToInlineData(dataUrl){
  const match = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(dataUrl || "");
  if(!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function fetchImageAsInlineData(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Nie udało się pobrać obrazu produktu (${res.status})`);
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return { mimeType: contentType.split(";")[0], data: base64 };
}

module.exports = async (req, res) => {
  if(req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metoda niedozwolona." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if(!apiKey){
    return res.status(500).json({ error: "Brak skonfigurowanego klucza GEMINI_API_KEY na serwerze." });
  }

  try{
    const {
      originalImage,
      highlightedImage,
      productName,
      productDescription,
      productImage,
      surface,
      layout,
      mount,
      mortarColor
    } = req.body || {};

    if(!originalImage || !highlightedImage || !productName){
      return res.status(400).json({ error: "Brak wymaganych danych wejściowych (zdjęcie, zaznaczenie lub produkt)." });
    }

    const originalInline = dataUrlToInlineData(originalImage);
    const highlightedInline = dataUrlToInlineData(highlightedImage);
    if(!originalInline || !highlightedInline){
      return res.status(400).json({ error: "Nieprawidłowy format przesłanego zdjęcia." });
    }

    let productInline = null;
    if(productImage){
      try{
        productInline = await fetchImageAsInlineData(productImage);
      }catch(e){
        productInline = null; // kontynuuj bez wzorca wizualnego, opieramy się na opisie tekstowym
      }
    }

    const surfaceLabel = SURFACE_LABELS[surface] || "wskazaną powierzchnię";
    const layoutLabel = LAYOUT_LABELS[layout] || "naturalny układ";

    const mountSentence = mount === "bez-fugi"
      ? "Płytki mają być ułożone bez fugi, ściśle przy sobie, bez widocznych spoin."
      : `Płytki mają być montowane z widoczną fugą w kolorze ${mortarColor || "jasnoszarym"}, o szerokości typowej dla płytek z cegły (ok. 1–1.5 cm).`;

    const promptParts = [];

    promptParts.push({
      text:
`Jesteś precyzyjnym narzędziem do fotorealistycznej wizualizacji materiałów budowlanych na zdjęciach architektonicznych.

Otrzymujesz dwa zdjęcia:
1. Oryginalne zdjęcie ściany/elewacji.
2. To samo zdjęcie z obszarem podświetlonym na pomarańczowo-czerwono (kolor nakładki: rgba(217,103,63)) — ten podświetlony obszar precyzyjnie wskazuje, KTÓRY fragment ściany ma zostać przebudowany.

Twoje zadanie:
Zastąp WYŁĄCZNIE podświetlony obszar realistyczną okładziną z płytek z cegły "${productName}". Opis materiału: ${productDescription || "płytka z cegły o naturalnej, nieregularnej fakturze"}.
${productInline ? "Dołączam też osobne zdjęcie referencyjne samego materiału/tekstury — dopasuj kolor, fakturę i charakter cegły dokładnie do tego wzorca." : ""}

Zastosuj:
- Powierzchnia: ${surfaceLabel}.
- Układ cegły: ${layoutLabel}.
- ${mountSentence}

Zasady krytyczne:
- Usuń całkowicie pomarańczową nakładkę z wyniku — finalny obraz ma wyglądać jak naturalna, niezmodyfikowana fotografia, BEZ śladu podświetlenia.
- Zachowaj dokładnie oryginalną perspektywę, kąt kamery, proporcje budynku oraz wszystkie elementy poza zaznaczonym obszarem (okna, drzwi, rynny, otoczenie, niebo, oświetlenie) bez zmian.
- Dopasuj cień, kierunek światła i odbicia na nowej okładzinie tak, by pasowały do oświetlenia sceny na oryginalnym zdjęciu.
- Zachowaj naturalne, realistyczne przejścia na krawędziach zaznaczonego obszaru — bez twardych, sztucznych linii cięcia.
- Nie dodawaj znaków wodnych, tekstu ani elementów graficznych spoza sceny.
- Wygeneruj wyłącznie finalny, fotorealistyczny obraz wynikowy.`
    });

    promptParts.push({ text: "Zdjęcie oryginalne:" });
    promptParts.push({ inlineData: originalInline });
    promptParts.push({ text: "Zdjęcie z podświetlonym obszarem do przemiany:" });
    promptParts.push({ inlineData: highlightedInline });
    if(productInline){
      promptParts.push({ text: `Referencyjna tekstura produktu "${productName}":` });
      promptParts.push({ inlineData: productInline });
    }

    const geminiRequest = {
      contents: [{ role: "user", parts: promptParts }],
      generationConfig: { responseModalities: ["IMAGE"] }
    };

    const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiRequest)
    });

    if(!geminiRes.ok){
      const errText = await geminiRes.text().catch(() => "");
      console.error("Gemini API error:", geminiRes.status, errText);
      return res.status(502).json({ error: `Błąd generatora obrazu (${geminiRes.status}). Spróbuj ponownie.` });
    }

    const geminiData = await geminiRes.json();
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData && p.inlineData.data);

    if(!imagePart){
      console.error("Brak obrazu w odpowiedzi Gemini:", JSON.stringify(geminiData).slice(0, 800));
      return res.status(502).json({ error: "Generator nie zwrócił obrazu. Spróbuj z innym zdjęciem lub zaznaczeniem." });
    }

    const mime = imagePart.inlineData.mimeType || "image/png";
    const b64 = imagePart.inlineData.data;

    return res.status(200).json({ image: `data:${mime};base64,${b64}` });

  }catch(err){
    console.error("Błąd /api/generate:", err);
    return res.status(500).json({ error: "Wewnętrzny błąd serwera." });
  }
};
