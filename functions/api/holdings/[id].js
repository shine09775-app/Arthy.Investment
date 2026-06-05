/**
 * PUT    /api/holdings/:id  — update a holding
 * DELETE /api/holdings/:id  — delete a holding
 *
 * Phase 3 — Cloudflare D1 via Pages Function.
 */

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export async function onRequestPut({ request, params, env }) {
  if (!env.DB) return json({ error: 'D1 not configured' }, 503);

  const { id } = params;
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const {
    symbol, market, name, assetType, category, quantity, averageBuyPrice,
    buyCurrency, fxRate, totalCostTHB, currentPrice, currentPriceCurrency,
    buyDate, riskLevel, learningNote,
  } = body;

  try {
    const result = await env.DB.prepare(`
      UPDATE holdings SET
        symbol = ?, market = ?, name = ?, asset_type = ?, category = ?,
        quantity = ?, average_buy_price = ?, buy_currency = ?, fx_rate = ?,
        total_cost_thb = ?, current_price = ?, current_price_currency = ?,
        buy_date = ?, risk_level = ?, learning_note = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      symbol, market, name,
      assetType || 'Stock', category || 'General',
      quantity || 0, averageBuyPrice || 0,
      buyCurrency || 'THB', fxRate || 1, totalCostTHB || 0,
      currentPrice || 0, currentPriceCurrency || 'THB',
      buyDate || null, riskLevel || 'Medium', learningNote || '',
      id
    ).run();

    if (result.meta.changes === 0)
      return json({ error: 'Holding not found' }, 404);

    return json({ success: true, id }, 200);
  } catch (err) {
    return json({ error: 'DB update failed', detail: err.message }, 500);
  }
}

export async function onRequestDelete({ params, env }) {
  if (!env.DB) return json({ error: 'D1 not configured' }, 503);

  const { id } = params;
  try {
    const result = await env.DB.prepare(
      'DELETE FROM holdings WHERE id = ?'
    ).bind(id).run();

    if (result.meta.changes === 0)
      return json({ error: 'Holding not found' }, 404);

    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: 'DB delete failed', detail: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
