# Opportunity Cost Calculator

A tiny, backend-free web app to answer: **"I sold one stock to buy another — did
that pay off, or should I have stayed put?"**

- Enter the stock you **sold** and the stock you **bought**, with each price.
- Fetch live current prices (or type them in manually).
- See whether switching beat staying — as a percentage and, optionally, in dollars.
- Trades are saved in your browser's **local storage** so you can track several over time.
- **Share** any trade as a link — the details are encoded in the URL hash (nothing
  hits a server). Opening a shared link pops a modal to save it to your own trades.

Everything runs client-side. There is no server and no data leaves your browser
(except the symbol lookups you send to Finnhub).

## How the math works

For each trade we compare two returns since the moment you switched:

- **Staying** = how the stock you *sold* has moved: `(current − sell) / sell`
- **Switching** = how the stock you *bought* has moved: `(current − buy) / buy`
- **Net advantage** = `switching − staying`

A positive net advantage means the trade was the right call. If you enter the
dollar amount you switched, you also get the advantage in dollars.

## Live prices (Finnhub)

Live quotes come from [Finnhub](https://finnhub.io/register), one of the few
stock APIs that allows direct browser calls (needed for a static site).

1. Grab a **free** API key at <https://finnhub.io/register>.
2. Open the app, expand **Settings & live prices**, paste the key, click **Save key**.
3. The key is stored only in your browser's local storage.

No key? You can still use everything — just type the current prices in by hand.

> Note: a client-side key is visible to anyone using *your* browser/instance.
> That's fine for a personal tool. Don't commit your key into the repo.

## Run locally

It's just static files — open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a repo and push these files:

   ```bash
   git init
   git add .
   git commit -m "Opportunity cost calculator"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from
   a branch**, branch `main`, folder `/ (root)`. Save.
3. Your app will be live at `https://<you>.github.io/<repo>/` within a minute.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and layout |
| `styles.css` | Styling (dark theme) |
| `app.js` | Calculation, Finnhub fetch, local-storage persistence |

---

Educational tool only — not investment advice. Quotes may be delayed.
