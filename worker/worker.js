/* Finnhub quote proxy — Cloudflare Worker
 *
 * Keeps your Finnhub API key secret (stored as the `FINNHUB_KEY` Worker secret,
 * never shipped to the browser) and only answers requests from your own site.
 *
 * Endpoint:  GET /quote?symbol=AAPL  ->  Finnhub quote JSON ({ c, h, l, ... })
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
    if (url.pathname !== "/quote") return json({ error: "Not found" }, 404);

    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return json({ error: "Invalid symbol" }, 400);

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
  },
};
