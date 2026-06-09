/**
 * POST /api/refresh
 *
 * Bulk-refresh prices for ALL holdings (US + TH) in D1 via Yahoo Finance.
 * - No API key required (Yahoo Finance is public)
 * - Updates D1 current_price + updated_at for each holding
 * - Stores refresh log in KV under "refresh:last"
 * - force=true in body bypasses KV cache
 *
 * Symbol mapping:
 *   US market → symbol as-is      (AAPL, VOO)
 *   TH market → symbol + ".BK"   (PTT.BK, ADVANC.BK)
 *
 * Auth: X-App-Secret header required.
 */

const PORTFOLIO_ID  = 'arthy-001';
const SYMBOL_REGEX  = /^[A-Z0-9.\-]{1,12}$/;
const CACHE_TTL     = 900;   // 15 min
const YF_BASE       = 'https://query1.finance.yahoo.com/v8/finance/chart';

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// ── Auth ──────────────────────────────────────────────────

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

  let force = false;
  try { ({ force = false } = await request.json()); } catch (_) {}

  // 1. Load ALL holdings (US + TH) from D1
  let holdings = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, symbol, market FROM holdings
       WHERE portfolio_id = ? ORDER BY created_at ASC`
    ).bind(PORTFOLIO_ID).all();
    holdings = results;
  } catch (err) {
    console.error('refresh: D1 fetch error', err.message);
    return json({ error: 'Failed to read holdings from D1' }, 500);
  }

  if (holdings.length === 0)
    return json({ refreshedAt: new Date().toISOString(), updatedCount: 0, skippedCount: 0, results: [] });

  // 2. Fetch quotes and update D1
  const refreshedAt = new Date().toISOString();
  const results     = [];
  let updatedCount  = 0;
  let skippedCount  = 0;

  for (const { id, symbol, market } of holdings) {
    // Only US and TH supported via Yahoo Finance
    if (!['US', 'TH'].includes(market)) {
      skippedCount++;
      results.push({ symbol, market, status: 'skipped', reason: `market ${market} not supported` });
      continue;
    }

    if (!SYMBOL_REGEX.test(symbol)) {
      skippedCount++;
      results.push({ symbol, market, status: 'skipped', reason: 'invalid symbol' });
      continue;
    }

    const yfSymbol = market === 'TH' ? symbol + '.BK' : symbol;
    const cacheKey = `quote:${market}:${symbol}`;

    // Check KV cache (unless force)
    let quoteData = null;
    if (!force && env.QUOTE_CACHE) {
      try {
        const cached = await env.QUOTE_CACHE.get(cacheKey, { type: 'json' });
        if (cached) quoteData = { ...cached, source: 'cache' };
      } catch (_) {}
    }

    // Fetch from Yahoo Finance if not cached
    if (!quoteData) {
      try {
        quoteData = await fetchYahooFinance(symbol, market, yfSymbol);
        if (env.QUOTE_CACHE) {
          await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quoteData), {
            expirationTtl: CACHE_TTL,
          }).catch(() => {});
        }
        quoteData.source = 'api';
      } catch (err) {
        skippedCount++;
        results.push({ symbol, market, status: 'error', reason: err.message });
        continue;
      }
    }

    // Update D1
    try {
      await env.DB.prepare(
        `UPDATE holdings
         SET current_price = ?,
             current_price_currency = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).bind(quoteData.price, quoteData.currency, id).run();

      updatedCount++;
      results.push({
        symbol,
        market,
        yfSymbol,
        status        : 'updated',
        price         : quoteData.price,
        currency      : quoteData.currency,
        previousClose : quoteData.previousClose,
        change        : quoteData.change,
        changePercent : quoteData.changePercent,
        source        : quoteData.source,
        priceUpdatedAt: quoteData.updatedAt,
      });
    } catch (err) {
      skippedCount++;
      results.push({ symbol, market, status: 'db-error', reason: err.message });
    }
  }

  // 3. Store refresh log in KV (7 day TTL)
  const logEntry = { refreshedAt, updatedCount, skippedCount, results };
  if (env.QUOTE_CACHE) {
    await env.QUOTE_CACHE.put(
      'refresh:last',
      JSON.stringify(logEntry),
      { expirationTtl: 60 * 60 * 24 * 7 }
    ).catch(() => {});
  }

  return json(logEntry, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

// ── Yahoo Finance fetch ───────────────────────────────────

async function fetchYahooFinance(symbol, market, yfSymbol) {
  const url = `${YF_BASE}/${encodeURIComponent(yfSymbol)}?interval=1d&range=1d`;

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
    const errMsg = data?.chart?.error?.description || `Symbol ${yfSymbol} not found`;
    throw new Error(errMsg);
  }

  const meta  = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose ?? 0;
  const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const chg   = price - prev;

  return {
    symbol,
    market,
    yfSymbol,
    price,
    currency     : meta.currency ?? (market === 'US' ? 'USD' : 'THB'),
    previousClose: prev,
    change       : chg,
    changePercent: prev > 0 ? (chg / prev) * 100 : 0,
    updatedAt    : new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
