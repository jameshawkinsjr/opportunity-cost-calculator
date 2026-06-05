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
  const PROXY_URL = "";

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
      btn.addEventListener("click", () => handleCardAction(btn.dataset.act, btn.dataset.id));
    });
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function handleCardAction(act, id) {
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
      await shareTrade(trades[i], id);
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

  async function shareTrade(t, id) {
    const url = shareURL(t);
    const btn = document.querySelector(`[data-act="share"][data-id="${id}"]`);
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
    let summary = `
      <div class="tc-detail" style="margin:8px 0 12px;">
        <strong>${escapeHTML(t.soldSymbol)}</strong> → <strong>${escapeHTML(t.boughtSymbol)}</strong><br>
        Sold @ ${fmtMoney(t.soldPrice)} · Bought @ ${fmtMoney(t.boughtPrice)}
        ${t.note ? `<div class="tc-note">“${escapeHTML(t.note)}”</div>` : ""}
      </div>`;
    body.innerHTML = summary + (r ? verdictHTML(t, r, false) :
      `<p class="muted small">No current prices included — save it, then hit Refresh to compute the result.</p>`);
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

  // ---- boot -----------------------------------------------------------------
  initSettings();
  initForm();
  initListControls();
  initShareModal();
  renderList();
  checkSharedOnLoad();
})();
