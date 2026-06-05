/* Stock price proxy — Cloudflare Worker
 *
 * Keeps your Finnhub API key secret (stored as the `FINNHUB_KEY` Worker secret,
 * never shipped to the browser) and only answers requests from your own site.
 *
 * Endpoints:
 *   GET /quote?symbol=AAPL                  -> Finnhub quote JSON ({ c, h, l, ... })
 *   GET /history?symbol=AAPL&from=&to=      -> { symbol, points: [{ t, c }] }
 *        from/to are unix seconds. History comes from Yahoo Finance (no key
 *        needed); routing it through here solves the browser CORS block.
 *
 * Deploy:  see ../README.md ("Live prices without users entering a key").
 */

// Origins allowed to call this proxy. Add your GitHub Pages URL here.
// Origin is the scheme + host only — no trailing slash, no path.
const ALLOWED_ORIGINS = [
  "https://jameshawkinsjr.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const SYMBOL_RE = /^[A-Z0-9.\-:]{1,15}$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);

    const cors = {
      // Echo the caller's origin when allowed; otherwise a safe default so the
      // browser still gets a CORS header (the 403 below is what blocks it).
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (!allowed) return json({ error: "Forbidden origin" }, 403);

    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return json({ error: "Invalid symbol" }, 400);

    if (url.pathname === "/quote") return handleQuote(symbol, env, cors, json);
    if (url.pathname === "/history") return handleHistory(symbol, url, cors, json);
    return json({ error: "Not found" }, 404);
  },
};

async function handleQuote(symbol, env, cors, json) {
  if (!env.FINNHUB_KEY) return json({ error: "Proxy missing FINNHUB_KEY secret" }, 500);

  const api =
    "https://finnhub.io/api/v1/quote?symbol=" +
    encodeURIComponent(symbol) +
    "&token=" +
    env.FINNHUB_KEY;

  let upstream;
  try {
    // Cache identical quotes briefly to soften the free-tier rate limit.
    upstream = await fetch(api, { cf: { cacheTtl: 15, cacheEverything: true } });
  } catch {
    return json({ error: "Upstream fetch failed" }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function handleHistory(symbol, url, cors, json) {
  const from = parseInt(url.searchParams.get("from") || "", 10);
  const to = parseInt(url.searchParams.get("to") || "", 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return json({ error: "Invalid from/to range" }, 400);
  }

  const api =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    `?period1=${from}&period2=${to}&interval=1d&includeAdjustedClose=true`;

  let upstream;
  try {
    upstream = await fetch(api, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OpportunityCostCalc/1.0)" },
      // Daily history for a fixed range is stable; cache for an hour.
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch {
    return json({ error: "Upstream fetch failed" }, 502);
  }
  if (!upstream.ok) return json({ error: "History unavailable (HTTP " + upstream.status + ")" }, 502);

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ error: "Bad history response" }, 502);
  }

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.timestamp) return json({ error: "No history for " + symbol }, 404);

  const ts = result.timestamp;
  const ind = result.indicators || {};
  const adj = ind.adjclose && ind.adjclose[0] && ind.adjclose[0].adjclose;
  const close = ind.quote && ind.quote[0] && ind.quote[0].close;

  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = (adj && adj[i] != null) ? adj[i] : (close && close[i]);
    if (c != null) points.push({ t: ts[i], c });
  }
  if (!points.length) return json({ error: "No history for " + symbol }, 404);

  return json({ symbol, points }, 200);
}
