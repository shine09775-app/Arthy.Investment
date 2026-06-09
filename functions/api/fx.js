/**
 * GET /api/fx?pair=USDTHB
 *
 * Returns the current USD/THB exchange rate via Yahoo Finance (THB=X).
 * Cached in KV for 30 minutes.
 *
 * Supported pairs:
 *   USDTHB  (default) — USD to THB  → THB=X
 *
 * Response:
 *   { pair, rate, currency, bid, ask, updatedAt, source }
 *
 * Auth: X-App-Secret header required.
 */

const CACHE_TTL = 1800;   // 30 minutes
const YF_BASE   = 'https://query1.finance.yahoo.com/v8/finance/chart';
const cors      = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// FX pair → Yahoo Finance ticker mapping
const FX_TICKERS = {
  USDTHB: 'THB=X',
  EURUSD: 'EURUSD=X',
  USDJPY: 'JPY=X',
  GBPUSD: 'GBPUSD=X',
};

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true;
  return request.headers.get('X-App-Secret') === secret;
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  const url  = new URL(request.url);
  const pair = (url.searchParams.get('pair') || 'USDTHB').toUpperCase();

  const ticker = FX_TICKERS[pair];
  if (!ticker)
    return json({ error: `Unknown pair. Supported: ${Object.keys(FX_TICKERS).join(', ')}` }, 400);

  // ── KV cache ──────────────────────────────────────────
  const cacheKey = `fx:${pair}`;
  if (env.QUOTE_CACHE) {
    try {
      const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
      if (cached) return json({ ...cached, source: 'cache' }, 200);
    } catch (_) {}
  }

  // ── Fetch from Yahoo Finance ──────────────────────────
  let rateData;
  try {
    rateData = await fetchFXRate(pair, ticker);
  } catch (err) {
    console.error(`fx fetch error [${pair}]:`, err.message);
    return json({ error: 'Failed to fetch FX rate', detail: err.message }, 502);
  }

  // ── Cache in KV ───────────────────────────────────────
  if (env.QUOTE_CACHE) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(rateData), {
      expirationTtl: CACHE_TTL,
    }).catch(() => {});
  }

  return json({ ...rateData, source: 'api' }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

// ── Yahoo Finance FX fetch ────────────────────────────────

async function fetchFXRate(pair, ticker) {
  const url = `${YF_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ArthyInvestmentCoach/2.0)',
      'Accept'    : 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${ticker}`);

  const data   = await res.json();
  const result = data?.chart?.result?.[0];

  if (!result) {
    const errMsg = data?.chart?.error?.description || `FX ticker ${ticker} not found`;
    throw new Error(errMsg);
  }

  const meta = result.meta;
  const rate = meta.regularMarketPrice ?? meta.previousClose ?? 0;
  const prev = meta.previousClose ?? meta.chartPreviousClose ?? rate;

  return {
    pair,
    ticker,
    rate,
    previousClose : prev,
    change        : rate - prev,
    changePercent : prev > 0 ? ((rate - prev) / prev) * 100 : 0,
    currency      : meta.currency ?? 'THB',
    updatedAt     : new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
