/**
 * GET /api/quote?symbol=AAPL&market=US
 *
 * Phase 2 — Cloudflare Pages Function
 * Fetches US stock quotes via Finnhub and caches in KV (QUOTE_CACHE).
 * API key is stored as a Cloudflare secret (STOCK_API_KEY) — never in frontend.
 *
 * Required bindings in wrangler.toml / Pages dashboard:
 *   - KV namespace  : QUOTE_CACHE
 *   - Secret        : STOCK_API_KEY  (set via dashboard or `wrangler secret put`)
 */

const CACHE_TTL    = 900;   // 15 minutes
const SYMBOL_REGEX = /^[A-Z0-9.\-]{1,12}$/;

export async function onRequestGet({ request, env }) {
  const url    = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  const market = (url.searchParams.get('market') || '').toUpperCase().trim();

  const cors = corsHeaders(request);

  // ── Validate ──
  if (!symbol || !SYMBOL_REGEX.test(symbol))
    return json({ error: 'Invalid or missing symbol' }, 400, cors);
  if (!['US', 'TH'].includes(market))
    return json({ error: 'market must be US or TH' }, 400, cors);

  // ── TH market: manual only for now ──
  if (market === 'TH')
    return json({ error: 'TH market auto-price not supported yet. Update price manually.' }, 501, cors);

  // ── Check KV cache ──
  const cacheKey = `quote:${market}:${symbol}`;
  try {
    const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
    if (cached) return json({ ...cached, source: 'cache' }, 200, cors);
  } catch (_) {}

  // ── Fetch from Finnhub ──
  if (!env.STOCK_API_KEY)
    return json({ error: 'STOCK_API_KEY secret not configured' }, 503, cors);

  let quoteData;
  try {
    quoteData = await fetchFinnhub(symbol, env.STOCK_API_KEY);
  } catch (err) {
    return json({ error: 'Failed to fetch price from upstream API', detail: err.message }, 502, cors);
  }

  // ── Store in KV ──
  try {
    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quoteData), {
      expirationTtl: CACHE_TTL,
    });
  } catch (_) {}

  return json({ ...quoteData, source: 'api' }, 200, cors);
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// ── Finnhub fetch ─────────────────────────────────────────

async function fetchFinnhub(symbol, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { headers: { 'User-Agent': 'arthy-investment-coach/2.0' } }
  );
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const raw = await res.json();
  if (!raw || raw.c === 0) throw new Error('Empty quote returned — check symbol');
  return normalize(symbol, 'US', raw);
}

// ── Normalize ─────────────────────────────────────────────

function normalize(symbol, market, raw) {
  return {
    symbol,
    market,
    price         : raw.c   ?? 0,
    currency      : market === 'US' ? 'USD' : 'THB',
    previousClose : raw.pc  ?? 0,
    change        : raw.d   ?? 0,
    changePercent : raw.dp  ?? 0,
    updatedAt     : new Date((raw.t ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin' : origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
