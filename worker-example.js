/**
 * worker-example.js
 * Arthy Investment Coach — Phase 2 Cloudflare Worker scaffold
 *
 * Deploy:  wrangler deploy
 * Secrets: wrangler secret put STOCK_API_KEY
 *
 * Bindings required in wrangler.toml:
 *   [[kv_namespaces]]
 *   binding = "QUOTE_CACHE"
 *   id      = "<your-kv-namespace-id>"
 */

const CACHE_TTL_SECONDS = 900; // 15 minutes for market-hours data
const ALLOWED_MARKETS   = ['US', 'TH'];
const SYMBOL_REGEX      = /^[A-Z0-9.\-]{1,10}$/;

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // ── CORS headers ──
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Router ──
    if (url.pathname === '/api/quote' && request.method === 'GET') {
      return handleQuote(url, env, corsHeaders);
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ status: 'ok', phase: 2 }, 200, corsHeaders);
    }

    return json({ error: 'Not found' }, 404, corsHeaders);
  },
};

// ── Quote handler ─────────────────────────────────────────

async function handleQuote(url, env, corsHeaders) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  const market = (url.searchParams.get('market') || '').toUpperCase().trim();

  // Input validation
  if (!symbol || !SYMBOL_REGEX.test(symbol)) {
    return json({ error: 'Invalid symbol' }, 400, corsHeaders);
  }
  if (!ALLOWED_MARKETS.includes(market)) {
    return json({ error: `market must be one of: ${ALLOWED_MARKETS.join(', ')}` }, 400, corsHeaders);
  }

  const cacheKey = `quote:${market}:${symbol}`;

  // ── 1. Check KV cache ──
  const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
  if (cached) {
    return json({ ...cached, source: 'cache' }, 200, corsHeaders);
  }

  // ── 2. Fetch from external API ──
  // Replace with your chosen data provider.
  // Never hardcode API keys — use Cloudflare Secrets.
  //
  // Example providers:
  //   US stocks:  Finnhub  (finnhub.io)
  //               Polygon  (polygon.io)
  //               Yahoo Finance unofficial endpoint
  //   TH stocks:  SET Smart (setsmartpro.com) — requires license

  if (market === 'TH') {
    // Thai market data typically requires a licensed API.
    // In Phase 1-2, keep Thai price updates manual.
    return json({ error: 'TH market auto-price not yet supported. Update price manually.' }, 501, corsHeaders);
  }

  // ── US quote via Finnhub (example) ──
  let quoteData;
  try {
    quoteData = await fetchFinnhub(symbol, env.STOCK_API_KEY);
  } catch (err) {
    console.error('External API failed:', err);
    return json({ error: 'Failed to fetch price. Try again later.' }, 502, corsHeaders);
  }

  // ── 3. Store in KV cache ──
  await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quoteData), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return json({ ...quoteData, source: 'api' }, 200, corsHeaders);
}

// ── External API call: Finnhub ────────────────────────────

async function fetchFinnhub(symbol, apiKey) {
  // NEVER hardcode the API key here. It must come from env (Cloudflare Secret).
  if (!apiKey) throw new Error('STOCK_API_KEY secret not configured');

  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { headers: { 'User-Agent': 'arthy-investment-coach/2.0' } }
  );

  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

  const raw = await res.json();

  // Normalize to the standard quote shape used across the app
  return normalizeQuote(symbol, 'US', raw);
}

// ── Normalize quote shape ─────────────────────────────────

/**
 * Returns a stable normalized quote object regardless of data source.
 *
 * @typedef {Object} NormalizedQuote
 * @property {string}  symbol
 * @property {string}  market
 * @property {number}  price
 * @property {string}  currency
 * @property {number}  previousClose
 * @property {number}  change
 * @property {number}  changePercent
 * @property {string}  updatedAt      - ISO 8601
 * @property {string}  source         - "api" | "cache"
 */
function normalizeQuote(symbol, market, raw) {
  // Finnhub shape: { c: current, pc: prevClose, d: change, dp: changePercent, t: timestamp }
  return {
    symbol,
    market,
    price:         raw.c  ?? 0,
    currency:      market === 'US' ? 'USD' : 'THB',
    previousClose: raw.pc ?? 0,
    change:        raw.d  ?? 0,
    changePercent: raw.dp ?? 0,
    updatedAt:     new Date((raw.t ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

// ── JSON response helper ──────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/*
──────────────────────────────────────────────────────────────
  wrangler.toml example
──────────────────────────────────────────────────────────────

  name = "arthy-worker"
  main = "worker-example.js"
  compatibility_date = "2025-06-01"

  [[kv_namespaces]]
  binding = "QUOTE_CACHE"
  id      = "REPLACE_WITH_YOUR_KV_ID"

  [vars]
  # Non-secret config can go here

  # Secrets (never put real keys here — use `wrangler secret put`):
  #   STOCK_API_KEY  — Finnhub / Polygon API key

──────────────────────────────────────────────────────────────
  Deploy steps (Phase 2)
──────────────────────────────────────────────────────────────

  1. npm install -g wrangler
  2. wrangler login
  3. wrangler kv:namespace create QUOTE_CACHE
     → copy the id into wrangler.toml
  4. wrangler secret put STOCK_API_KEY
     → paste your Finnhub / Polygon key when prompted
  5. wrangler deploy
  6. Update WORKER_URL in app.js fetchQuote() and uncomment Phase 2 code.

*/
