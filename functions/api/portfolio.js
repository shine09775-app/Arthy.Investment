/**
 * GET /api/portfolio
 *
 * Phase 3 — Returns all holdings for the default portfolio from Cloudflare D1.
 * Falls back gracefully if DB binding is not configured.
 *
 * Auth: requires X-App-Secret header matching APP_SECRET env var.
 */

const PORTFOLIO_ID = 'arthy-001';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true; // Not configured → open (dev fallback)
  return request.headers.get('X-App-Secret') === secret;
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  if (!env.DB) {
    return json({ holdings: [], lastUpdated: null, source: 'localstorage-fallback' }, 200);
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM holdings WHERE portfolio_id = ? ORDER BY created_at ASC'
    ).bind(PORTFOLIO_ID).all();

    const holdings = results.map(dbRowToHolding);
    return json({ holdings, lastUpdated: new Date().toISOString() }, 200);
  } catch (err) {
    console.error('GET /api/portfolio DB error:', err.message);
    return json({ error: 'Failed to load portfolio' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

// ── Row → holding object ──────────────────────────────────

function dbRowToHolding(row) {
  return {
    id                  : row.id,
    symbol              : row.symbol,
    market              : row.market,
    name                : row.name,
    assetType           : row.asset_type,
    category            : row.category,
    quantity            : row.quantity,
    averageBuyPrice     : row.average_buy_price,
    buyCurrency         : row.buy_currency,
    fxRate              : row.fx_rate,
    totalCostTHB        : row.total_cost_thb,
    currentPrice        : row.current_price,
    currentPriceCurrency: row.current_price_currency,
    buyDate             : row.buy_date,
    riskLevel           : row.risk_level,
    learningNote        : row.learning_note,
    createdAt           : row.created_at,
    updatedAt           : row.updated_at,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
