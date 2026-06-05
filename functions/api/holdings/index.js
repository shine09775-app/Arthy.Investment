/**
 * POST /api/holdings
 *
 * Phase 3 — Create a new holding in Cloudflare D1.
 */

const PORTFOLIO_ID = 'arthy-001';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'D1 not configured' }, 503);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { id, symbol, market, name, assetType, category, quantity, averageBuyPrice,
          buyCurrency, fxRate, totalCostTHB, currentPrice, currentPriceCurrency,
          buyDate, riskLevel, learningNote } = body;

  if (!id || !symbol || !market || !name)
    return json({ error: 'id, symbol, market, name are required' }, 400);

  try {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO holdings
        (id, portfolio_id, symbol, market, name, asset_type, category,
         quantity, average_buy_price, buy_currency, fx_rate, total_cost_thb,
         current_price, current_price_currency, buy_date, risk_level, learning_note,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).bind(
      id, PORTFOLIO_ID, symbol, market, name,
      assetType || 'Stock', category || 'General',
      quantity || 0, averageBuyPrice || 0,
      buyCurrency || 'THB', fxRate || 1, totalCostTHB || 0,
      currentPrice || 0, currentPriceCurrency || 'THB',
      buyDate || null, riskLevel || 'Medium', learningNote || ''
    ).run();

    return json({ success: true, id }, 201);
  } catch (err) {
    return json({ error: 'DB insert failed', detail: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
