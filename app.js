// ============================================================
// Arthy Investment Coach — app.js
// Phase 1 : LocalStorage  (runs anywhere, no backend needed)
// Phase 2 : fetchQuote()  calls /api/quote  (Cloudflare Worker / Pages Function)
// Phase 3 : D1 storage    calls /api/portfolio & /api/holdings (Cloudflare D1)
// ============================================================

'use strict';

// ── CONSTANTS ──────────────────────────────────────────────

const APP_VERSION  = '2.0.1';
const STORAGE_KEY  = 'arthy_portfolio_v1';
const DEFAULT_FX   = 36.5;          // THB per USD fallback
const PORTFOLIO_ID = 'arthy-001';   // Fixed single-user ID for Phase 3

// Shared API secret — sent in every request to the Functions backend.
// Prevents casual public access. Anyone who can read this source code
// could bypass it; for a single-user educational app this is sufficient.
const APP_SECRET = 'arthy-2026-xK9mP3vQ7rL';

const ASSET_TYPES = ['ETF', 'Stock', 'Bond', 'Crypto'];
const RISK_LEVELS = ['Low', 'Medium', 'Medium-High', 'High'];
const CATEGORIES  = [
  'Core ETF', 'Growth ETF', 'Dividend ETF', 'Sector ETF',
  'Individual Stock', 'Dividend / Defensive', 'Consumer',
  'Technology', 'Financial', 'Energy', 'Healthcare',
];

// ── ENVIRONMENT DETECTION ──────────────────────────────────

// True when running locally via file:// or localhost
// False when deployed to Cloudflare Pages → use API (Phase 3)
const IS_LOCAL = (() => {
  const h = location.hostname;
  return h === '' || h === 'localhost' || h === '127.0.0.1'
      || location.protocol === 'file:';
})();

// ── STATE ──────────────────────────────────────────────────

let portfolio      = { holdings: [], lastUpdated: null };
let currentScreen  = 'dashboard';
let editingId      = null;
let currentFXRate  = DEFAULT_FX;   // live USD/THB rate — updated from /api/fx on init

// Watchlist state (Market Watch screen)
// [{name, yfSymbol, addedAt}]  — max 10 items
let watchlist     = [];
let historyCtx    = null;   // {name, yfSymbol} currently open in history modal

// ── PHASE 3: API STORAGE LAYER ─────────────────────────────
// When IS_LOCAL is false, the app uses these API calls.
// Functions fall back to LocalStorage if the API is unreachable.

// Common headers for all API calls
const API_HEADERS = {
  'Content-Type'  : 'application/json',
  'X-App-Secret'  : APP_SECRET,
};

