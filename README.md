# Wizualizator Stare Cegły

Narzędzie działające analogicznie do wizualizatora RetroCegły
(https://retrocegla.pl/wizualizator), ale pod marką Stare Cegły i podpięte
pod starecegly.com.

## Co jest w środku

- `wizualizator.html` — cały frontend (jeden plik, bez frameworka).
  Użytkownik wgrywa zdjęcie, zaznacza pędzlem fragment ściany do przemiany,
  wybiera produkt (Cut Brick CLASSIC, Cut Brick YELLOW, Old Style CLASSIC,
  Lico Klasyczne Wulkaniczne — realne produkty i zdjęcia ze starecegly.com),
  ustawia powierzchnię / układ / fugę, i klika „Uruchom wizualizator”.
- `api/generate.js` — funkcja serverless na Vercel. Odbiera zdjęcie + maskę
  zaznaczenia, woła Gemini 2.5 Flash Image ("Nano Banana") do fotorealistycznego
  inpaintingu i zwraca gotowy obraz jako base64.

## Jak to działa (technicznie)

Zamiast przesyłać binarną maskę, frontend rysuje na canvasie zaznaczenie w
kolorze pomarańczowo-czerwonym (rgba 217,103,63) i wysyła do backendu dwa
obrazy: oryginał oraz wersję z podświetlonym obszarem. Backend instruuje
model, żeby zamienił WYŁĄCZNIE podświetlony fragment na wskazaną teksturę
cegły, zachowując perspektywę, oświetlenie i cienie, a na końcu usunął
podświetlenie. To sprawdzony sposób pracy z modelami typu Nano Banana, które
nie przyjmują osobnego kanału maski, tylko rozumieją wskazówki wizualne +
tekstowe.

## Wdrożenie na Vercel

1. Załóż nowy projekt na vercel.com i wgraj tę zawartość (albo połącz z
   repozytorium GitHub zawierającym te pliki).
2. W **Project Settings → Environment Variables** dodaj:
   - `GEMINI_API_KEY` = Twój klucz z Google AI Studio (https://aistudio.google.com/apikey)
3. Deploy. Vercel automatycznie rozpozna `api/generate.js` jako funkcję
   serverless (Node.js) i wystawi ją pod `/api/generate`.
4. Otwórz `https://twoja-domena.vercel.app/wizualizator.html` — powinno
   działać od razu.
5. Docelowo warto podpiąć wizualizator pod subdomenę/ścieżkę na
   starecegly.com (np. `starecegly.com/wizualizator`) — najprościej przez
   CNAME na Vercel albo reverse proxy w Shoperze, jeśli sklep na to pozwala.

## Co warto dograć później

- **Więcej produktów** — obecnie 4 realne produkty jako demo. Łatwo rozszerzyć
  tablicę `PRODUCTS` w `wizualizator.html` o kolejne serie (LONG, Loft Super
  Slim, Lico Toruńskie, itd.) — potrzebne tylko: nazwa, krótki opis tekstury
  i URL zdjęcia produktowego.
- **Limit zapytań / koszt** — Gemini 2.5 Flash Image kosztuje ok. 0,04 USD za
  wygenerowany obraz. Warto dodać prosty rate-limiting (np. po IP albo
  captcha) zanim narzędzie trafi na produkcję, żeby uniknąć nadużyć.
- **Zapis wizualizacji na koncie** — RetroCegła oferuje „zachowaj wizualizację
  po zalogowaniu”. To wymaga bazy danych (np. Vercel Postgres / Supabase) i
  integracji z kontem klienta w Shoperze — do zaprojektowania osobno.
- **Wersja niemiecka** — struktura jest gotowa pod i18n; teksty UI są obecnie
  na sztywno po polsku. Dla alteziegel.com trzeba będzie zduplikować plik z
  tłumaczeniem tekstów interfejsu.
