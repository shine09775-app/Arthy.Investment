/**
 * GET /api/portfolio
 *
 * Phase 3 — Returns all holdings for the default portfolio from Cloudflare D1.
 * Falls back gracefully if DB binding is not configured.
 *
 * Required bindings in wrangler.toml / Pages dashboard:
 *   - D1 database : DB  (run schema.sql first)
 *
 * Deploy schema:
 *   wrangler d1 create arthy-portfolio
 *   wrangler d1 execute arthy-portfolio --file=schema.sql
 */

const PORTFOLIO_ID = 'arthy-001';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestGet({ env }) {
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
    return json({ error: 'DB error', detail: err.message }, 500);
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
