/**
 * GET /api/quote?symbol=AAPL&market=US
 * GET /api/quote?symbol=PTT&market=TH
 * GET /api/quote?symbol=ADVANC&market=TH
 *
 * Phase 2 — Cloudflare Pages Function
 * Fetches stock quotes via Yahoo Finance (no API key required).
 * Results cached in KV (QUOTE_CACHE) for 15 minutes.
 *
 * Symbol mapping:
 *   US market  → symbol as-is          e.g. AAPL, VOO, QQQM
 *   TH market  → symbol + ".BK"        e.g. PTT.BK, ADVANC.BK, CPALL.BK
 *
 * Required bindings:
 *   - KV namespace : QUOTE_CACHE
 *   - No API key needed (Yahoo Finance is public)
 *
 * Auth: X-App-Secret header required.
 */

const CACHE_TTL    = 900;   // 15 minutes
const SYMBOL_REGEX = /^[A-Z0-9.\-]{1,12}$/;
const YF_BASE      = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ── Auth helper ───────────────────────────────────────────

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true;
  return request.headers.get('X-App-Secret') === secret;
}

// ── Main handler ──────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  const url    = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  const market = (url.searchParams.get('market') || '').toUpperCase().trim();

  if (!symbol || !SYMBOL_REGEX.test(symbol))
    return json({ error: 'Invalid or missing symbol' }, 400);
  if (!['US', 'TH'].includes(market))
    return json({ error: 'market must be US or TH' }, 400);

  // ── KV cache check ────────────────────────────────────
  const cacheKey = `quote:${market}:${symbol}`;
  if (env.QUOTE_CACHE) {
    try {
      const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
      if (cached) return json({ ...cached, source: 'cache' }, 200);
    } catch (_) {}
  }

  // ── Fetch from Yahoo Finance ──────────────────────────
  let quoteData;
  try {
    quoteData = await fetchYahooFinance(symbol, market);
  } catch (err) {
    console.error(`quote fetch error [${market}:${symbol}]:`, err.message);
    return json({ error: 'Failed to fetch price', detail: err.message }, 502);
  }

  // ── Store in KV ───────────────────────────────────────
  if (env.QUOTE_CACHE) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quoteData), {
      expirationTtl: CACHE_TTL,
    }).catch(() => {});
  }

  return json({ ...quoteData, source: 'api' }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsH() });
}

// ── Yahoo Finance fetch ───────────────────────────────────

function toYfSymbol(symbol, market) {
  if (market === 'TH') return symbol + '.BK';
  return symbol;   // US: AAPL, VOO, QQQM — no suffix
}

async function fetchYahooFinance(symbol, market) {
  const yfSymbol = toYfSymbol(symbol, market);
  const url      = `${YF_BASE}/${encodeURIComponent(yfSymbol)}?interval=1d&range=1d`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ArthyInvestmentCoach/2.0)',
      'Accept'    : 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${yfSymbol}`);

  const data   = await res.json();
  const result = data?.chart?.result?.[0];

  if (!result) {
    const errMsg = data?.chart?.error?.description || 'Symbol not found on Yahoo Finance';
    throw new Error(errMsg);
  }

  return normalizeYF(symbol, market, yfSymbol, result);
}

// ── Normalize Yahoo Finance response ─────────────────────

function normalizeYF(symbol, market, yfSymbol, result) {
  const meta  = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose ?? 0;
  const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const chg   = price - prev;
  const chgPct = prev > 0 ? (chg / prev) * 100 : 0;

  return {
    symbol,
    market,
    yfSymbol,
    price,
    currency       : meta.currency ?? (market === 'US' ? 'USD' : 'THB'),
    previousClose  : prev,
    change         : chg,
    changePercent  : chgPct,
    regularMarketVolume : meta.regularMarketVolume ?? 0,
    fiftyTwoWeekHigh    : meta.fiftyTwoWeekHigh    ?? 0,
    fiftyTwoWeekLow     : meta.fiftyTwoWeekLow     ?? 0,
    exchangeName   : meta.exchangeName ?? '',
    updatedAt      : new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────

function corsH() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsH() },
  });
}
