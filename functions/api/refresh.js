/**
 * POST /api/refresh
 *
 * Bulk-refresh US stock prices for all holdings in D1.
 * - Fetches fresh quotes from Finnhub (bypasses KV cache when force=true)
 * - Updates D1 current_price + updated_at for each holding
 * - Stores last-refresh summary in KV under key "refresh:last"
 *
 * Returns:
 *   { refreshedAt, updatedCount, skippedCount, results: [{symbol,price,changePercent,...}] }
 *
 * Auth: X-App-Secret header required.
 */

const PORTFOLIO_ID  = 'arthy-001';
const SYMBOL_REGEX  = /^[A-Z0-9.\-]{1,12}$/;
const CACHE_TTL     = 900;   // 15 min KV cache
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// ── Auth helper ───────────────────────────────────────────

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true;
  return request.headers.get('X-App-Secret') === secret;
}

// ── Main handler ──────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  if (!env.DB)
    return json({ error: 'D1 not configured' }, 503);

  if (!env.STOCK_API_KEY)
    return json({ error: 'STOCK_API_KEY secret not configured' }, 503);

  // Optional: force=true bypasses KV cache
  let force = false;
  try {
    const body = await request.json().catch(() => ({}));
    force = !!body.force;
  } catch (_) {}

  // 1. Load all US holdings from D1
  let usHoldings = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, symbol, market FROM holdings
       WHERE portfolio_id = ? AND market = 'US'
       ORDER BY created_at ASC`
    ).bind(PORTFOLIO_ID).all();
    usHoldings = results;
  } catch (err) {
    console.error('refresh: D1 fetch error', err.message);
    return json({ error: 'Failed to read holdings from D1' }, 500);
  }

  if (usHoldings.length === 0)
    return json({ refreshedAt: new Date().toISOString(), updatedCount: 0, skippedCount: 0, results: [] }, 200);

  // 2. Fetch quotes and update D1
  const refreshedAt = new Date().toISOString();
  const results     = [];
  let updatedCount  = 0;
  let skippedCount  = 0;

  for (const holding of usHoldings) {
    const { id, symbol } = holding;

    if (!SYMBOL_REGEX.test(symbol)) {
      skippedCount++;
      results.push({ symbol, status: 'skipped', reason: 'invalid symbol' });
      continue;
    }

    // Check KV cache (unless force refresh)
    const cacheKey = `quote:US:${symbol}`;
    let quoteData = null;

    if (!force && env.QUOTE_CACHE) {
      try {
        const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
        if (cached) quoteData = { ...cached, source: 'cache' };
      } catch (_) {}
    }

    // Fetch from Finnhub if not cached
    if (!quoteData) {
      try {
        quoteData = await fetchFinnhub(symbol, env.STOCK_API_KEY);
        // Update KV cache
        if (env.QUOTE_CACHE) {
          await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quoteData), {
            expirationTtl: CACHE_TTL,
          }).catch(() => {});
        }
        quoteData.source = 'api';
      } catch (err) {
        skippedCount++;
        results.push({ symbol, status: 'error', reason: err.message });
        continue;
      }
    }

    // Update D1 current_price and updated_at
    try {
      await env.DB.prepare(
        `UPDATE holdings
         SET current_price = ?, current_price_currency = 'USD', updated_at = datetime('now')
         WHERE id = ?`
      ).bind(quoteData.price, id).run();

      updatedCount++;
      results.push({
        symbol,
        status        : 'updated',
        price         : quoteData.price,
        previousClose : quoteData.previousClose,
        change        : quoteData.change,
        changePercent : quoteData.changePercent,
        source        : quoteData.source,
        priceUpdatedAt: quoteData.updatedAt,
      });
    } catch (err) {
      skippedCount++;
      results.push({ symbol, status: 'db-error', reason: err.message });
    }
  }

  // 3. Store refresh log in KV
  const logEntry = { refreshedAt, updatedCount, skippedCount, results };
  if (env.QUOTE_CACHE) {
    await env.QUOTE_CACHE.put(
      'refresh:last',
      JSON.stringify(logEntry),
      { expirationTtl: 60 * 60 * 24 * 7 }  // keep 7 days
    ).catch(() => {});
  }

  return json(logEntry, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

// ── Finnhub fetch ─────────────────────────────────────────

async function fetchFinnhub(symbol, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { headers: { 'User-Agent': 'arthy-investment-coach/2.0' } }
  );
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  const raw = await res.json();
  if (!raw || raw.c === 0) throw new Error('Empty quote — check symbol');
  return {
    symbol,
    market        : 'US',
    price         : raw.c   ?? 0,
    currency      : 'USD',
    previousClose : raw.pc  ?? 0,
    change        : raw.d   ?? 0,
    changePercent : raw.dp  ?? 0,
    updatedAt     : new Date((raw.t ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

// ── Helper ────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