async function apiGetPortfolio() {
  const res = await fetch('/api/portfolio', { headers: API_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiAddHolding(data) {
  const res = await fetch('/api/holdings', {
    method : 'POST',
    headers: API_HEADERS,
    body   : JSON.stringify({ ...data, portfolioId: PORTFOLIO_ID }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiUpdateHolding(id, data) {
  const res = await fetch(`/api/holdings/${id}`, {
    method : 'PUT',
    headers: API_HEADERS,
    body   : JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiDeleteHolding(id) {
  const res = await fetch(`/api/holdings/${id}`, {
    method : 'DELETE',
    headers: API_HEADERS,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// Phase 4: Claude AI Coach — POST minimal portfolio data, get a Thai summary.
async function apiCoachMonthlySummary(payload) {
  const res = await fetch('/api/coach/monthly-summary', {
    method : 'POST',
    headers: API_HEADERS,
    body   : JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── LOCALSTORAGE ───────────────────────────────────────────

function lsLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) portfolio = JSON.parse(raw);
  } catch (e) {
    portfolio = { holdings: [], lastUpdated: null };
  }
}

function lsSave() {
  try {
    portfolio.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  } catch (e) {
    showToast('Could not save data to LocalStorage', 'error');
  }
}

// ── MAIN LOAD / SAVE (adapter) ─────────────────────────────

async function loadPortfolio() {
  if (!IS_LOCAL) {
    try {
      const data = await apiGetPortfolio();
      portfolio  = data;
      return;
    } catch (e) {
      console.warn('API unavailable, falling back to LocalStorage:', e);
    }
  }
  lsLoad();
}

function savePortfolio() {
  // Always keep LocalStorage in sync as offline backup
  lsSave();
}

// ── DATA MIGRATION ─────────────────────────────────────────
// Converts old Phase-1 Thai strings to English on first load.

function migrateData() {
  const thaiToEn = {
    assetType : { 'หุ้น': 'Stock' },
    riskLevel : {
      'ต่ำ': 'Low', 'ปานกลาง': 'Medium',
      'ปานกลาง-สูง': 'Medium-High', 'สูง': 'High',
    },
  };

  let changed = false;
  portfolio.holdings = portfolio.holdings.map(h => {
    const newH = { ...h };
    if (thaiToEn.assetType[h.assetType]) {
      newH.assetType = thaiToEn.assetType[h.assetType];
      changed = true;
    }
    if (thaiToEn.riskLevel[h.riskLevel]) {
      newH.riskLevel = thaiToEn.riskLevel[h.riskLevel];
      changed = true;
    }
    return newH;
  });

  if (changed) savePortfolio();
}

// ── CRUD ───────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function addHolding(data) {
  const holding = {
    id: generateId(),
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  portfolio.holdings.push(holding);
  savePortfolio();

  if (!IS_LOCAL) {
    try { await apiAddHolding(holding); } catch (e) {
      console.warn('API add failed (local copy saved):', e);
      showToast('⚠️ Saved locally — cloud sync failed. Try reloading.', 'warning');
    }
  }
  return holding;
}

async function updateHolding(id, data) {
  const idx = portfolio.holdings.findIndex(h => h.id === id);
  if (idx === -1) return null;

  portfolio.holdings[idx] = {
    ...portfolio.holdings[idx],
    ...data,
    id,
    updatedAt: new Date().toISOString(),
  };
  savePortfolio();

  if (!IS_LOCAL) {
    try { await apiUpdateHolding(id, portfolio.holdings[idx]); } catch (e) {
      console.warn('API update failed (local copy saved):', e);
      showToast('⚠️ Saved locally — cloud sync failed. Try reloading.', 'warning');
    }
  }
  return portfolio.holdings[idx];
}

async function deleteHolding(id) {
  portfolio.holdings = portfolio.holdings.filter(h => h.id !== id);
  savePortfolio();

  if (!IS_LOCAL) {
    try { await apiDeleteHolding(id); } catch (e) {
      console.warn('API delete failed (local copy saved):', e);
      showToast('⚠️ Deleted locally — cloud sync failed. Try reloading.', 'warning');
    }
  }
}

// ── CALCULATIONS ───────────────────────────────────────────

function calcHolding(h) {
  const isUSstock = h.market === 'US' && h.buyCurrency === 'USD'
                 && h.currentPriceCurrency === 'USD';

  // Current value: use live FX rate for US stocks
  const curFX          = h.currentPriceCurrency === 'USD' ? currentFXRate : 1;
  const currentValueTHB = h.quantity * h.currentPrice * curFX;

  // Cost basis: use the stored FX rate at time of purchase
  const buyFX       = h.buyCurrency === 'USD' ? (h.fxRate || DEFAULT_FX) : 1;
  const totalCostTHB = h.totalCostTHB > 0
    ? h.totalCostTHB
    : h.quantity * h.averageBuyPrice * buyFX;

  const gainLossTHB     = currentValueTHB - totalCostTHB;
  const gainLossPercent = totalCostTHB > 0 ? (gainLossTHB / totalCostTHB) * 100 : 0;

  // ── P&L breakdown for US stocks ─────────────────────────
  // stockPnLTHB: gain/loss purely from price change (valued at buy FX rate)
  // fxPnLTHB:   gain/loss from USD/THB rate movement
  // stockPnLTHB + fxPnLTHB = gainLossTHB  ✓
  let stockPnLTHB = gainLossTHB;
  let stockPnLUSD = 0;
  let fxPnLTHB    = 0;
  let fxChange    = 0;   // current FX - buy FX

  if (isUSstock) {
    stockPnLUSD = (h.currentPrice - h.averageBuyPrice) * h.quantity;
    stockPnLTHB = stockPnLUSD * buyFX;
    fxChange    = currentFXRate - buyFX;
    fxPnLTHB   = h.currentPrice * h.quantity * fxChange;
  }

  return {
    ...h,
    currentValueTHB, totalCostTHB,
    gainLossTHB, gainLossPercent,
    stockPnLTHB, stockPnLUSD,
    fxPnLTHB, fxChange,
    buyFX, curFX,
    isUSstock,
  };
}

function calcPortfolio() {
  const holdings = portfolio.holdings.map(calcHolding);

  const totalCostTHB      = holdings.reduce((s, h) => s + h.totalCostTHB, 0);
  const totalValueTHB     = holdings.reduce((s, h) => s + h.currentValueTHB, 0);
  const totalGainLossTHB  = totalValueTHB - totalCostTHB;
  const totalGainLossPercent = totalCostTHB > 0
    ? (totalGainLossTHB / totalCostTHB) * 100 : 0;

  const byMarket    = {};
  const byAssetType = {};
  holdings.forEach(h => {
    byMarket[h.market]       = (byMarket[h.market]       || 0) + h.currentValueTHB;
    byAssetType[h.assetType] = (byAssetType[h.assetType] || 0) + h.currentValueTHB;
  });

  const toAlloc = obj =>
    Object.entries(obj)
      .map(([label, value]) => ({
        label, value,
        pct: totalValueTHB > 0 ? (value / totalValueTHB) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

  const sorted = [...holdings].sort((a, b) => b.gainLossPercent - a.gainLossPercent);

  return {
    holdings,
    totalCostTHB, totalValueTHB, totalGainLossTHB, totalGainLossPercent,
    allocationByMarket  : toAlloc(byMarket),
    allocationByAssetType: toAlloc(byAssetType),
    best : sorted[0]                 || null,
    worst: sorted[sorted.length - 1] || null,
  };
}

// ── RULE CHECKS ────────────────────────────────────────────

function checkRules(metrics) {
  const { holdings, totalValueTHB } = metrics;
  const W = [];
  if (!holdings.length || totalValueTHB === 0) return W;

  // Rule 1 — single holding > 20 %
  holdings.forEach(h => {
    const pct = (h.currentValueTHB / totalValueTHB) * 100;
    if (pct > 20) W.push({
      level: 'warning', id: `conc-${h.id}`,
      title  : `${h.symbol} is ${pct.toFixed(1)}% of portfolio`,
      message: 'This position exceeds 20% of your portfolio. Review your conviction and risk tolerance.',
    });
  });

  // Rule 2 — individual stocks > 40 %
  const stockVal = holdings
    .filter(h => h.assetType === 'Stock' || h.assetType === 'หุ้น')
    .reduce((s, h) => s + h.currentValueTHB, 0);
  const stockPct = (stockVal / totalValueTHB) * 100;
  if (stockPct > 40) W.push({
    level: 'warning', id: 'stocks-heavy',
    title  : `Individual stocks at ${stockPct.toFixed(1)}%`,
    message: 'Individual stocks make up a large portion. Learn more about diversification.',
  });

  // Rule 3 — no ETF
  if (!holdings.some(h => h.assetType === 'ETF')) W.push({
    level: 'info', id: 'no-etf',
    title  : 'No ETF in portfolio',
    message: 'Adding a broad-market ETF like VOO can improve diversification.',
  });

  // Rule 4 — down > 10 % and no note
  holdings.forEach(h => {
    if (h.gainLossPercent < -10 && !(h.learningNote || '').trim()) W.push({
      level: 'danger', id: `loss-note-${h.id}`,
      title  : `${h.symbol} is down ${Math.abs(h.gainLossPercent).toFixed(1)}% with no learning note`,
      message: 'Write a learning note before deciding to buy more or sell.',
    });
  });

  // Rule 5 — USD holding missing FX rate
  holdings.forEach(h => {
    if (h.buyCurrency === 'USD' && !(h.fxRate > 0)) W.push({
      level: 'warning', id: `fx-${h.id}`,
      title  : `${h.symbol} is missing an FX rate`,
      message: 'US stocks need a USD/THB exchange rate to calculate correct THB value.',
    });
  });

  return W;
}

// ── AI COACH (RULE-BASED) ──────────────────────────────────

function generateCoachSummary() {
  const m = calcPortfolio();
  const { holdings, totalValueTHB, totalGainLossPercent, allocationByAssetType } = m;

  if (!holdings.length) {
    return {
      healthScore  : 0,
      lessonOfMonth: "No portfolio data yet. Add a holding or load sample data to get started.",
      whatWentWell : ['You launched the app — great first step!'],
      whatToReview : ['Try adding your first ETF, like VOO or QQQM, to begin tracking.'],
      questions    : [
        'What is an ETF and why do long-term investors prefer them?',
        'What does diversification mean in investing?',
        'What is your first investment goal?',
      ],
      riskNote: '',
    };
  }

  // ── Health score ──
  let score  = 100;
  const hasETF = holdings.some(h => h.assetType === 'ETF');
  if (!hasETF) score -= 20;

  const etfEntry = allocationByAssetType.find(t => t.label === 'ETF');
  const etfPct   = etfEntry ? etfEntry.pct : 0;
  if (hasETF && etfPct < 30 && holdings.length > 2) score -= 10;

  const stockPct = holdings
    .filter(h => h.assetType === 'Stock' || h.assetType === 'หุ้น')
    .reduce((s, h) => s + (h.currentValueTHB / totalValueTHB) * 100, 0);
  if (stockPct > 50) score -= 10;

  const maxConc = Math.max(...holdings.map(h => (h.currentValueTHB / totalValueTHB) * 100));
  if (maxConc > 30) score -= 10;
  if (maxConc > 50) score -= 10;

  const noNoteCount = holdings.filter(h => !(h.learningNote || '').trim()).length;
  score -= noNoteCount * 5;
  if (totalGainLossPercent < -15) score -= 10;
  score = Math.max(0, Math.min(100, score));

  // ── What went well ──
  const well = [];
  if (hasETF)      well.push('Portfolio has ETFs as a core — good for diversification.');
  if (etfPct >= 50) well.push(`ETFs make up ${etfPct.toFixed(0)}% of the portfolio — well balanced.`);
  if (m.best && m.best.gainLossPercent > 3)
    well.push(`${m.best.symbol} is up +${m.best.gainLossPercent.toFixed(1)}% — solid performance.`);
  if (totalGainLossPercent > 0)
    well.push(`Portfolio is overall positive at +${totalGainLossPercent.toFixed(1)}% 👍`);
  const notedCount = holdings.filter(h => (h.learningNote || '').trim()).length;
  if (notedCount > 0)
    well.push(`${notedCount} holding(s) have learning notes — great habit!`);
  if (!well.length)
    well.push('You started building a portfolio — that is the most important first step.');

  // ── What to review ──
  const review = [];
  if (!hasETF)
    review.push('Consider adding a broad-market ETF like VOO or QQQM for diversification.');
  if (maxConc > 25) {
    const top = holdings.reduce((a, b) => a.currentValueTHB > b.currentValueTHB ? a : b);
    review.push(`${top.symbol} has the highest weight — do you still believe in this position?`);
  }
  if (m.worst && m.worst.gainLossPercent < -3)
    review.push(`${m.worst.symbol} is down ${Math.abs(m.worst.gainLossPercent).toFixed(1)}% — read the news and understand why.`);
  if (noNoteCount > 0)
    review.push(`${noNoteCount} holding(s) have no learning note. Write down what you know about them.`);
  if (!review.length)
    review.push('Portfolio looks healthy. Study basic financial statement reading as a next step.');

  // ── Lesson of month ──
  let lesson;
  if (!hasETF) {
    lesson = 'This month, study what an ETF is and why many long-term investors use a broad-market ETF as their portfolio core.';
  } else if (etfPct >= 50) {
    lesson = `This month, Arthy learned that having ETFs as the core (${etfPct.toFixed(0)}%) reduces volatility and removes the need to follow every company's news.`;
  } else if (stockPct > 40) {
    lesson = 'This month, revisit whether you truly understand the business of each individual stock — what is their revenue model and key risks?';
  } else {
    lesson = `Portfolio has a balanced mix of ETFs and individual stocks. Next: study basic financial statement reading (Revenue, Net Profit, P/E Ratio).`;
  }

  // ── Questions ──
  const qs = [];
  if (!hasETF || etfPct < 30)
    qs.push('Which type of ETF best fits my long-term investment goal?');
  if (m.worst && m.worst.gainLossPercent < 0)
    qs.push(`Why is ${m.worst.symbol} declining — is the business still strong?`);
  if (maxConc > 20)
    qs.push('If my largest position drops 30%, how much does my total portfolio lose?');
  qs.push('What do I want to learn about investing next month?');
  if (qs.length < 3)
    qs.push('How can I invest consistently every month?');

  // ── Risk note ──
  const hasUS = holdings.some(h => h.market === 'US');
  const hasTH = holdings.some(h => h.market === 'TH');
  let riskNote = '';
  if (hasUS && hasTH)
    riskNote = 'Portfolio holds both US and Thai stocks. USD/THB exchange rate fluctuations affect your THB value.';
  else if (hasUS)
    riskNote = 'All positions are in USD. Monitor the USD/THB exchange rate as it affects your total THB value.';
  else if (hasTH)
    riskNote = 'All positions are in Thai stocks. Diversifying internationally could reduce country-specific risk.';

  return { healthScore: score, lessonOfMonth: lesson, whatWentWell: well, whatToReview: review, questions: qs.slice(0, 3), riskNote };
}

// ── PHASE 2: FETCH QUOTE ───────────────────────────────────

/**
 * Fetch real-time stock quote.
 * - Phase 1 (local)       : returns null → manual price only
 * - Phase 2 (Cloudflare)  : calls /api/quote → Cloudflare Pages Function
 *                           which hits Finnhub/Polygon and caches in KV
 *
 * @param {string} symbol  e.g. "AAPL"
 * @param {string} market  "US" | "TH"
 * @returns {Promise<NormalizedQuote|null>}
 */
async function fetchQuote(symbol, market) {
  if (IS_LOCAL) return null;   // Phase 1: manual only

  try {
    const res = await fetch(
      `/api/quote?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`,
      { headers: API_HEADERS }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('fetchQuote failed:', e);
    return null;
  }
}

/**
 * Fetch historical OHLCV data for a holding via Yahoo Finance.
 * @param {string} symbol   e.g. "PTT" or "AAPL"
 * @param {string} market   "US" | "TH"
 * @param {string} period   "7d" | "1mo" | "3mo" | "6mo" | "1y" (default "3mo")
 * @param {string} [start]  ISO date "2024-01-01" (optional)
 * @param {string} [end]    ISO date "2024-12-31" (optional)
 * @returns {Promise<{rows:[],currency,symbol}|null>}
 */
async function fetchPriceHistory(symbol, market, period = '3mo', start = '', end = '') {
  if (IS_LOCAL) return null;

  const params = new URLSearchParams({
    symbol, market,
    ...(start ? { start, end } : { period }),
  });

  try {
    const res = await fetch(`/api/history?${params}`, { headers: API_HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('fetchPriceHistory failed:', e);
    return null;
  }
}

// ── REFRESH ALL US PRICES (Phase 2 + 3) ───────────────────
// Calls POST /api/refresh — server fetches Finnhub for every US holding,
// writes prices directly to D1, returns results + timestamp.

let lastRefreshLog = null;   // cached in memory; also persisted to LocalStorage

function loadLastRefreshLog() {
  try {
    const raw = localStorage.getItem('arthy_last_refresh');
    if (raw) lastRefreshLog = JSON.parse(raw);
  } catch (_) {}
}

function saveLastRefreshLog(log) {
  lastRefreshLog = log;
  try { localStorage.setItem('arthy_last_refresh', JSON.stringify(log)); } catch (_) {}
}

async function refreshAllPrices(force = false) {
  if (IS_LOCAL) {
    showToast('Price auto-fetch is available on Cloudflare Pages (Phase 2)', 'info');
    return;
  }

  // Animate the button if visible
  const btn = document.getElementById('btn-refresh-prices');
  if (btn) { btn.disabled = true; btn.classList.add('animate-spin-once'); }

  showToast('🔄 Refreshing prices from Yahoo Finance…', 'info');

  try {
    const res = await fetch('/api/refresh', {
      method : 'POST',
      headers: API_HEADERS,
      body   : JSON.stringify({ force }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ Refresh failed: ${err.error || res.status}`, 'error');
      return;
    }

    const log = await res.json();
    saveLastRefreshLog(log);

    // Apply updated prices to local portfolio state
    if (log.results) {
      for (const r of log.results) {
        if (r.status === 'updated' && r.price > 0) {
          const h = portfolio.holdings.find(x => x.symbol === r.symbol && x.market === 'US');
          if (h) {
            h.currentPrice         = r.price;
            h.currentPriceCurrency = 'USD';
            h.updatedAt            = new Date().toISOString();
          }
        }
      }
      savePortfolio();
    }

    showToast(`✅ ${log.updatedCount} price(s) updated · ${log.skippedCount} skipped`);
    renderCurrentScreen();

  } catch (e) {
    console.error('refreshAllPrices error:', e);
    showToast('❌ Could not reach the refresh API', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('animate-spin-once'); }
  }
}

// Portfolio-screen refresh button handler
async function portfolioRefresh() {
  const btn  = document.getElementById('ptf-refresh-btn');
  const icon = document.getElementById('ptf-refresh-icon');
  if (btn) { btn.disabled = true; if (icon) icon.style.animation = 'spin 1s linear infinite'; }
  await refreshAllPrices(false);
  updatePortfolioRefreshLabel();
  if (btn) { btn.disabled = false; if (icon) icon.style.animation = ''; }
}

function updatePortfolioRefreshLabel() {
  const el = document.getElementById('ptf-refresh-time');
  if (!el) return;
  el.textContent = lastRefreshLog
    ? timeAgo(lastRefreshLog.refreshedAt)
    : (IS_LOCAL ? 'manual only' : 'never');
}

// Fetch live USD/THB FX rate from /api/fx and update currentFXRate
async function fetchLiveFXRate() {
  if (IS_LOCAL) return currentFXRate;
  try {
    const res = await fetch('/api/fx?pair=USDTHB', { headers: API_HEADERS });
    if (!res.ok) return currentFXRate;
    const data = await res.json();
    if (data.rate && data.rate > 0) {
      currentFXRate = data.rate;
      // Persist so next open shows last known rate
      try { localStorage.setItem('arthy_fx_rate', JSON.stringify({ rate: data.rate, updatedAt: data.updatedAt })); } catch (_) {}
    }
    return currentFXRate;
  } catch (_) { return currentFXRate; }
}

// Restore last known FX rate from LocalStorage (instant on startup)
function loadFXRateCache() {
  try {
    const raw = localStorage.getItem('arthy_fx_rate');
    if (raw) {
      const { rate } = JSON.parse(raw);
      if (rate > 0) currentFXRate = rate;
    }
  } catch (_) {}
}

// Load cloud sync status (D1 count + last refresh log from KV)
async function loadSyncStatus() {
  if (IS_LOCAL) return null;
  try {
    const res = await fetch('/api/sync-status', { headers: API_HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

// ═══════════════════════════════════════════════════════════
// ── MARKET WATCH / WATCHLIST ─────────────────────────────
// ═══════════════════════════════════════════════════════════

const WL_KEY     = 'arthy_watchlist_v1';
const WL_MAX     = 10;

function loadWatchlistState() {
  try {
    const raw = localStorage.getItem(WL_KEY);
    if (raw) watchlist = JSON.parse(raw);
  } catch (_) { watchlist = []; }
}

function saveWatchlistState() {
  try { localStorage.setItem(WL_KEY, JSON.stringify(watchlist)); } catch (_) {}
}

function toggleWatchlistForm() {
  const form = document.getElementById('wl-form');
  if (!form) return;
  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden', !isHidden);
  if (isHidden) document.getElementById('wl-name')?.focus();
}

function addToWatchlist() {
  const name   = document.getElementById('wl-name')?.value.trim();
  const symbol = document.getElementById('wl-symbol')?.value.trim().toUpperCase();

  if (!name)   { showToast('Enter a display name', 'error'); return; }
  if (!symbol) { showToast('Enter a Yahoo Finance symbol', 'error'); return; }
  if (watchlist.length >= WL_MAX) {
    showToast(`Maximum ${WL_MAX} stocks in watchlist`, 'error'); return;
  }
  if (watchlist.find(w => w.yfSymbol === symbol)) {
    showToast(`${symbol} already in watchlist`, 'warning'); return;
  }

  watchlist.push({ name, yfSymbol: symbol, addedAt: new Date().toISOString() });
  saveWatchlistState();

  // Clear inputs
  document.getElementById('wl-name').value   = '';
  document.getElementById('wl-symbol').value = '';
  toggleWatchlistForm();

  renderMarkets();
  showToast(`${name} added to watchlist ✅`);
}

function removeFromWatchlist(yfSymbol) {
  watchlist = watchlist.filter(w => w.yfSymbol !== yfSymbol);
  saveWatchlistState();
  renderMarkets();
}

// ── Render Market Watch screen ────────────────────────────

function renderMarkets() {
  const container = document.getElementById('watchlist-container');
  if (!container) return;

  if (watchlist.length === 0) {
    container.innerHTML = `
      <div class="bg-slate-800/60 rounded-2xl p-8 text-center border border-slate-700/40">
        <div class="text-4xl mb-3">🌍</div>
        <p class="text-white font-semibold">No stocks yet</p>
        <p class="text-xs text-slate-400 mt-1">Tap <strong>+ Add</strong> and enter any Yahoo Finance symbol</p>
        <div class="mt-4 text-xs text-slate-500 space-y-1 text-left max-w-xs mx-auto">
          <p>🇺🇸 US stocks: <span class="text-slate-300 font-mono">AAPL · TSLA · VOO</span></p>
          <p>🇹🇭 Thai stocks: <span class="text-slate-300 font-mono">PTT.BK · ADVANC.BK</span></p>
          <p>🇯🇵 Japan: <span class="text-slate-300 font-mono">7203.T · 6758.T</span></p>
          <p>🇭🇰 Hong Kong: <span class="text-slate-300 font-mono">0700.HK · 9988.HK</span></p>
          <p>🇬🇧 UK: <span class="text-slate-300 font-mono">HSBA.L · SHEL.L</span></p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = watchlist.map(w => `
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60" id="wl-card-${CSS.escape(w.yfSymbol)}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-base font-bold text-white truncate">${escHtml(w.name)}</p>
          <p class="text-xs font-mono text-slate-400">${escHtml(w.yfSymbol)}</p>
        </div>
        <button onclick="removeFromWatchlist('${escHtml(w.yfSymbol)}')"
          class="shrink-0 w-7 h-7 flex items-center justify-center text-slate-500 hover:text-red-400 rounded-full hover:bg-red-900/20 transition-colors text-lg leading-none">×</button>
      </div>
      <!-- Price row (filled async) -->
      <div id="wl-price-${CSS.escape(w.yfSymbol)}" class="mt-2 flex items-center justify-between">
        <span class="text-xs text-slate-500 animate-pulse">fetching price…</span>
      </div>
      <!-- Buttons -->
      <div class="mt-3 flex gap-2">
        <button onclick="openHistoryModal('${escHtml(w.name)}', '${escHtml(w.yfSymbol)}')"
          class="flex-1 flex items-center justify-center gap-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-600/30 rounded-xl py-2 text-xs font-semibold text-emerald-400 transition-colors active:scale-95">
          📈 Price History
        </button>
      </div>
    </div>`).join('');

  // Fetch prices async for each watchlist item
  if (!IS_LOCAL) {
    watchlist.forEach(w => fetchWatchlistQuote(w));
  }
}

async function fetchWatchlistQuote(w) {
  const el = document.getElementById(`wl-price-${CSS.escape(w.yfSymbol)}`);
  if (!el) return;

  try {
    const res  = await fetch(`/api/quote?yfSymbol=${encodeURIComponent(w.yfSymbol)}`, { headers: API_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = await res.json();

    if (q.error) throw new Error(q.error);

    const isPos  = (q.changePercent ?? 0) >= 0;
    const chgCls = isPos ? 'text-emerald-400' : 'text-red-400';
    const chgStr = (isPos ? '+' : '') + (q.changePercent ?? 0).toFixed(2) + '%';
    const arrow  = isPos ? '▲' : '▼';
    const priceFmt = q.price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—';

    el.innerHTML = `
      <div class="flex items-baseline gap-2">
        <span class="text-xl font-bold text-white">${priceFmt}</span>
        <span class="text-xs text-slate-400">${escHtml(q.currency ?? '')}</span>
      </div>
      <div class="text-right">
        <span class="text-sm font-semibold ${chgCls}">${arrow} ${chgStr}</span>
        <p class="text-xs text-slate-500">${escHtml(q.exchangeName ?? '')}</p>
      </div>`;
  } catch (e) {
    el.innerHTML = `<span class="text-xs text-red-400">⚠️ ${escHtml(e.message)}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════
// ── PRICE HISTORY MODAL ──────────────────────────────────
// ═══════════════════════════════════════════════════════════

function openHistoryModal(name, yfSymbol) {
  historyCtx = { name, yfSymbol };

  document.getElementById('hist-title').textContent    = name;
  document.getElementById('hist-subtitle').textContent = yfSymbol;
  document.getElementById('hist-price').textContent    = '—';
  document.getElementById('hist-change').textContent   = '';
  document.getElementById('hist-chart').classList.add('hidden');
  document.getElementById('hist-stats').classList.add('hidden');
  document.getElementById('hist-loading').textContent  = 'Loading chart…';
  document.getElementById('hist-loading').classList.remove('hidden');

  // Reset period buttons
  document.querySelectorAll('.hist-period-btn').forEach(b => {
    const active = b.dataset.period === '1mo';
    b.className = `hist-period-btn px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
      active ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`;
  });

  document.getElementById('modal-history').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Fetch current quote + 1mo history
  fetchHistoryQuote(yfSymbol);
  loadHistory('1mo');
}

function closeHistoryModal() {
  document.getElementById('modal-history').classList.add('hidden');
  document.body.style.overflow = '';
  historyCtx = null;
}

async function fetchHistoryQuote(yfSymbol) {
  try {
    const res = await fetch(`/api/quote?yfSymbol=${encodeURIComponent(yfSymbol)}`, { headers: API_HEADERS });
    if (!res.ok) return;
    const q = await res.json();
    if (q.error) return;

    const isPos  = (q.changePercent ?? 0) >= 0;
    const chgCls = isPos ? 'text-emerald-400' : 'text-red-400';
    const chgStr = (isPos ? '+' : '') + (q.changePercent ?? 0).toFixed(2) + '%  (' +
      (isPos ? '+' : '') + (q.change ?? 0).toFixed(2) + ')';

    const priceEl  = document.getElementById('hist-price');
    const changeEl = document.getElementById('hist-change');
    if (priceEl)  priceEl.textContent = (q.price ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (q.currency ?? '');
    if (changeEl) { changeEl.textContent = chgStr; changeEl.className = `text-sm font-semibold ${chgCls}`; }

    const subtitleEl = document.getElementById('hist-subtitle');
    if (subtitleEl && q.exchangeName) subtitleEl.textContent = `${yfSymbol} · ${q.exchangeName}`;
  } catch (_) {}
}

async function loadHistory(period) {
  if (!historyCtx) return;
  const { name, yfSymbol } = historyCtx;

  // Update active period button
  document.querySelectorAll('.hist-period-btn').forEach(b => {
    const active = b.dataset.period === period;
    b.className = `hist-period-btn px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
      active ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`;
  });

  // Show loading
  const loadingEl = document.getElementById('hist-loading');
  const chartEl   = document.getElementById('hist-chart');
  const statsEl   = document.getElementById('hist-stats');
  loadingEl.textContent = 'Loading chart…';
  loadingEl.classList.remove('hidden');
  chartEl.classList.add('hidden');
  statsEl.classList.add('hidden');

  try {
    const url = IS_LOCAL
      ? null
      : `/api/history?yfSymbol=${encodeURIComponent(yfSymbol)}&period=${period}`;

    if (!url) {
      loadingEl.textContent = 'Charts require Cloudflare deployment';
      return;
    }

    const res  = await fetch(url, { headers: API_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const rows = data.rows || [];
    if (rows.length < 2) { loadingEl.textContent = 'Not enough data for this period'; return; }

    drawHistoryChart(rows, data.currency ?? '');
    renderHistoryStats(rows, data.currency ?? '');

    loadingEl.classList.add('hidden');
    chartEl.classList.remove('hidden');
    statsEl.classList.remove('hidden');

  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
  }
}

// ── SVG Line Chart ────────────────────────────────────────

function drawHistoryChart(rows, currency) {
  const svg   = document.getElementById('hist-chart');
  if (!svg) return;

  const W = 400, H = 160;
  const padL = 8, padR = 8, padT = 10, padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const closes = rows.map(r => r.close).filter(v => v !== null);
  const minP   = Math.min(...closes);
  const maxP   = Math.max(...closes);
  const range  = maxP - minP || 1;

  const isUp = closes[closes.length - 1] >= closes[0];
  const color = isUp ? '#10b981' : '#ef4444';   // emerald / red

  // Scale helpers
  const sx = i  => padL + (i  / (rows.length - 1)) * plotW;
  const sy = p  => padT + ((maxP - p) / range) * plotH;

  // Build polyline points
  const pts = rows
    .filter(r => r.close !== null)
    .map((r, i) => `${sx(i)},${sy(r.close)}`)
    .join(' ');

  // Build area path (close it back to bottom)
  const firstX = sx(0);
  const lastX  = sx(rows.filter(r => r.close !== null).length - 1);
  const botY   = padT + plotH;
  const areaPath = `M ${firstX},${botY} L ${pts.split(' ').map((p, i) =>
    i === 0 ? `${firstX},${sy(rows.find(r => r.close !== null)?.close ?? minP)}` : p
  ).join(' L ')} L ${lastX},${botY} Z`;

  // Last point dot
  const lastRow = rows.filter(r => r.close !== null).at(-1);
  const dotX    = sx(rows.filter(r => r.close !== null).length - 1);
  const dotY    = sy(lastRow?.close ?? closes.at(-1));

  // X-axis labels (first + last date)
  const firstDate = rows[0]?.date?.slice(5) ?? '';
  const lastDate  = rows.at(-1)?.date?.slice(5) ?? '';

  svg.innerHTML = `
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>

    <!-- Area fill -->
    <path d="${buildAreaPath(rows, sx, sy, padT, plotH)}" fill="url(#chartFill)" />

    <!-- Line -->
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>

    <!-- Last price dot -->
    <circle cx="${dotX}" cy="${dotY}" r="4" fill="${color}" stroke="#0f172a" stroke-width="2"/>

    <!-- X-axis labels -->
    <text x="${padL}" y="${H - 3}" font-size="9" fill="#64748b">${escHtml(firstDate)}</text>
    <text x="${W - padR}" y="${H - 3}" font-size="9" fill="#64748b" text-anchor="end">${escHtml(lastDate)}</text>

    <!-- Y-axis labels -->
    <text x="${padL + 2}" y="${padT + 8}" font-size="9" fill="#64748b">${fmtChartPrice(maxP, currency)}</text>
    <text x="${padL + 2}" y="${padT + plotH - 2}" font-size="9" fill="#64748b">${fmtChartPrice(minP, currency)}</text>`;
}

function buildAreaPath(rows, sx, sy, padT, plotH) {
  const filtered = rows.filter(r => r.close !== null);
  if (!filtered.length) return '';
  const botY  = padT + plotH;
  const start = `M ${sx(0)},${botY}`;
  const line  = filtered.map((r, i) => `L ${sx(i)},${sy(r.close)}`).join(' ');
  const end   = `L ${sx(filtered.length - 1)},${botY} Z`;
  return `${start} ${line} ${end}`;
}

function fmtChartPrice(p, currency) {
  if (p >= 1000) return (p / 1000).toFixed(1) + 'K';
  return p.toFixed(p < 10 ? 2 : 0);
}

// ── History stats (below the chart) ──────────────────────

function renderHistoryStats(rows, currency) {
  const closes  = rows.map(r => r.close).filter(v => v !== null);
  const highs   = rows.map(r => r.high).filter(v => v !== null);
  const lows    = rows.map(r => r.low).filter(v => v !== null);
  const maxH    = Math.max(...highs);
  const minL    = Math.min(...lows);
  const first   = closes[0];
  const last    = closes.at(-1);
  const pChg    = first > 0 ? ((last - first) / first * 100) : 0;
  const isPos   = pChg >= 0;
  const pChgStr = (isPos ? '+' : '') + pChg.toFixed(2) + '%';

  const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  document.getElementById('hist-high').textContent        = fmt(maxH) + ' ' + currency;
  document.getElementById('hist-low').textContent         = fmt(minL) + ' ' + currency;
  document.getElementById('hist-start').textContent       = fmt(first) + ' ' + currency;
  const pChgEl = document.getElementById('hist-period-chg');
  pChgEl.textContent  = pChgStr;
  pChgEl.className    = `text-base font-bold mt-0.5 ${isPos ? 'text-emerald-400' : 'text-red-400'}`;

  // Last 10 rows table
  const tableEl = document.getElementById('hist-table');
  const last10  = rows.filter(r => r.close !== null).slice(-10).reverse();
  tableEl.innerHTML = last10.map(r => {
    const chg  = r.close - r.open;
    const up   = chg >= 0;
    return `<div class="flex justify-between items-center py-0.5 border-b border-slate-700/30">
      <span class="text-slate-400 w-20">${r.date}</span>
      <span class="text-slate-300 font-mono">${fmt(r.close)}</span>
      <span class="${up ? 'text-emerald-400' : 'text-red-400'} font-mono w-14 text-right">${(up ? '+' : '') + chg.toFixed(2)}</span>
      <span class="text-slate-500 text-right w-16">${(r.volume / 1e6).toFixed(1)}M</span>
    </div>`;
  }).join('');
}

// ── DEMO DATA ──────────────────────────────────────────────

async function loadDemoData() {
  const demos = [
    {
      symbol: 'VOO', market: 'US', name: 'Vanguard S&P 500 ETF',
      assetType: 'ETF', category: 'Core ETF', riskLevel: 'Medium',
      quantity: 0.5, averageBuyPrice: 450, buyCurrency: 'USD',
      fxRate: 36.5, totalCostTHB: 8212.50,
      currentPrice: 480, currentPriceCurrency: 'USD', buyDate: '2026-01-15',
      learningNote: 'Tracks the S&P 500 — top 500 US companies. Great diversification without picking individual stocks. Grows when the US economy grows.',
    },
    {
      symbol: 'QQQM', market: 'US', name: 'Invesco Nasdaq 100 ETF',
      assetType: 'ETF', category: 'Growth ETF', riskLevel: 'Medium-High',
      quantity: 0.3, averageBuyPrice: 190, buyCurrency: 'USD',
      fxRate: 36.5, totalCostTHB: 2083.50,
      currentPrice: 205, currentPriceCurrency: 'USD', buyDate: '2026-02-01',
      learningNote: 'Tracks Nasdaq 100 — tech-heavy with Apple, Microsoft, Nvidia. Higher growth potential than VOO but also more volatile. Best held long-term.',
    },
    {
      symbol: 'AAPL', market: 'US', name: 'Apple Inc.',
      assetType: 'Stock', category: 'Individual Stock', riskLevel: 'Medium',
      quantity: 0.25, averageBuyPrice: 185, buyCurrency: 'USD',
      fxRate: 36.5, totalCostTHB: 1690.63,
      currentPrice: 195, currentPriceCurrency: 'USD', buyDate: '2026-03-10',
      learningNote: 'Apple earns from iPhone, Mac, iPad and services (App Store, iCloud, Apple Pay). Very strong ecosystem — customers rarely switch brands.',
    },
    {
      symbol: 'ADVANC', market: 'TH', name: 'Advanced Info Service (AIS)',
      assetType: 'Stock', category: 'Dividend / Defensive', riskLevel: 'Medium',
      quantity: 10, averageBuyPrice: 225, buyCurrency: 'THB',
      fxRate: 1, totalCostTHB: 2250,
      currentPrice: 240, currentPriceCurrency: 'THB', buyDate: '2026-01-20',
      learningNote: 'AIS is Thailand\'s #1 telecom with 40M+ customers. Pays regular dividends. Defensive business — people keep paying for phone plans even in a recession.',
    },
    {
      symbol: 'CPALL', market: 'TH', name: 'CP All (7-Eleven Thailand)',
      assetType: 'Stock', category: 'Consumer', riskLevel: 'Medium',
      quantity: 20, averageBuyPrice: 58, buyCurrency: 'THB',
      fxRate: 1, totalCostTHB: 1160,
      currentPrice: 55, currentPriceCurrency: 'THB', buyDate: '2026-02-15',
      learningNote: '',
    },
  ];

  portfolio.holdings = demos.map(d => ({
    id: generateId(), ...d,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  savePortfolio();
  renderCurrentScreen();
  showToast('Loaded 5 sample holdings 🎉');
}

async function clearAllData() {
  portfolio = { holdings: [], lastUpdated: null };
  savePortfolio();
  renderCurrentScreen();
  showToast('All data cleared');
}

// ── NAVIGATION ─────────────────────────────────────────────

function navigateTo(screen) {
  currentScreen = screen;

  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  document.getElementById(`screen-${screen}`)?.classList.remove('hidden');

  document.querySelectorAll('.nav-btn[data-screen]').forEach(btn => {
    const active = btn.dataset.screen === screen;
    btn.classList.toggle('text-emerald-400', active);
    btn.classList.toggle('text-slate-500',   !active);
  });

  document.getElementById('main-scroll')?.scrollTo(0, 0);
  renderCurrentScreen();
}

function renderCurrentScreen() {
  if      (currentScreen === 'dashboard') renderDashboard();
  else if (currentScreen === 'portfolio') renderPortfolio();
  else if (currentScreen === 'markets')   renderMarkets();
  else if (currentScreen === 'coach')     renderCoach();
  else if (currentScreen === 'settings')  renderSettings();
}

// ── RENDER: DASHBOARD ──────────────────────────────────────

function renderDashboard() {
  const m   = calcPortfolio();
  const W   = checkRules(m);
  const { totalCostTHB, totalValueTHB, totalGainLossTHB, totalGainLossPercent,
          best, worst, allocationByMarket, allocationByAssetType } = m;

  if (!m.holdings.length) {
    document.getElementById('dash-summary').innerHTML = `
      <div class="text-center py-16 space-y-4">
        <div class="text-7xl">📈</div>
        <div>
          <h3 class="text-xl font-bold text-white">Start Arthy's First Portfolio</h3>
          <p class="text-slate-400 text-sm mt-1">Add stocks or ETFs to begin your investment learning journey</p>
        </div>
        <div class="flex flex-col gap-3 items-center">
          <button onclick="openAddForm()"
            class="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3 rounded-2xl font-semibold transition-colors active:scale-95">
            + Add First Holding
          </button>
          <button onclick="loadDemoData()" class="text-slate-400 text-sm underline underline-offset-2">
            or load sample data
          </button>
        </div>
      </div>`;
    ['dash-performers','dash-warnings','dash-allocation'].forEach(id =>
      (document.getElementById(id).innerHTML = ''));
    return;
  }

  const isPos = totalGainLossTHB >= 0;
  const gcls  = isPos ? 'text-emerald-400' : 'text-red-400';
  const gSign = isPos ? '+' : '';
  const gIcon = isPos ? '▲' : '▼';

  document.getElementById('dash-summary').innerHTML = `
    <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-5 border border-slate-700/60">
      <p class="text-slate-400 text-sm mb-1">Current Portfolio Value</p>
      <p class="text-4xl font-bold text-white tracking-tight">${fmt(totalValueTHB)}</p>
      <p class="text-sm ${gcls} mt-2 font-medium">
        ${gIcon} ${fmt(Math.abs(totalGainLossTHB))}
        <span class="text-xs ml-1">(${gSign}${totalGainLossPercent.toFixed(2)}%)</span>
      </p>
      <p class="text-xs text-slate-500 mt-1">Cost basis ${fmt(totalCostTHB)}</p>
      <div class="mt-3 flex items-center justify-between gap-2 border-t border-slate-700/40 pt-3">
        <span class="text-xs text-slate-500">
          🕐 Prices refreshed: <span class="text-slate-400 font-medium">${lastRefreshLog ? timeAgo(lastRefreshLog.refreshedAt) : (IS_LOCAL ? 'manual only' : 'never')}</span>
        </span>
        ${!IS_LOCAL ? `<button onclick="refreshAllPrices(false)" class="text-xs text-emerald-400 hover:text-emerald-300 active:scale-95 transition-all">⟳ Refresh</button>` : ''}
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
        <p class="text-slate-400 text-xs mb-1">Total Cost</p>
        <p class="text-lg font-bold text-white">${fmt(totalCostTHB)}</p>
      </div>
      <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
        <p class="text-slate-400 text-xs mb-1">Gain / Loss</p>
        <p class="text-lg font-bold ${gcls}">${gSign}${fmt(totalGainLossTHB)}</p>
      </div>
    </div>`;

  // Performers
  let perfHTML = '';
  if (best || worst) {
    perfHTML = `<div class="grid grid-cols-2 gap-3">`;
    if (best) perfHTML += `
      <div class="bg-slate-800/80 rounded-2xl p-4 border border-emerald-500/20">
        <p class="text-xs text-slate-400 mb-1">⭐ Best Performer</p>
        <p class="text-base font-bold text-white">${best.symbol}</p>
        <p class="text-sm text-emerald-400 font-medium">${best.gainLossPercent >= 0 ? '+' : ''}${best.gainLossPercent.toFixed(1)}%</p>
      </div>`;
    if (worst && worst.id !== best?.id) perfHTML += `
      <div class="bg-slate-800/80 rounded-2xl p-4 border border-red-500/20">
        <p class="text-xs text-slate-400 mb-1">📉 Needs Review</p>
        <p class="text-base font-bold text-white">${worst.symbol}</p>
        <p class="text-sm text-red-400 font-medium">${worst.gainLossPercent >= 0 ? '+' : ''}${worst.gainLossPercent.toFixed(1)}%</p>
      </div>`;
    perfHTML += `</div>`;
  }
  document.getElementById('dash-performers').innerHTML = perfHTML;

  // Warnings
  const warnColors = { danger: 'border-red-500/30 bg-red-900/10', warning: 'border-amber-500/30 bg-amber-900/10', info: 'border-blue-500/30 bg-blue-900/10' };
  const warnIcons  = { danger: '🚨', warning: '⚠️', info: 'ℹ️' };
  let warnHTML = '';
  if (W.length) {
    warnHTML = `<div class="space-y-2"><p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Warnings</p>`;
    W.forEach(w => { warnHTML += `
      <div class="rounded-2xl p-3 border ${warnColors[w.level] || warnColors.warning}">
        <p class="text-sm font-semibold text-white">${warnIcons[w.level]} ${w.title}</p>
        <p class="text-xs text-slate-300 mt-0.5 leading-relaxed">${w.message}</p>
      </div>`; });
    warnHTML += `</div>`;
  }
  document.getElementById('dash-warnings').innerHTML = warnHTML;

  // Allocation
  const barColors = { US: 'bg-blue-500', TH: 'bg-orange-400', ETF: 'bg-emerald-500', Stock: 'bg-blue-400', Bond: 'bg-purple-400', Crypto: 'bg-yellow-400' };
  const mkBars = (items, title) => {
    if (!items.length) return '';
    return `<div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-xs text-slate-400 mb-3">${title}</p>
      <div class="space-y-3">
        ${items.map(item => `
          <div>
            <div class="flex justify-between text-xs mb-1.5">
              <span class="text-slate-300">${item.label}</span>
              <span class="font-semibold text-white">${item.pct.toFixed(1)}%</span>
            </div>
            <div class="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div class="h-full ${barColors[item.label] || 'bg-slate-400'} rounded-full" style="width:${Math.min(item.pct,100)}%"></div>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">${fmt(item.value)}</p>
          </div>`).join('')}
      </div>
    </div>`;
  };

  document.getElementById('dash-allocation').innerHTML = `
    <div class="space-y-3">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Portfolio Allocation</p>
      ${mkBars(allocationByMarket, 'By Market')}
      ${mkBars(allocationByAssetType, 'By Asset Type')}
    </div>`;
}

// ── RENDER: PORTFOLIO ──────────────────────────────────────

function renderPortfolio() {
  const m    = calcPortfolio();
  const cont = document.getElementById('portfolio-list');
  updatePortfolioRefreshLabel();

  if (!m.holdings.length) {
    cont.innerHTML = `
      <div class="text-center py-16 space-y-3">
        <div class="text-5xl">💼</div>
        <p class="text-slate-400">No holdings yet</p>
        <button onclick="openAddForm()" class="bg-emerald-500 text-white px-6 py-3 rounded-2xl font-medium active:scale-95">
          + Add First Holding
        </button>
      </div>`;
    return;
  }

  cont.innerHTML = m.holdings.map(h => {
    const isPos    = h.gainLossTHB >= 0;
    const gcls     = isPos ? 'text-emerald-400' : 'text-red-400';
    const gSign    = isPos ? '+' : '';
    const pct      = m.totalValueTHB > 0 ? (h.currentValueTHB / m.totalValueTHB * 100).toFixed(1) : '0.0';
    const mktBadge = h.market === 'US' ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300';
    const hasNote  = (h.learningNote || '').trim().length > 0;
    const noteSnip = hasNote ? h.learningNote.slice(0, 90) + (h.learningNote.length > 90 ? '…' : '') : '';

    return `
      <div class="bg-slate-800/80 rounded-2xl border border-slate-700/60 overflow-hidden">
        <div class="p-4 space-y-3">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-lg font-bold text-white">${h.symbol}</span>
                <span class="text-xs px-2 py-0.5 rounded-full ${mktBadge}">${h.market}</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">${h.assetType}</span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5 truncate">${h.name}</p>
              <p class="text-xs text-slate-500">${h.category} · ${pct}% of portfolio</p>
            </div>
            <div class="text-right ml-2 shrink-0">
              <p class="text-base font-bold ${gcls}">${gSign}${h.gainLossPercent.toFixed(1)}%</p>
              <p class="text-xs ${gcls}">${gSign}${fmt(h.gainLossTHB)}</p>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div class="bg-slate-900/60 rounded-xl p-2.5 text-center">
              <p class="text-xs text-slate-500 mb-0.5">Qty</p>
              <p class="text-sm font-semibold text-white">${h.quantity}</p>
            </div>
            <div class="bg-slate-900/60 rounded-xl p-2.5 text-center">
              <p class="text-xs text-slate-500 mb-0.5">Cost</p>
              <p class="text-sm font-semibold text-white">${fmt(h.totalCostTHB)}</p>
            </div>
            <div class="bg-slate-900/60 rounded-xl p-2.5 text-center">
              <p class="text-xs text-slate-500 mb-0.5">Value</p>
              <p class="text-sm font-semibold text-white">${fmt(h.currentValueTHB)}</p>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>Current: <span class="text-white font-medium">${h.currentPrice} ${h.currentPriceCurrency}</span></span>
            <span>Avg buy: ${h.averageBuyPrice} ${h.buyCurrency}</span>
          </div>

          ${h.isUSstock ? `
          <div class="bg-slate-900/60 rounded-xl p-3 space-y-1.5 border border-slate-700/40">
            <p class="text-xs font-semibold text-slate-400">P&L Breakdown</p>
            <div class="flex justify-between text-xs">
              <span class="text-slate-400">📈 Stock price</span>
              <span class="${h.stockPnLTHB >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold">
                ${h.stockPnLTHB >= 0 ? '+' : ''}${fmt(h.stockPnLTHB)}
                <span class="text-slate-500 font-normal ml-1">(${h.stockPnLUSD >= 0 ? '+' : ''}$${h.stockPnLUSD.toFixed(2)})</span>
              </span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-slate-400">💱 FX rate</span>
              <span class="${h.fxPnLTHB >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold">
                ${h.fxPnLTHB >= 0 ? '+' : ''}${fmt(h.fxPnLTHB)}
                <span class="text-slate-500 font-normal ml-1">(${h.buyFX.toFixed(2)} → ${h.curFX.toFixed(2)} ฿/$)</span>
              </span>
            </div>
          </div>` : ''}

          ${hasNote ? `
          <div class="bg-slate-900/60 rounded-xl p-3 border-l-2 border-emerald-500/50">
            <p class="text-xs text-emerald-400 font-medium mb-0.5">📓 Learning Note</p>
            <p class="text-xs text-slate-300 leading-relaxed">${noteSnip}</p>
          </div>` : `
          <p class="text-xs text-slate-500">📓 No learning note yet</p>`}
        </div>

        <div class="border-t border-slate-700/60 px-4 py-2.5 flex gap-2 justify-end">
          <button onclick="openUpdatePriceModal('${h.id}')"
            class="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors active:scale-95">
            💹 Price
          </button>
          <button onclick="openEditForm('${h.id}')"
            class="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors active:scale-95">
            ✏️ Edit
          </button>
          <button onclick="confirmDelete('${h.id}', '${h.symbol}')"
            class="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-400 transition-colors active:scale-95">
            🗑️
          </button>
        </div>
      </div>`;
  }).join('');
}

// ── RENDER: COACH ──────────────────────────────────────────

function renderCoach() {
  const s    = generateCoachSummary();
  const cont = document.getElementById('coach-content');

  const R    = 36;
  const circ = 2 * Math.PI * R;
  const off  = circ - (s.healthScore / 100) * circ;
  const ringColor = s.healthScore >= 70 ? '#10b981' : s.healthScore >= 40 ? '#f59e0b' : '#ef4444';
  const textColor = s.healthScore >= 70 ? 'text-emerald-400' : s.healthScore >= 40 ? 'text-amber-400' : 'text-red-400';

  cont.innerHTML = `
    <div class="bg-slate-800/80 rounded-3xl p-5 border border-slate-700/60 text-center">
      <p class="text-sm text-slate-400 mb-4">Portfolio Health Score</p>
      <div class="relative inline-flex items-center justify-center w-32 h-32 mb-4">
        <svg class="w-32 h-32 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="${R}" fill="none" stroke="#1e293b" stroke-width="8"/>
          <circle cx="40" cy="40" r="${R}" fill="none"
            stroke="${ringColor}" stroke-width="8"
            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
            stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-4xl font-bold ${textColor}">${s.healthScore}</span>
          <span class="text-xs text-slate-500">/100</span>
        </div>
      </div>
      <p class="text-sm text-slate-300 leading-relaxed">${s.lessonOfMonth}</p>
    </div>

    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-emerald-400 mb-3">✅ What's Working Well</p>
      <ul class="space-y-2">
        ${s.whatWentWell.map(item => `
          <li class="flex gap-2.5 text-sm text-slate-300">
            <span class="text-emerald-500 shrink-0 mt-0.5">•</span>
            <span class="leading-relaxed">${item}</span>
          </li>`).join('')}
      </ul>
    </div>

    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-amber-400 mb-3">🔍 What to Review</p>
      <ul class="space-y-2">
        ${s.whatToReview.map(item => `
          <li class="flex gap-2.5 text-sm text-slate-300">
            <span class="text-amber-500 shrink-0 mt-0.5">•</span>
            <span class="leading-relaxed">${item}</span>
          </li>`).join('')}
      </ul>
    </div>

    ${s.riskNote ? `
    <div class="bg-blue-900/20 rounded-2xl p-4 border border-blue-500/20">
      <p class="text-sm font-semibold text-blue-400 mb-2">🌏 Risk to Know</p>
      <p class="text-sm text-slate-300 leading-relaxed">${s.riskNote}</p>
    </div>` : ''}

    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-purple-400 mb-3">💭 Questions for This Month</p>
      <div class="space-y-2">
        ${s.questions.map((q, i) => `
          <div class="flex gap-3 bg-slate-900/60 rounded-xl p-3">
            <span class="text-purple-400 font-bold text-sm shrink-0">${i + 1}</span>
            <span class="text-sm text-slate-300 leading-relaxed">${q}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- ── Phase 4: Claude AI Coach ─────────────────────── -->
    <div class="bg-gradient-to-br from-purple-900/30 to-slate-800/80 rounded-2xl p-4 border border-purple-500/30">
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm font-semibold text-purple-300">✨ Claude AI Coach</p>
        <span class="text-[10px] text-purple-400/70 bg-purple-500/10 px-2 py-0.5 rounded-full">Phase 4</span>
      </div>
      <p class="text-xs text-slate-400 leading-relaxed mb-3">
        ให้ Claude ช่วยสรุปพัฒนาการการลงทุนเป็นภาษาไทยแบบเฉพาะตัว (เพื่อการเรียนรู้ ไม่ใช่คำแนะนำซื้อขาย)
      </p>
      ${IS_LOCAL
        ? `<p class="text-xs text-amber-400/80">⚠️ ใช้ได้เมื่อ deploy บน Cloudflare แล้วเท่านั้น (ต้องตั้งค่า ANTHROPIC_API_KEY)</p>`
        : `<button id="ai-coach-btn" onclick="requestAICoach()"
             class="w-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-xl py-2.5 transition">
             🤖 ขอ Claude วิเคราะห์เดือนนี้
           </button>`}
      <div id="ai-coach-result" class="mt-3"></div>
    </div>

    <div class="bg-amber-900/10 rounded-2xl p-4 border border-amber-500/20 text-center space-y-1">
      <p class="text-xs text-amber-400 font-medium">⚠️ For learning only. Not investment advice.</p>
    </div>`;
}

// ── PHASE 4: CLAUDE AI COACH ───────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function requestAICoach() {
  const btn = document.getElementById('ai-coach-btn');
  const out = document.getElementById('ai-coach-result');
  if (!out) return;

  const m = calcPortfolio();
  if (!m.holdings.length) {
    out.innerHTML = '<p class="text-xs text-amber-400">ยังไม่มีรายการถือครอง — เพิ่มหุ้นก่อนเพื่อให้ Claude วิเคราะห์</p>';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Claude กำลังวิเคราะห์…'; }
  out.innerHTML = '<p class="text-xs text-slate-400">กำลังส่งข้อมูลให้ Claude…</p>';

  // Build a minimal, non-PII payload — symbols + ratios only.
  const total = m.totalValueTHB || 0;
  const payload = {
    month: new Date().toISOString().slice(0, 7),
    portfolio: {
      totalValueTHB       : total,
      totalGainLossPercent: m.totalGainLossPercent,
      holdings: m.holdings.map(h => ({
        symbol         : h.symbol,
        market         : h.market,
        assetType      : h.assetType,
        category       : h.category,
        allocationPct  : total > 0 ? (h.currentValueTHB / total) * 100 : 0,
        gainLossPercent: h.gainLossPercent,
        hasNote        : !!(h.learningNote || '').trim(),
      })),
    },
  };

  try {
    const s = await apiCoachMonthlySummary(payload);
    renderAICoachResult(s);
  } catch (err) {
    out.innerHTML = `<p class="text-xs text-red-400">❌ ${err.message}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 ขอ Claude วิเคราะห์อีกครั้ง'; }
  }
}

function renderAICoachResult(s) {
  const out = document.getElementById('ai-coach-result');
  if (!out) return;

  const score      = typeof s.healthScore === 'number' ? s.healthScore : null;
  const scoreColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-red-400';

  const list = (items, color) => (items || []).map(item => `
    <li class="flex gap-2 text-xs text-slate-300">
      <span class="${color} shrink-0">•</span>
      <span class="leading-relaxed">${escapeHtml(item)}</span>
    </li>`).join('');

  out.innerHTML = `
    <div class="space-y-3 bg-slate-900/50 rounded-xl p-3 border border-purple-500/20">
      ${score !== null ? `
        <div class="flex items-center gap-2">
          <span class="text-2xl font-bold ${scoreColor}">${score}</span>
          <span class="text-xs text-slate-500">/100 · Claude health score</span>
        </div>` : ''}
      ${s.summary ? `<p class="text-xs text-slate-200 leading-relaxed">${escapeHtml(s.summary)}</p>` : ''}
      ${(s.whatWentWell || []).length ? `
        <div>
          <p class="text-xs font-semibold text-emerald-400 mb-1">✅ ทำได้ดี</p>
          <ul class="space-y-1">${list(s.whatWentWell, 'text-emerald-500')}</ul>
        </div>` : ''}
      ${(s.whatToReview || []).length ? `
        <div>
          <p class="text-xs font-semibold text-amber-400 mb-1">🔍 สิ่งที่ควรทบทวน</p>
          <ul class="space-y-1">${list(s.whatToReview, 'text-amber-500')}</ul>
        </div>` : ''}
      ${(s.questions || []).length ? `
        <div>
          <p class="text-xs font-semibold text-purple-400 mb-1">💭 คำถามชวนคิด</p>
          <ul class="space-y-1">${list(s.questions, 'text-purple-400')}</ul>
        </div>` : ''}
      <p class="text-[10px] text-slate-500 pt-1">สร้างโดย Claude · เพื่อการเรียนรู้เท่านั้น ไม่ใช่คำแนะนำการลงทุน</p>
    </div>`;
}

// ── RENDER: SETTINGS ───────────────────────────────────────

function renderSettings() {
  const holdingCount = portfolio.holdings.length;
  const storageMode  = IS_LOCAL ? 'LocalStorage (Phase 1)' : 'Cloudflare D1 (Phase 3)';
  const storageIcon  = IS_LOCAL ? '💾' : '☁️';

  document.getElementById('settings-content').innerHTML = `

    <!-- ── App info ─────────────────────────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-5 border border-slate-700/60 text-center">
      <div class="text-4xl mb-2">📈</div>
      <p class="text-lg font-bold text-white">Arthy Investment Coach</p>
      <p class="text-xs text-slate-400 mt-1">v${APP_VERSION} · Learn investing through a simulated portfolio</p>
      <div class="mt-3 grid grid-cols-2 gap-3 text-center">
        <div class="bg-slate-900/50 rounded-xl p-2.5">
          <p class="text-xl font-bold text-emerald-400">${holdingCount}</p>
          <p class="text-xs text-slate-400">Local Holdings</p>
        </div>
        <div class="bg-slate-900/50 rounded-xl p-2.5">
          <p class="text-xs font-medium text-white leading-tight">${storageIcon} ${storageMode}</p>
          <p class="text-xs text-slate-400 mt-0.5" id="lbl-last-local-save">—</p>
        </div>
      </div>
    </div>

    <!-- ── Cloud Data Status ─────────────────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-semibold text-white">☁️ Cloud Data (Cloudflare)</p>
        <span id="cloud-status-dot" class="w-2 h-2 rounded-full bg-slate-600"></span>
      </div>

      <!-- D1 row -->
      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="bg-slate-900/60 rounded-xl p-3">
          <p class="text-xs text-slate-400 mb-0.5">D1 Holdings</p>
          <p class="text-lg font-bold text-emerald-400" id="d1-holdings-count">
            <span class="text-slate-500 text-xs">loading…</span>
          </p>
          <p class="text-xs text-slate-500" id="d1-last-updated">—</p>
        </div>
        <div class="bg-slate-900/60 rounded-xl p-3">
          <p class="text-xs text-slate-400 mb-0.5">KV Cache</p>
          <p class="text-sm font-medium text-white" id="kv-status">
            <span class="text-slate-500 text-xs">loading…</span>
          </p>
        </div>
      </div>

      <!-- Last refresh row -->
      <div class="bg-slate-900/60 rounded-xl p-3 mb-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-xs text-slate-400 mb-0.5">Last Price Refresh</p>
            <p class="text-sm font-semibold text-white" id="lbl-last-refresh-time">
              <span class="text-slate-500 text-xs">loading…</span>
            </p>
            <p class="text-xs text-slate-500 mt-0.5" id="lbl-last-refresh-ago"></p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs text-slate-400 mb-0.5">Updated</p>
            <p class="text-sm font-semibold text-emerald-400" id="lbl-last-refresh-count">—</p>
          </div>
        </div>
      </div>

      <!-- Per-symbol results table -->
      <div id="refresh-results-table" class="hidden">
        <p class="text-xs text-slate-400 font-semibold mb-1.5">Last Refresh Results</p>
        <div id="refresh-results-rows" class="space-y-1"></div>
      </div>
    </div>

    <!-- ── Refresh button ────────────────────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-white mb-3">Price Update</p>
      <div class="space-y-2">

        <button id="btn-refresh-prices"
          onclick="refreshAllPrices(false).then(()=>loadAndRenderCloudStatus())"
          class="w-full flex items-center gap-3 rounded-2xl p-3.5 transition-colors active:scale-95 text-left
            ${IS_LOCAL ? 'bg-slate-700/30 opacity-50 cursor-not-allowed' : 'bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-600/40'}"
          ${IS_LOCAL ? 'disabled' : ''}>
          <span class="text-2xl shrink-0">🔄</span>
          <div>
            <p class="text-sm font-semibold text-white">Refresh US Prices</p>
            <p class="text-xs text-slate-400">${IS_LOCAL ? 'Available on Cloudflare deployment' : 'US + TH stocks via Yahoo Finance · KV cached 15 min'}</p>
          </div>
        </button>

        <button id="btn-force-refresh"
          onclick="refreshAllPrices(true).then(()=>loadAndRenderCloudStatus())"
          class="w-full flex items-center gap-3 rounded-2xl p-3.5 transition-colors active:scale-95 text-left
            ${IS_LOCAL ? 'bg-slate-700/30 opacity-50 cursor-not-allowed' : 'bg-slate-700/60 hover:bg-slate-700 border border-slate-600/40'}"
          ${IS_LOCAL ? 'disabled' : ''}>
          <span class="text-2xl shrink-0">⚡</span>
          <div>
            <p class="text-sm font-semibold text-white">Force Refresh (Skip Cache)</p>
            <p class="text-xs text-slate-400">${IS_LOCAL ? 'Available on Cloudflare deployment' : 'Bypass KV cache — hits Finnhub directly'}</p>
          </div>
        </button>

      </div>
    </div>

    <!-- ── Data management (export only) ───────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-white mb-3">Data Management</p>
      <div class="space-y-2">

        <button onclick="exportData()"
          class="w-full flex items-center gap-3 bg-slate-700/60 hover:bg-slate-700 rounded-2xl p-3.5 transition-colors active:scale-95 text-left">
          <span class="text-2xl shrink-0">📤</span>
          <div>
            <p class="text-sm font-medium text-white">Export Data (JSON)</p>
            <p class="text-xs text-slate-400">Save portfolio backup to a file</p>
          </div>
        </button>

      </div>
    </div>

    <!-- ── AI Coach (moved from nav) ────────────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-semibold text-white">🤖 Portfolio Coach</p>
        <button onclick="navigateTo('coach')" class="text-xs text-emerald-400 hover:text-emerald-300">Full Analysis →</button>
      </div>
      <div id="settings-coach-mini" class="text-xs text-slate-400">Loading analysis…</div>
    </div>

    <!-- ── Road map ───────────────────────────────────── -->
    <div class="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/60">
      <p class="text-sm font-semibold text-white mb-3">🛣️ Road Map</p>
      <div class="space-y-2.5">
        ${[
          ['✅', 'Phase 1', 'LocalStorage — fully working', 'text-emerald-400'],
          ['✅', 'Phase 2', 'Yahoo Finance — US + TH price auto-fetch, history', 'text-emerald-400'],
          [IS_LOCAL ? '⏳' : '✅', 'Phase 3', 'Cloudflare D1 — permanent cloud storage', IS_LOCAL ? 'text-slate-500' : 'text-emerald-400'],
          [IS_LOCAL ? '⏳' : '✅', 'Phase 4', 'Claude AI Coach via Cloudflare Worker', IS_LOCAL ? 'text-slate-500' : 'text-emerald-400'],
        ].map(([icon, phase, desc, cls]) => `
          <div class="flex items-start gap-3">
            <span class="shrink-0 mt-0.5">${icon}</span>
            <div>
              <span class="text-xs font-semibold ${cls}">${phase}</span>
              <span class="text-xs text-slate-400 ml-1.5">${desc}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="bg-amber-900/10 rounded-2xl p-4 border border-amber-500/20 space-y-2">
      <p class="text-xs font-semibold text-amber-400">⚠️ Disclaimer</p>
      <p class="text-xs text-slate-400 leading-relaxed">
        This app is for educational purposes only. It is not a real brokerage account.
        Real investments are managed by Arthy's parent through Dime.
        Prices shown are from Yahoo Finance and cached for 15 minutes.
      </p>
    </div>`;

  // Fill local save time
  const ls = portfolio.lastUpdated;
  const lblLocal = document.getElementById('lbl-last-local-save');
  if (lblLocal) lblLocal.textContent = ls ? 'Saved ' + timeAgo(ls) : 'Not saved yet';

  // Fill from cached refresh log immediately, then fetch fresh status
  if (lastRefreshLog) renderRefreshLog(lastRefreshLog);
  if (!IS_LOCAL) loadAndRenderCloudStatus();

  // Mini coach summary in settings
  renderSettingsCoachMini();
}

function renderSettingsCoachMini() {
  const el = document.getElementById('settings-coach-mini');
  if (!el) return;
  const m = calcPortfolio();
  if (!m.holdings.length) {
    el.innerHTML = '<p class="text-slate-500">No holdings yet — add stocks to get analysis.</p>';
    return;
  }
  const summary  = generateCoachSummary();
  const score    = summary.healthScore;
  const warnings = checkRules(m);
  const scoreColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-yellow-400' : 'text-red-400';
  el.innerHTML = `
    <div class="flex items-center gap-3 mb-2">
      <div class="text-2xl font-bold ${scoreColor}">${score}<span class="text-sm font-normal text-slate-500">/100</span></div>
      <div>
        <p class="text-white font-medium text-xs">Health Score</p>
        <p class="text-slate-500 text-xs">${score >= 70 ? 'Good diversification' : score >= 40 ? 'Some risks' : 'Needs attention'}</p>
      </div>
    </div>
    ${warnings.length > 0
      ? `<p class="text-yellow-400 text-xs">⚠️ ${warnings.length} warning${warnings.length > 1 ? 's' : ''} — tap Full Analysis</p>`
      : `<p class="text-emerald-400 text-xs">✅ No warnings — portfolio looks healthy</p>`}`;
}

// Fill the Cloud Data card from /api/sync-status
async function loadAndRenderCloudStatus() {
  const status = await loadSyncStatus();
  if (!status) {
    const dot = document.getElementById('cloud-status-dot');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-500';
    return;
  }

  // Green dot
  const dot = document.getElementById('cloud-status-dot');
  if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400';

  // D1 count
  const countEl = document.getElementById('d1-holdings-count');
  if (countEl) countEl.innerHTML = status.d1.available
    ? `<span class="text-emerald-400 text-lg font-bold">${status.d1.holdingsCount}</span>`
    : '<span class="text-red-400 text-xs">Unavailable</span>';

  const updEl = document.getElementById('d1-last-updated');
  if (updEl) updEl.textContent = status.d1.lastUpdated
    ? 'Updated ' + timeAgo(status.d1.lastUpdated)
    : '—';

  // KV
  const kvEl = document.getElementById('kv-status');
  if (kvEl) kvEl.innerHTML = status.kvAvailable
    ? '<span class="text-emerald-400 text-sm">✓ Connected</span>'
    : '<span class="text-slate-500 text-xs">Not configured</span>';

  // Last refresh log
  if (status.lastRefresh) {
    saveLastRefreshLog(status.lastRefresh);
    renderRefreshLog(status.lastRefresh);
  } else {
    const t = document.getElementById('lbl-last-refresh-time');
    const a = document.getElementById('lbl-last-refresh-ago');
    if (t) t.textContent = 'Never refreshed';
    if (a) a.textContent = 'Press Refresh US Prices to start';
  }
}

// Render the last-refresh section from a log object
function renderRefreshLog(log) {
  const timeEl  = document.getElementById('lbl-last-refresh-time');
  const agoEl   = document.getElementById('lbl-last-refresh-ago');
  const countEl = document.getElementById('lbl-last-refresh-count');
  const tableEl = document.getElementById('refresh-results-table');
  const rowsEl  = document.getElementById('refresh-results-rows');

  if (!log || !timeEl) return;

  const dt = new Date(log.refreshedAt);
  if (timeEl) timeEl.textContent = dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  if (agoEl)  agoEl.textContent  = timeAgo(log.refreshedAt);
  if (countEl) countEl.textContent = `${log.updatedCount} updated · ${log.skippedCount} skipped`;

  if (tableEl && rowsEl && log.results?.length) {
    tableEl.classList.remove('hidden');
    rowsEl.innerHTML = log.results.map(r => {
      const isOk   = r.status === 'updated';
      const chg    = r.changePercent ?? 0;
      const chgCls = chg >= 0 ? 'text-emerald-400' : 'text-red-400';
      const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
      return `
        <div class="flex items-center justify-between bg-slate-900/50 rounded-xl px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="text-xs">${isOk ? '✅' : '❌'}</span>
            <span class="text-sm font-semibold text-white">${escHtml(r.symbol)}</span>
            ${isOk ? `<span class="text-xs text-slate-400">$${r.price?.toFixed(2) ?? '—'}</span>` : ''}
          </div>
          <div class="text-right">
            ${isOk
              ? `<span class="text-xs font-semibold ${chgCls}">${chgStr}</span>
                 <p class="text-xs text-slate-500">${r.source === 'cache' ? 'cached' : 'live'}</p>`
              : `<span class="text-xs text-red-400">${escHtml(r.reason || r.status)}</span>`
            }
          </div>
        </div>`;
    }).join('');
  }
}

// ── TIME AGO helper ───────────────────────────────────────
function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins   = Math.floor(diffMs / 60000);
  const hours  = Math.floor(mins / 60);
  const days   = Math.floor(hours / 24);
  if (mins  <  1) return 'just now';
  if (mins  <  60) return `${mins} min ago`;
  if (hours <  24) return `${hours} hr ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ── FORM: ADD / EDIT ───────────────────────────────────────

function openAddForm() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Holding';
  renderHoldingForm(null);
  document.getElementById('modal-holding').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function openEditForm(id) {
  editingId = id;
  const h = portfolio.holdings.find(h => h.id === id);
  if (!h) return;
  document.getElementById('modal-title').textContent = `Edit ${h.symbol}`;
  renderHoldingForm(h);
  document.getElementById('modal-holding').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-holding').classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
}

function renderHoldingForm(h) {
  h = h || {};
  const isUS = (h.market || 'US') === 'US';

  document.getElementById('holding-form').innerHTML = `
    <div class="space-y-3">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Basic Info</p>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Ticker Symbol *</label>
          <input type="text" id="f-symbol" value="${h.symbol || ''}" placeholder="VOO / AAPL"
            class="input uppercase" oninput="this.value=this.value.toUpperCase()">
        </div>
        <div>
          <label class="label">Market</label>
          <select id="f-market" class="input" onchange="onMarketChange()">
            <option value="US" ${(h.market||'US')==='US'?'selected':''}>🇺🇸 US</option>
            <option value="TH" ${h.market==='TH'?'selected':''}>🇹🇭 TH</option>
          </select>
        </div>
      </div>

      <div>
        <label class="label">Full Name *</label>
        <input type="text" id="f-name" value="${escHtml(h.name||'')}" placeholder="e.g. Vanguard S&P 500 ETF" class="input">
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Asset Type</label>
          <select id="f-assetType" class="input">
            ${ASSET_TYPES.map(t => `<option value="${t}" ${h.assetType===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="label">Risk Level</label>
          <select id="f-riskLevel" class="input">
            ${RISK_LEVELS.map(r => `<option value="${r}" ${h.riskLevel===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>

      <div>
        <label class="label">Category</label>
        <input type="text" id="f-category" value="${escHtml(h.category||'')}" placeholder="e.g. Core ETF, Individual Stock" list="cat-list" class="input">
        <datalist id="cat-list">${CATEGORIES.map(c => `<option value="${c}">`).join('')}</datalist>
      </div>
    </div>

    <div class="space-y-3">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Purchase Details</p>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Quantity *</label>
          <input type="number" id="f-qty" value="${h.quantity||''}" placeholder="0.5" step="any" min="0" class="input" oninput="autoCalcCost()">
        </div>
        <div>
          <label class="label">Avg Buy Price *</label>
          <input type="number" id="f-buyPrice" value="${h.averageBuyPrice||''}" placeholder="450" step="any" min="0" class="input" oninput="autoCalcCost()">
        </div>
      </div>

      <div id="fx-section" class="${isUS?'':'hidden'}">
        <div class="flex items-center justify-between mb-1">
          <label class="label" style="margin-bottom:0">Exchange Rate (1 USD = ? THB)</label>
          <button type="button" id="btn-live-fx" onclick="fetchAndFillLiveFX()"
            class="text-xs text-emerald-400 hover:text-emerald-300 active:scale-95 transition-all flex items-center gap-1">
            <span id="live-fx-spinner">🔄</span> Live Rate
          </button>
        </div>
        <input type="number" id="f-fx"
          value="${h.fxRate || currentFXRate}"
          placeholder="${currentFXRate}"
          step="0.01" min="0" class="input"
          oninput="onFXChange()">
        <p class="text-xs text-slate-500 mt-1" id="fx-hint">
          Rate at time of purchase · Live: <span id="fx-live-label">${currentFXRate.toFixed(4)}</span> THB/USD
        </p>
      </div>

      <div>
        <label class="label">Total Cost (THB)</label>
        <input type="number" id="f-cost"
          value="${h.totalCostTHB||''}"
          placeholder="Auto-calculated — or edit to back-calc FX rate"
          step="any" min="0" class="input"
          oninput="onCostChange()">
        <p class="text-xs text-slate-500 mt-1">= Qty × Price × FX Rate · editing either field updates the other</p>
      </div>

      <div>
        <label class="label">Buy Date</label>
        <input type="date" id="f-date" value="${h.buyDate||''}" class="input">
      </div>
    </div>

    <div class="space-y-3">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Current Price (Manual)</p>
      <div>
        <label class="label">Current Price *</label>
        <input type="number" id="f-curPrice" value="${h.currentPrice||''}" placeholder="Latest price" step="any" min="0" class="input">
        <p class="text-xs text-slate-500 mt-1" id="f-curPriceNote">
          ${isUS ? 'Unit: USD' : 'Unit: THB'}
        </p>
      </div>
    </div>

    <div class="space-y-3">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider">📓 Learning Journal</p>
      <div class="bg-slate-700/30 rounded-2xl p-3.5 space-y-1.5">
        <p class="text-xs text-slate-400 font-medium">💡 Answer these questions in your note:</p>
        ${[
          'Why did I buy this stock / ETF?',
          'What does this company or ETF do? How does it make money?',
          'What are the key risks?',
          'What did I learn about it this month?',
          'If I had to buy today, would I still buy it? Why?',
        ].map(q => `<p class="text-xs text-slate-500">• ${q}</p>`).join('')}
      </div>
      <textarea id="f-note" rows="5" placeholder="Write your investment journal here…"
        class="input resize-none leading-relaxed">${escHtml(h.learningNote||'')}</textarea>
    </div>

    <div class="flex gap-3 pt-1 pb-2">
      <button type="button" onclick="closeModal()"
        class="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3.5 rounded-2xl font-medium transition-colors active:scale-95">
        Cancel
      </button>
      <button type="button" onclick="submitHoldingForm()"
        class="flex-[2] bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-2xl font-semibold transition-colors active:scale-95">
        ${editingId ? 'Save Changes' : '+ Add to Portfolio'}
      </button>
    </div>`;
}

function onMarketChange() {
  const isUS = document.getElementById('f-market').value === 'US';
  document.getElementById('fx-section').classList.toggle('hidden', !isUS);
  const note = document.getElementById('f-curPriceNote');
  if (note) note.textContent = isUS ? 'Unit: USD' : 'Unit: THB';
  // Pre-fill with latest known FX rate when switching to US
  if (isUS) {
    const fxEl = document.getElementById('f-fx');
    if (fxEl && (!fxEl.value || parseFloat(fxEl.value) === DEFAULT_FX)) {
      fxEl.value = currentFXRate.toFixed(4);
      const liveLabel = document.getElementById('fx-live-label');
      if (liveLabel) liveLabel.textContent = currentFXRate.toFixed(4);
    }
  }
  onFXChange();
}

// FX Rate changed → recalculate Total Cost
function onFXChange() {
  const qty   = parseFloat(document.getElementById('f-qty')?.value)     || 0;
  const price = parseFloat(document.getElementById('f-buyPrice')?.value) || 0;
  const isUS  = document.getElementById('f-market')?.value === 'US';
  const fx    = isUS ? (parseFloat(document.getElementById('f-fx')?.value) || currentFXRate) : 1;
  if (qty > 0 && price > 0) {
    const costEl = document.getElementById('f-cost');
    if (costEl) costEl.value = (qty * price * fx).toFixed(2);
  }
}

// Total Cost changed → back-calculate FX Rate
function onCostChange() {
  const qty   = parseFloat(document.getElementById('f-qty')?.value)     || 0;
  const price = parseFloat(document.getElementById('f-buyPrice')?.value) || 0;
  const cost  = parseFloat(document.getElementById('f-cost')?.value)     || 0;
  const isUS  = document.getElementById('f-market')?.value === 'US';
  if (isUS && qty > 0 && price > 0 && cost > 0) {
    const impliedFX = cost / (qty * price);
    const fxEl = document.getElementById('f-fx');
    if (fxEl) fxEl.value = impliedFX.toFixed(4);
  }
}

// Keep backward compat — called by qty/price inputs
function autoCalcCost() { onFXChange(); }

// Fetch live USD/THB rate and fill the FX rate input
async function fetchAndFillLiveFX() {
  const spinner = document.getElementById('live-fx-spinner');
  if (spinner) spinner.textContent = '⏳';

  const rate = await fetchLiveFXRate();

  if (spinner) spinner.textContent = '🔄';

  const fxEl = document.getElementById('f-fx');
  if (fxEl) fxEl.value = rate.toFixed(4);

  const liveLabel = document.getElementById('fx-live-label');
  if (liveLabel) liveLabel.textContent = rate.toFixed(4);

  onFXChange();   // recalculate cost with new rate
  showToast(`Live FX rate: 1 USD = ${rate.toFixed(4)} THB ✅`);
}

async function submitHoldingForm() {
  const get = id => document.getElementById(id);
  const symbol      = (get('f-symbol')?.value   || '').trim().toUpperCase();
  const name        = (get('f-name')?.value      || '').trim();
  const market      = get('f-market')?.value     || 'US';
  const assetType   = get('f-assetType')?.value  || 'ETF';
  const category    = (get('f-category')?.value  || '').trim() || 'General';
  const riskLevel   = get('f-riskLevel')?.value  || 'Medium';
  const quantity    = parseFloat(get('f-qty')?.value);
  const avgPrice    = parseFloat(get('f-buyPrice')?.value);
  const fxRate      = market === 'US' ? (parseFloat(get('f-fx')?.value) || DEFAULT_FX) : 1;
  const costRaw     = parseFloat(get('f-cost')?.value);
  const totalCostTHB = costRaw > 0 ? costRaw : quantity * avgPrice * fxRate;
  const currentPrice = parseFloat(get('f-curPrice')?.value);
  const buyDate     = get('f-date')?.value    || '';
  const learningNote = (get('f-note')?.value   || '').trim();

  if (!symbol)             return showToast('Symbol is required', 'error');
  if (!name)               return showToast('Full name is required', 'error');
  if (!(quantity > 0))     return showToast('Quantity must be greater than 0', 'error');
  if (!(avgPrice > 0))     return showToast('Buy price must be greater than 0', 'error');
  if (!(currentPrice > 0)) return showToast('Current price must be greater than 0', 'error');

  const data = {
    symbol, name, market, assetType, category, riskLevel, quantity,
    averageBuyPrice: avgPrice,
    buyCurrency    : market === 'US' ? 'USD' : 'THB',
    fxRate, totalCostTHB, currentPrice,
    currentPriceCurrency: market === 'US' ? 'USD' : 'THB',
    buyDate, learningNote,
  };

  if (editingId) {
    await updateHolding(editingId, data);
    showToast(`${symbol} updated ✅`);
  } else {
    await addHolding(data);
    showToast(`${symbol} added to portfolio 🎉`);
  }

  closeModal();
  renderCurrentScreen();
}

// ── UPDATE PRICE QUICK MODAL ───────────────────────────────

function openUpdatePriceModal(id) {
  const h = portfolio.holdings.find(h => h.id === id);
  if (!h) return;

  const el = document.createElement('div');
  el.id    = 'price-overlay';
  el.className = 'fixed inset-0 z-50';
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick="closePriceOverlay()"></div>
    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-slate-900 rounded-t-3xl p-6 border-t border-slate-800">
      <p class="text-base font-bold text-white mb-0.5">Update Price — ${h.symbol}</p>
      <p class="text-xs text-slate-400 mb-5">Current: <span class="text-white">${h.currentPrice} ${h.currentPriceCurrency}</span></p>
      <label class="text-sm text-slate-400 block mb-2">New Price (${h.currentPriceCurrency})</label>
      <input type="number" id="new-price-input" value="${h.currentPrice}" step="any" min="0"
        class="w-full bg-slate-700 border border-slate-600 rounded-2xl px-4 py-4 text-white text-2xl font-bold text-center focus:outline-none focus:border-emerald-500 mb-5">
      <div class="grid grid-cols-2 gap-3">
        <button onclick="closePriceOverlay()" class="bg-slate-700 text-white py-3.5 rounded-2xl font-medium active:scale-95">Cancel</button>
        <button onclick="savePriceUpdate('${id}')" class="bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-2xl font-semibold active:scale-95">Save</button>
      </div>
    </div>`;

  document.body.appendChild(el);
  setTimeout(() => document.getElementById('new-price-input')?.focus(), 80);
}

function closePriceOverlay() {
  document.getElementById('price-overlay')?.remove();
}

async function savePriceUpdate(id) {
  const val = parseFloat(document.getElementById('new-price-input')?.value);
  if (!(val > 0)) return showToast('Please enter a valid price', 'error');

  const h = portfolio.holdings.find(h => h.id === id);
  if (!h) return;

  await updateHolding(id, { currentPrice: val });
  closePriceOverlay();
  showToast(`${h.symbol} → ${val} ${h.currentPriceCurrency} ✅`);
  renderCurrentScreen();
}

// ── CONFIRM DIALOGS ────────────────────────────────────────

async function confirmDelete(id, symbol) {
  if (confirm(`Remove ${symbol} from portfolio?\n\nThis will also delete the learning note. Cannot be undone.`)) {
    await deleteHolding(id);
    showToast(`${symbol} removed`);
    renderCurrentScreen();
  }
}

async function confirmClearAll() {
  if (confirm('Delete ALL data?\n\nIncludes all holdings and learning notes.\nThis cannot be undone.\n\nConfirm?')) {
    await clearAllData();
  }
}

// ── EXPORT ─────────────────────────────────────────────────

function exportData() {
  const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `arthy-portfolio-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export complete 📁');
}

// ── UTILITIES ──────────────────────────────────────────────

function fmt(amount) {
  if (amount == null || isNaN(amount)) return '฿0';
  return '฿' + Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const wrap  = document.getElementById('toast');
  const inner = document.getElementById('toast-inner');
  if (!wrap || !inner) return;
  inner.textContent = msg;
  inner.className   = `text-sm rounded-2xl px-4 py-3 shadow-xl text-center border ${
    type === 'error'
      ? 'bg-red-900/90 text-red-200 border-red-700'
      : type === 'warning'
        ? 'bg-yellow-900/90 text-yellow-200 border-yellow-700'
        : type === 'info'
          ? 'bg-blue-900/90 text-blue-200 border-blue-700'
          : 'bg-slate-800 text-white border-slate-700'
  }`;
  wrap.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => wrap.classList.add('hidden'), 2600);
}

// ── INIT ───────────────────────────────────────────────────

async function init() {
  // Inject dynamic CSS for form inputs
  const style = document.createElement('style');
  style.textContent = `
    .input {
      width: 100%; background: rgb(51 65 85 / 0.6);
      border: 1px solid rgb(71 85 105 / 0.8); border-radius: 0.75rem;
      padding: 0.625rem 0.875rem; color: white; font-size: 0.875rem;
      outline: none; transition: border-color 0.15s;
    }
    .input:focus { border-color: #10b981; }
    .input option { background: #1e293b; color: white; }
    .label { display: block; font-size: 0.75rem; color: rgb(148 163 184); margin-bottom: 0.25rem; }
  `;
  document.head.appendChild(style);

  loadFXRateCache();       // restore last known FX rate instantly
  loadLastRefreshLog();    // restore last refresh log from LocalStorage cache
  loadWatchlistState();    // restore watchlist from LocalStorage
  await loadPortfolio();
  if (!IS_LOCAL) fetchLiveFXRate();   // update FX rate in background (non-blocking)
  migrateData();
  navigateTo('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
