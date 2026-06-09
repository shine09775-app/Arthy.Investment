/**
 * GET /api/sync-status
 *
 * Returns cloud data summary:
 *   - D1: holdings count, portfolio last updated
 *   - KV: last price refresh log (time, results)
 *
 * Auth: X-App-Secret header required.
 */

const PORTFOLIO_ID = 'arthy-001';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true;
  return request.headers.get('X-App-Secret') === secret;
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  const status = {
    checkedAt     : new Date().toISOString(),
    d1            : { available: false, holdingsCount: 0, lastUpdated: null },
    lastRefresh   : null,
    kvAvailable   : !!env.QUOTE_CACHE,
  };

  // ── D1 summary ────────────────────────────────────────
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS cnt, MAX(updated_at) AS last_updated
         FROM holdings WHERE portfolio_id = ?`
      ).bind(PORTFOLIO_ID).first();

      status.d1 = {
        available     : true,
        holdingsCount : row?.cnt      ?? 0,
        lastUpdated   : row?.last_updated ?? null,
      };
    } catch (err) {
      status.d1.error = 'D1 query failed';
    }
  }

  // ── KV: last refresh log ──────────────────────────────
  if (env.QUOTE_CACHE) {
    try {
      const log = await env.QUOTE_CACHE.get('refresh:last', { type: 'json' });
      if (log) status.lastRefresh = log;
    } catch (_) {}
  }

  return json(status, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
