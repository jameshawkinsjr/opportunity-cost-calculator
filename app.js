/* Opportunity Cost Calculator
 * Pure client-side. Stores trades + Finnhub API key in localStorage.
 */
(() => {
  "use strict";

  const STORE_KEY = "occ.trades.v1";
  const API_KEY = "occ.finnhubKey.v1";
  const FINNHUB = "https://finnhub.io/api/v1/quote";
  

  // Optional: your deployed Cloudflare Worker proxy (see worker/ + README).
  // When set, live prices work for everyone with NO key entry — the key stays
  // secret on the proxy. A personal key entered in Settings still overrides it.
  // Example: "https://occ-finnhub-proxy.yourname.workers.dev"
  const PROXY_URL = "https://occ-finnhub-proxy.occ-finnhub-proxy.workers.dev";

  // ---- helpers --------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const fmtMoney = (n) =>
    "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  const sign = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

  // UTF-8-safe base64url, for sharing trades via the URL hash.
  const b64urlEncode = (str) =>
    btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64urlDecode = (str) =>
    decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));

  function encodeTrade(t) {
    const p = {
      s: t.soldSymbol, sp: t.soldPrice, sc: t.soldCurrent,
      b: t.boughtSymbol, bp: t.boughtPrice, bc: t.boughtCurrent,
      a: t.amount, n: t.note || "",
    };
    return b64urlEncode(JSON.stringify(p));
  }
  function decodeTrade(code) {
    const p = JSON.parse(b64urlDecode(code));
    return {
      soldSymbol: String(p.s || "").toUpperCase(),
      soldPrice: p.sp ?? null,
      soldCurrent: p.sc ?? null,
      boughtSymbol: String(p.b || "").toUpperCase(),
      boughtPrice: p.bp ?? null,
      boughtCurrent: p.bc ?? null,
      amount: p.a ?? null,
      note: p.n || "",
    };
  }

  const getKey = () => localStorage.getItem(API_KEY) || "";
  const setKey = (k) => localStorage.setItem(API_KEY, k);

  const loadTrades = () => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  };
  const saveTrades = (t) => localStorage.setItem(STORE_KEY, JSON.stringify(t));

  // ---- core calculation -----------------------------------------------------
  // staying  = how the stock you SOLD has done since you sold it
  // switching = how the stock you BOUGHT has done since you bought it
  // advantage = switching - staying  (positive => the trade was the right call)
  function compute(t) {
    const { soldPrice, soldCurrent, boughtPrice, boughtCurrent, amount } = t;
    const haveSold = soldCurrent != null && soldPrice > 0;
    const haveBought = boughtCurrent != null && boughtPrice > 0;
    if (!haveSold || !haveBought) return null;

    const stayingRet = (soldCurrent - soldPrice) / soldPrice;       // fraction
    const switchingRet = (boughtCurrent - boughtPrice) / boughtPrice;
    const advantageRet = switchingRet - stayingRet;

    let advantageDollars = null;
    if (amount != null && amount > 0) {
      // Value now if you switched vs if you had stayed, on the same dollars.
      advantageDollars = amount * (1 + switchingRet) - amount * (1 + stayingRet);
    }

    return {
      stayingRet: stayingRet * 100,
      switchingRet: switchingRet * 100,
      advantageRet: advantageRet * 100,
      advantageDollars,
    };
  }

  // ---- live prices ----------------------------------------------------------
  const proxyConfigured = () => PROXY_URL.trim() !== "";
  const canFetch = () => proxyConfigured() || !!getKey();

  async function fetchQuote(symbol) {
    const sym = encodeURIComponent(symbol.toUpperCase());
    const key = getKey();
    let url;
    if (key) {
      // A personal key always takes precedence (direct to Finnhub).
      url = `${FINNHUB}?symbol=${sym}&token=${encodeURIComponent(key)}`;
    } else if (proxyConfigured()) {
      url = `${PROXY_URL.trim().replace(/\/$/, "")}/quote?symbol=${sym}`;
    } else {
      throw new Error("No price source — add an API key or proxy");
    }
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) throw new Error("Invalid API key");
    if (res.status === 429) throw new Error("Rate limited — wait a moment");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    // Finnhub returns { c: current, ... }. Unknown symbols return c === 0.
    if (!data || typeof data.c !== "number" || data.c === 0) {
      throw new Error("No price for " + symbol.toUpperCase());
    }
    return data.c;
  }

  // ---- settings / key UI ----------------------------------------------------
  function refreshKeyStatus() {
    const live = canFetch();
    $("keyStatus").className = "status-dot " + (live ? "ok" : "off");
    $("keyStatus").title = getKey()
      ? "Using your personal API key"
      : proxyConfigured()
      ? "Live prices via built-in proxy"
      : "No live price source set";
    $("apiKey").value = getKey();
  }

  function initSettings() {
    refreshKeyStatus();
    $("saveKey").addEventListener("click", () => {
      setKey($("apiKey").value.trim());
      refreshKeyStatus();
      msg("keyMsg", getKey() ? "Saved." : "Key cleared.", getKey() ? "ok" : "");
    });
    $("testKey").addEventListener("click", async () => {
      setKey($("apiKey").value.trim());
      refreshKeyStatus();
      msg("keyMsg", "Testing…", "");
      try {
        const p = await fetchQuote("AAPL");
        msg("keyMsg", `Works — AAPL ${fmtMoney(p)}`, "ok");
      } catch (e) {
        msg("keyMsg", e.message, "err");
      }
    });
  }

  function msg(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = "inline-msg " + (cls || "");
  }

  // ---- trade form -----------------------------------------------------------
  function readForm() {
    const num = (id) => {
      const v = $(id).value.trim();
      return v === "" ? null : Number(v);
    };
    return {
      soldSymbol: $("soldSymbol").value.trim().toUpperCase(),
      soldPrice: num("soldPrice"),
      soldCurrent: num("soldCurrent"),
      boughtSymbol: $("boughtSymbol").value.trim().toUpperCase(),
      boughtPrice: num("boughtPrice"),
      boughtCurrent: num("boughtCurrent"),
      amount: num("amount"),
      note: $("note").value.trim(),
    };
  }

  function renderPreview() {
    const t = readForm();
    const r = compute(t);
    const box = $("preview");
    if (!r) { box.className = "preview hidden"; return; }
    box.className = "preview";
    box.innerHTML = verdictHTML(t, r, false);
  }

  function verdictHTML(t, r, compact) {
    const good = r.advantageRet > 0;
    const flat = Math.abs(r.advantageRet) < 0.005;
    const cls = flat ? "neutral" : good ? "good" : "bad";
    const sold = t.soldSymbol || "the stock you sold";
    const bought = t.boughtSymbol || "the stock you bought";

    let headline;
    if (flat) {
      headline = `Practically a wash between ${sold} and ${bought}.`;
    } else if (good) {
      headline = `<span class="good-text">Good trade.</span> Switching to ${bought} beat staying in ${sold}.`;
    } else {
      headline = `<span class="bad-text">Staying in ${sold} would have been better.</span>`;
    }

    const dollars =
      r.advantageDollars != null
        ? `<div class="stat"><div class="label">Dollar advantage</div>
             <div class="value ${sign(r.advantageDollars)}">${(r.advantageDollars >= 0 ? "+" : "") + fmtMoney(r.advantageDollars).replace("$-", "-$")}</div></div>`
        : "";

    return `
      <div class="verdict ${cls}">
        <div class="headline">${headline}</div>
        <div class="stats">
          <div class="stat">
            <div class="label">If you stayed (${sold})</div>
            <div class="value ${sign(r.stayingRet)}">${fmtPct(r.stayingRet)}</div>
          </div>
          <div class="stat">
            <div class="label">You switched (${bought})</div>
            <div class="value ${sign(r.switchingRet)}">${fmtPct(r.switchingRet)}</div>
          </div>
          <div class="stat">
            <div class="label">Net advantage</div>
            <div class="value ${sign(r.advantageRet)}">${fmtPct(r.advantageRet)}</div>
          </div>
          ${dollars}
        </div>
      </div>`;
  }

  async function fetchInto(which, symbolId, targetId) {
    const symbol = $(symbolId).value.trim();
    if (!symbol) { msg("keyMsg", "Enter a symbol first.", "err"); return; }
    const btn = document.querySelector(`[data-fetch="${which}"]`);
    const old = btn ? btn.textContent : "";
    if (btn) { btn.textContent = "…"; btn.disabled = true; }
    try {
      const price = await fetchQuote(symbol);
      $(targetId).value = price;
      renderPreview();
    } catch (e) {
      msg("keyMsg", e.message, "err");
      $("settings").open = true;
    } finally {
      if (btn) { btn.textContent = old; btn.disabled = false; }
    }
  }

  function initForm() {
    ["soldPrice", "soldCurrent", "boughtPrice", "boughtCurrent", "amount",
     "soldSymbol", "boughtSymbol"].forEach((id) =>
      $(id).addEventListener("input", renderPreview));

    document.querySelectorAll("[data-fetch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const which = btn.dataset.fetch;
        if (which === "sold") fetchInto("sold", "soldSymbol", "soldCurrent");
        else fetchInto("bought", "boughtSymbol", "boughtCurrent");
      });
    });

    $("fetchBoth").addEventListener("click", async () => {
      await fetchInto("sold", "soldSymbol", "soldCurrent");
      await fetchInto("bought", "boughtSymbol", "boughtCurrent");
    });

    $("tradeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const t = readForm();
      if (!t.soldSymbol || !t.boughtSymbol || !(t.soldPrice > 0) || !(t.boughtPrice > 0)) {
        msg("keyMsg", "Fill in both symbols and buy/sell prices.", "err");
        return;
      }
      const trades = loadTrades();
      trades.unshift({ id: cryptoId(), savedAt: nowISO(), ...t });
      saveTrades(trades);
      $("tradeForm").reset();
      $("preview").className = "preview hidden";
      renderList();
    });
  }

  function nowISO() {
    // Avoid Date.now-style surprises; just use a readable timestamp.
    return new Date().toISOString();
  }
  function cryptoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "t" + Math.random().toString(36).slice(2) + Date.now();
  }

  // ---- saved list -----------------------------------------------------------
  function renderList() {
    const trades = loadTrades();
    const list = $("tradeList");
    const empty = $("emptyState");
    list.innerHTML = "";
    empty.style.display = trades.length ? "none" : "block";

    trades.forEach((t) => {
      const r = compute(t);
      const card = document.createElement("div");
      let cls = "trade-card";
      if (r) cls += r.advantageRet > 0 ? " good" : r.advantageRet < 0 ? " bad" : "";
      card.className = cls;

      const date = t.savedAt ? new Date(t.savedAt).toLocaleDateString() : "";
      let verdictTag = '<span class="verdict-tag muted">need current prices</span>';
      let detail = "";

      if (r) {
        const good = r.advantageRet > 0;
        const flat = Math.abs(r.advantageRet) < 0.005;
        verdictTag = `<span class="verdict-tag ${flat ? "muted" : good ? "good-text" : "bad-text"}">
          ${flat ? "≈ even" : good ? "Good trade " + fmtPct(r.advantageRet) : "Should've stayed " + fmtPct(r.advantageRet)}
        </span>`;
        const dollarBit =
          r.advantageDollars != null
            ? ` · <span class="big-num ${sign(r.advantageDollars)}" style="color:inherit">${(r.advantageDollars >= 0 ? "+" : "") + fmtMoney(r.advantageDollars).replace("$-", "-$")}</span>`
            : "";
        detail = `Stayed ${fmtPct(r.stayingRet)} · Switched ${fmtPct(r.switchingRet)}${dollarBit}`;
      } else {
        detail = "Add or fetch current prices to see the result.";
      }

      card.innerHTML = `
        <div class="tc-top">
          <div class="pair">
            <span class="sym">${t.soldSymbol}</span>
            <span class="arrow">→</span>
            <span class="sym">${t.boughtSymbol}</span>
          </div>
          ${verdictTag}
        </div>
        <div class="tc-detail">
          Sold @ ${fmtMoney(t.soldPrice)} · Bought @ ${fmtMoney(t.boughtPrice)}
          ${t.soldCurrent != null ? ` · now ${fmtMoney(t.soldCurrent)} / ${t.boughtCurrent != null ? fmtMoney(t.boughtCurrent) : "?"}` : ""}
          ${date ? ` · ${date}` : ""}
        </div>
        <div class="tc-detail">${detail}</div>
        ${t.note ? `<div class="tc-note">“${escapeHTML(t.note)}”</div>` : ""}
        <div class="tc-actions">
          <button class="btn small ghost" data-act="refresh" data-id="${t.id}">Refresh</button>
          <button class="btn small ghost" data-act="share" data-id="${t.id}">Share</button>
          <button class="btn small ghost danger" data-act="delete" data-id="${t.id}">Delete</button>
        </div>`;
      list.appendChild(card);
    });

    list.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => handleCardAction(btn.dataset.act, btn.dataset.id, btn));
    });
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function handleCardAction(act, id, btn) {
    const trades = loadTrades();
    const i = trades.findIndex((t) => t.id === id);
    if (i < 0) return;

    if (act === "delete") {
      trades.splice(i, 1);
      saveTrades(trades);
      renderList();
      return;
    }
    if (act === "share") {
      await shareTrade(trades[i], btn);
      return;
    }
    if (act === "refresh") {
      try {
        const [sc, bc] = await Promise.all([
          fetchQuote(trades[i].soldSymbol),
          fetchQuote(trades[i].boughtSymbol),
        ]);
        trades[i].soldCurrent = sc;
        trades[i].boughtCurrent = bc;
        saveTrades(trades);
        renderList();
      } catch (e) {
        msg("keyMsg", e.message, "err");
        $("settings").open = true;
      }
    }
  }

  function initListControls() {
    $("clearAll").addEventListener("click", () => {
      if (loadTrades().length && confirm("Delete all saved trades?")) {
        saveTrades([]);
        renderList();
      }
    });
    $("refreshAll").addEventListener("click", async () => {
      if (!canFetch()) { $("settings").open = true; msg("keyMsg", "Set an API key to refresh.", "err"); return; }
      const trades = loadTrades();
      for (const t of trades) {
        try {
          t.soldCurrent = await fetchQuote(t.soldSymbol);
          t.boughtCurrent = await fetchQuote(t.boughtSymbol);
        } catch (e) {
          msg("keyMsg", e.message, "err");
        }
      }
      saveTrades(trades);
      renderList();
    });
  }

  // ---- sharing --------------------------------------------------------------
  function shareURL(t) {
    const base = location.origin + location.pathname;
    return base + "#share=" + encodeTrade(t);
  }

  async function shareTrade(t, btn) {
    const url = shareURL(t);
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch { /* fall through to native share / prompt */ }

    if (!copied && navigator.share) {
      try {
        await navigator.share({ title: "Stock trade", text: `${t.soldSymbol} → ${t.boughtSymbol}`, url });
        return;
      } catch { /* user cancelled or unsupported */ }
    }
    if (copied && btn) {
      const old = btn.textContent;
      btn.textContent = "Link copied!";
      setTimeout(() => { btn.textContent = old; }, 1800);
    } else if (!copied) {
      // Last resort: let the user copy it manually.
      prompt("Copy this share link:", url);
    }
  }

  let pendingShared = null;

  function checkSharedOnLoad() {
    const m = location.hash.match(/^#share=(.+)$/);
    if (!m) return;
    let t;
    try { t = decodeTrade(m[1]); } catch { clearShareHash(); return; }
    if (!t.soldSymbol || !t.boughtSymbol) { clearShareHash(); return; }
    pendingShared = t;
    openShareModal(t);
  }

  function openShareModal(t) {
    const body = $("shareModalBody");
    const r = compute(t);

    const leg = (kind, label, symbol, price, current) => `
      <div class="share-leg ${kind}">
        <div class="leg-label">${label}</div>
        <div class="leg-symbol">${escapeHTML(symbol)}</div>
        <div class="leg-price">${fmtMoney(price)}<span class="leg-sub">price ${kind === "sold" ? "when sold" : "when bought"}</span></div>
        ${current != null ? `<div class="leg-now">Now <strong>${fmtMoney(current)}</strong></div>` : ""}
      </div>`;

    const legs = `
      <div class="share-legs">
        ${leg("sold", "Sold", t.soldSymbol, t.soldPrice, t.soldCurrent)}
        <div class="share-leg-arrow" aria-hidden="true">→</div>
        ${leg("bought", "Bought", t.boughtSymbol, t.boughtPrice, t.boughtCurrent)}
      </div>`;

    const total = t.amount != null && t.amount > 0
      ? `<div class="share-total">
           <span class="label">Total amount switched</span>
           <span class="value">${fmtMoney(t.amount)}</span>
         </div>`
      : "";

    const note = t.note ? `<div class="tc-note" style="margin-bottom:12px;">“${escapeHTML(t.note)}”</div>` : "";

    const result = r ? verdictHTML(t, r, false) :
      `<p class="muted small">No current prices included — save it, then hit Refresh to compute the result.</p>`;

    body.innerHTML = legs + total + note + result;
    $("shareModal").classList.remove("hidden");
  }

  function clearShareHash() {
    // Remove the hash without reloading or leaving a "#" behind.
    history.replaceState(null, "", location.pathname + location.search);
  }

  function closeShareModal() {
    $("shareModal").classList.add("hidden");
    pendingShared = null;
    clearShareHash();
  }

  function initShareModal() {
    $("shareDismiss").addEventListener("click", closeShareModal);
    $("shareModal").addEventListener("click", (e) => {
      if (e.target.id === "shareModal") closeShareModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("shareModal").classList.contains("hidden")) closeShareModal();
    });
    $("shareSave").addEventListener("click", () => {
      if (!pendingShared) { closeShareModal(); return; }
      const trades = loadTrades();
      trades.unshift({ id: cryptoId(), savedAt: nowISO(), ...pendingShared });
      saveTrades(trades);
      closeShareModal();
      renderList();
    });
  }

  // ---- backtest / visualizer ------------------------------------------------
  const fmtMoney0 = (n) => "$" + Math.round(n).toLocaleString();
  const fmtDate = (unixSec) => new Date(unixSec * 1000).toLocaleDateString(
    undefined, { year: "numeric", month: "short", day: "numeric" });

  async function fetchHistory(symbol, from, to) {
    if (!proxyConfigured()) {
      throw new Error("Backtesting needs the price proxy configured (see README).");
    }
    const url = `${PROXY_URL.trim().replace(/\/$/, "")}/history` +
      `?symbol=${encodeURIComponent(symbol.toUpperCase())}&from=${from}&to=${to}`;
    const res = await fetch(url);
    if (!res.ok) {
      let m = "History HTTP " + res.status;
      try { const e = await res.json(); if (e.error) m = e.error; } catch {}
      throw new Error(m);
    }
    const data = await res.json();
    if (!data.points || !data.points.length) throw new Error("No history for " + symbol.toUpperCase());
    return data.points; // [{ t, c }]
  }

  function renderBacktestChart(a, b, chartAmount) {
    // a, b: { symbol, points: [{ t, c }] }. Normalize each to chartAmount.
    const norm = (pts) => {
      const c0 = pts[0].c;
      return pts.map((p) => ({ t: p.t, v: (chartAmount * p.c) / c0 }));
    };
    const A = norm(a.points), B = norm(b.points);
    const all = A.concat(B);
    const tMin = Math.min(...all.map((p) => p.t));
    const tMax = Math.max(...all.map((p) => p.t));
    let vMin = Math.min(...all.map((p) => p.v), chartAmount);
    let vMax = Math.max(...all.map((p) => p.v), chartAmount);
    const padV = (vMax - vMin) * 0.08 || 1;
    vMin -= padV; vMax += padV;

    const W = 680, H = 320;
    const pad = { l: 64, r: 16, t: 16, b: 32 };
    const x = (t) => pad.l + ((t - tMin) / (tMax - tMin || 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - pad.t - pad.b);
    const line = (S) => S.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");

    // Horizontal gridlines + money labels.
    let grid = "";
    const TICKS = 4;
    for (let i = 0; i <= TICKS; i++) {
      const v = vMin + (i / TICKS) * (vMax - vMin);
      const yy = y(v).toFixed(1);
      grid += `<line class="grid-line" x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}"/>`;
      grid += `<text class="axis-label" x="${pad.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtMoney0(v)}</text>`;
    }

    const baseY = y(chartAmount).toFixed(1);
    const endA = A[A.length - 1], endB = B[B.length - 1];

    const dateLabels =
      `<text class="axis-label" x="${pad.l}" y="${H - 10}" text-anchor="start">${fmtDate(tMin)}</text>` +
      `<text class="axis-label" x="${W - pad.r}" y="${H - 10}" text-anchor="end">${fmtDate(tMax)}</text>`;

    const svg = `
      <svg class="bt-chart" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="Value over time of ${escapeHTML(a.symbol)} versus ${escapeHTML(b.symbol)}">
        ${grid}
        <line class="base-line" x1="${pad.l}" y1="${baseY}" x2="${W - pad.r}" y2="${baseY}"/>
        <text class="axis-label" x="${W - pad.r}" y="${(+baseY - 5).toFixed(1)}" text-anchor="end">${fmtMoney0(chartAmount)} start</text>
        <path class="series line-a" d="${line(A)}"/>
        <path class="series line-b" d="${line(B)}"/>
        <circle class="dot-a" cx="${x(endA.t).toFixed(1)}" cy="${y(endA.v).toFixed(1)}" r="3.5"/>
        <circle class="dot-b" cx="${x(endB.t).toFixed(1)}" cy="${y(endB.v).toFixed(1)}" r="3.5"/>
        ${dateLabels}
      </svg>`;

    const legend = `
      <div class="bt-legend">
        <span class="item"><span class="swatch" style="background:var(--bad)"></span>
          <strong>${escapeHTML(a.symbol)}</strong> (stayed)
          <span class="final">→ ${fmtMoney(endA.v)}</span></span>
        <span class="item"><span class="swatch" style="background:var(--good)"></span>
          <strong>${escapeHTML(b.symbol)}</strong> (switched)
          <span class="final">→ ${fmtMoney(endB.v)}</span></span>
      </div>`;

    return `<div class="bt-chart-wrap">${svg}${legend}</div>`;
  }

  const isoDate = (d) => d.toISOString().slice(0, 10);

  // Date for a preset button: number of days back, or Jan 1 of this year (YTD).
  function presetDate(btn) {
    const today = new Date();
    if (btn.dataset.ytd) return isoDate(new Date(today.getFullYear(), 0, 1));
    const days = Number(btn.dataset.days);
    return isoDate(new Date(today.getTime() - days * 24 * 3600 * 1000));
  }

  function markActivePreset() {
    const cur = $("btDate").value;
    document.querySelectorAll("#btPresets .btn").forEach((b) => {
      b.classList.toggle("active", presetDate(b) === cur);
    });
  }

  async function runBacktest() {
    const symA = $("btSold").value.trim().toUpperCase();
    const symB = $("btBought").value.trim().toUpperCase();
    const dateStr = $("btDate").value;
    const amtRaw = $("btAmount").value.trim();
    const amount = amtRaw === "" ? null : Number(amtRaw);
    const chartAmount = amount && amount > 0 ? amount : 10000;

    if (!symA || !symB || !dateStr) {
      msg("btMsg", "Enter both symbols and a date.", "err");
      return;
    }
    const from = Math.floor(new Date(dateStr + "T00:00:00").getTime() / 1000);
    const to = Math.floor(Date.now() / 1000);
    if (from >= to) { msg("btMsg", "Pick a date in the past.", "err"); return; }

    const btn = $("btRun");
    const old = btn.textContent;
    btn.textContent = "Running…"; btn.disabled = true;
    msg("btMsg", "", "");
    try {
        const [ptsA, ptsB] = await Promise.all([
          fetchHistory(symA, from, to),
          fetchHistory(symB, from, to),
        ]);
        const a = { symbol: symA, points: ptsA };
        const b = { symbol: symB, points: ptsB };

        // Build a trade object so we reuse the existing verdict UI.
        const t = {
          soldSymbol: symA, soldPrice: ptsA[0].c, soldCurrent: ptsA[ptsA.length - 1].c,
          boughtSymbol: symB, boughtPrice: ptsB[0].c, boughtCurrent: ptsB[ptsB.length - 1].c,
          amount,
        };
        const r = compute(t);

        const actualStart = fmtDate(Math.min(ptsA[0].t, ptsB[0].t));
        const intro = `<p class="muted small" style="margin:0 0 12px;">
          Backtest from <strong>${actualStart}</strong> to today, per ${fmtMoney0(chartAmount)} invested.</p>`;

        // Trade we'd save/share: prices are the start/end of the backtest window.
        const saveable = { ...t, note: `Backtest from ${actualStart}` };
        const actions = `
          <div class="bt-actions row" style="margin-top:14px;">
            <button type="button" class="btn" id="btSave">Save trade</button>
            <button type="button" class="btn ghost" id="btShare">Share</button>
            <span class="inline-msg" id="btActionMsg"></span>
          </div>`;

        $("btResult").className = "bt-result";
        $("btResult").innerHTML =
          intro + renderBacktestChart(a, b, chartAmount) + verdictHTML(t, r, false) + actions;
        wireBacktestActions(saveable);
        msg("btMsg", "", "");
      } catch (err) {
        $("btResult").className = "bt-result hidden";
        msg("btMsg", err.message, "err");
        if (/proxy/i.test(err.message)) $("settings").open = true;
      } finally {
        btn.textContent = old; btn.disabled = false;
      }
  }

  function wireBacktestActions(saveable) {
    const saveBtn = $("btSave");
    const shareBtn = $("btShare");

    saveBtn.addEventListener("click", () => {
      const trades = loadTrades();
      trades.unshift({ id: cryptoId(), savedAt: nowISO(), ...saveable });
      saveTrades(trades);
      renderList();
      saveBtn.textContent = "Saved ✓";
      saveBtn.disabled = true;
      msg("btActionMsg", "Added to your saved trades below.", "ok");
    });

    shareBtn.addEventListener("click", () => shareTrade(saveable, shareBtn));
  }

  function initBacktest() {
    const today = new Date();
    $("btDate").max = isoDate(today);
    // Default to roughly one year ago (matches the 1Y preset).
    $("btDate").value = isoDate(new Date(today.getTime() - 365 * 24 * 3600 * 1000));

    $("backtestForm").addEventListener("submit", (e) => {
      e.preventDefault();
      runBacktest();
    });
    $("btDate").addEventListener("input", markActivePreset);

    document.querySelectorAll("#btPresets .btn").forEach((b) => {
      b.addEventListener("click", () => {
        $("btDate").value = presetDate(b);
        markActivePreset();
        // Auto-run only when both symbols are filled in.
        if ($("btSold").value.trim() && $("btBought").value.trim()) runBacktest();
      });
    });

    markActivePreset();
  }

  // ---- boot -----------------------------------------------------------------
  initSettings();
  initForm();
  initListControls();
  initShareModal();
  initBacktest();
  renderList();
  checkSharedOnLoad();
})();
