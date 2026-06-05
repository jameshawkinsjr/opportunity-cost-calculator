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

## Live prices without users entering a key (Cloudflare Worker proxy)

By default each visitor pastes their own Finnhub key. If you'd rather have prices
"just work" for everyone, deploy the tiny proxy in [`worker/`](worker/). Your key
is stored as a Worker **secret** (never shipped to the browser), and the Worker
only answers requests from your own site.

You'll need a **free Cloudflare account** — that's the only new account. Steps:

1. **Set the allowed origins.** In [`worker/worker.js`](worker/worker.js), the
   `ALLOWED_ORIGINS` list already includes `https://jameshawkinsjr.github.io`.
   Edit it if your Pages URL differs.

2. **Deploy the Worker** (uses `npx`, no global install):

   ```bash
   cd worker
   npx wrangler login            # opens browser to authorize (free account)
   npx wrangler secret put FINNHUB_KEY   # paste your Finnhub key when prompted
   npx wrangler deploy
   ```

   Wrangler prints the live URL, e.g. `https://occ-finnhub-proxy.<you>.workers.dev`.

3. **Point the app at it.** In [`app.js`](app.js), set:

   ```js
   const PROXY_URL = "https://occ-finnhub-proxy.<you>.workers.dev";
   ```

   Commit and push. Now the Fetch buttons work for everyone with no key entry.
   (Anyone who *does* enter a personal key in Settings still uses that instead.)

> The Origin check stops other websites from using your proxy in a browser. It's
> not bulletproof against non-browser clients, but combined with the brief cache
> and Finnhub's own limits it's plenty for a personal tool.

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
