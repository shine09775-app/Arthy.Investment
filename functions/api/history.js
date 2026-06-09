/**
 * GET /api/history?symbol=PTT&market=TH&period=7d
 * GET /api/history?symbol=AAPL&market=US&period=1mo
 * GET /api/history?symbol=ADVANC&market=TH&start=2024-01-01&end=2024-12-31
 *
 * Returns OHLCV daily price history from Yahoo Finance.
 *
 * Query params:
 *   symbol   — stock symbol (without .BK suffix for TH stocks)
 *   market   — "US" | "TH"
 *   period   — "7d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y"
 *              (default "1mo")
 *   start    — ISO date "2024-01-01" (overrides period if both given)
 *   end      — ISO date "2024-12-31" (defaults to today if start is given)
 *
 * Response:
 *   {
 *     symbol, market, yfSymbol, currency,
 *     rows: [{ date, open, high, low, close, volume }],
 *     source: "api" | "cache"
 *   }
 *
 * Auth: X-App-Secret header required.
 */

const SYMBOL_REGEX = /^[A-Z0-9.\-]{1,12}$/;
const YF_BASE      = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CACHE_TTL    = 3600;   // 1 hour (history data changes less often)
const VALID_PERIODS = new Set(['1d','5d','7d','1mo','3mo','6mo','1y','2y','5y','10y']);

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// ── Auth ──────────────────────────────────────────────────

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
  const market = (url.searchParams.get('market') || 'US').toUpperCase().trim();
  const period = url.searchParams.get('period') || '1mo';
  const start  = url.searchParams.get('start') || '';
  const end    = url.searchParams.get('end')   || '';

  if (!symbol || !SYMBOL_REGEX.test(symbol))
    return json({ error: 'Invalid or missing symbol' }, 400);
  if (!['US', 'TH'].includes(market))
    return json({ error: 'market must be US or TH' }, 400);
  if (!start && !VALID_PERIODS.has(period))
    return json({ error: `period must be one of: ${[...VALID_PERIODS].join(', ')}` }, 400);

  const yfSymbol = market === 'TH' ? symbol + '.BK' : symbol;

  // ── KV cache ──────────────────────────────────────────
  const cacheKey = start
    ? `history:${market}:${symbol}:${start}:${end || 'today'}`
    : `history:${market}:${symbol}:${period}`;

  if (env.QUOTE_CACHE) {
    try {
      const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
      if (cached) return json({ ...cached, source: 'cache' }, 200);
    } catch (_) {}
  }

  // ── Fetch from Yahoo Finance ──────────────────────────
  let histData;
  try {
    histData = await fetchHistory(symbol, market, yfSymbol, period, start, end);
  } catch (err) {
    console.error(`history fetch error [${market}:${symbol}]:`, err.message);
    return json({ error: 'Failed to fetch history', detail: err.message }, 502);
  }

  // ── Store in KV ───────────────────────────────────────
  if (env.QUOTE_CACHE) {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(histData), {
      expirationTtl: CACHE_TTL,
    }).catch(() => {});
  }

  return json({ ...histData, source: 'api' }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

// ── Yahoo Finance history fetch ───────────────────────────

async function fetchHistory(symbol, market, yfSymbol, period, start, end) {
  let yfUrl;

  if (start) {
    // Date range mode
    const p1 = Math.floor(new Date(start).getTime() / 1000);
    const p2 = end
      ? Math.floor(new Date(end).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    yfUrl = `${YF_BASE}/${encodeURIComponent(yfSymbol)}?interval=1d&period1=${p1}&period2=${p2}`;
  } else {
    // Period mode
    yfUrl = `${YF_BASE}/${encodeURIComponent(yfSymbol)}?interval=1d&range=${period}`;
  }

  const res = await fetch(yfUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ArthyInvestmentCoach/2.0)',
      'Accept'    : 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${yfSymbol}`);

  const data   = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const errMsg = data?.chart?.error?.description || `Symbol ${yfSymbol} not found`;
    throw new Error(errMsg);
  }

  const meta        = result.meta;
  const timestamps  = result.timestamp || [];
  const quotes      = result.indicators?.quote?.[0] || {};

  const rows = timestamps.map((ts, i) => ({
    date   : new Date(ts * 1000).toISOString().slice(0, 10),
    open   : round2(quotes.open?.[i]),
    high   : round2(quotes.high?.[i]),
    low    : round2(quotes.low?.[i]),
    close  : round2(quotes.close?.[i]),
    volume : quotes.volume?.[i] ?? 0,
  })).filter(r => r.close !== null);   // remove null entries (market closed)

  return {
    symbol,
    market,
    yfSymbol,
    currency    : meta.currency ?? (market === 'US' ? 'USD' : 'THB'),
    exchangeName: meta.exchangeName ?? '',
    rows,
    period      : start ? `${start} → ${end || 'today'}` : period,
    fetchedAt   : new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────

function round2(n) {
  return n != null ? Math.round(n * 100) / 100 : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
