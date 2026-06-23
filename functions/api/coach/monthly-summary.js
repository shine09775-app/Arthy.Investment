/**
 * POST /api/coach/monthly-summary
 *
 * Phase 4 — Claude AI Coach (Cloudflare Pages Function)
 * Replaces the rule-based coach with a Claude-generated monthly summary.
 *
 * Request body:
 *   {
 *     "portfolio": {
 *       "totalValueTHB": 12345,
 *       "totalGainLossPercent": 4.2,
 *       "holdings": [
 *         { "symbol": "VOO", "market": "US", "assetType": "ETF",
 *           "category": "Core ETF", "allocationPct": 35.2,
 *           "gainLossPercent": 6.1, "hasNote": true }
 *       ]
 *     },
 *     "month": "2026-06"
 *   }
 *
 * Response:
 *   {
 *     "healthScore": 78,
 *     "summary": "This month Arthy ...",
 *     "whatWentWell": ["..."],
 *     "whatToReview": ["..."],
 *     "questions": ["?", "?", "?"],
 *     "source": "claude" | "fallback"
 *   }
 *
 * Security:
 *   - ANTHROPIC_API_KEY stored as a Cloudflare secret — never exposed to the frontend.
 *   - X-App-Secret header required (same shared secret as the other endpoints).
 *   - System prompt instructs Claude to act as a learning coach — no buy/sell advice.
 *   - Only minimal, non-PII portfolio data is sent (symbols + ratios, no names).
 */

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL  = 'claude-haiku-4-5';   // override with COACH_MODEL var
const MAX_HOLDINGS   = 30;                    // cap payload size

// ── Auth helper (matches /api/quote, /api/fx) ─────────────

function checkAuth(request, env) {
  const secret = env.APP_SECRET;
  if (!secret) return true;
  return request.headers.get('X-App-Secret') === secret;
}

// ── Main handler ──────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env))
    return json({ error: 'Unauthorized' }, 401);

  if (!env.ANTHROPIC_API_KEY)
    return json({ error: 'AI Coach not configured (missing ANTHROPIC_API_KEY).' }, 501);

  // ── Parse + validate body ─────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const portfolio = body?.portfolio;
  const holdings  = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const month     = typeof body?.month === 'string' ? body.month.slice(0, 7) : '';

  if (!holdings.length)
    return json({ error: 'Portfolio has no holdings to analyse.' }, 400);

  // ── Build a minimal, sanitised prompt (no PII) ────────
  const userPrompt = buildPrompt(portfolio, holdings, month);

  // ── Call Claude ───────────────────────────────────────
  let result;
  try {
    result = await callClaude(env, userPrompt);
  } catch (err) {
    console.error('coach claude error:', err.message);
    return json({ error: 'AI Coach is temporarily unavailable. Please try again later.' }, 502);
  }

  return json({ ...result, source: 'claude' }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsH() });
}

// ── Prompt construction ───────────────────────────────────

function buildPrompt(portfolio, holdings, month) {
  const totalValue = num(portfolio.totalValueTHB);
  const totalPL    = num(portfolio.totalGainLossPercent);

  const lines = holdings.slice(0, MAX_HOLDINGS).map(h => {
    const sym   = String(h.symbol || '?').slice(0, 12);
    const type  = String(h.assetType || '').slice(0, 16);
    const cat   = String(h.category || '').slice(0, 32);
    const mkt   = String(h.market || '').slice(0, 6);
    const alloc = num(h.allocationPct);
    const pl    = num(h.gainLossPercent);
    const note  = h.hasNote ? 'has a learning note' : 'no learning note';
    return `- ${sym} (${mkt}, ${type}${cat ? ', ' + cat : ''}): allocation ${alloc.toFixed(1)}%, gain/loss ${pl >= 0 ? '+' : ''}${pl.toFixed(1)}%, ${note}`;
  });

  return [
    month ? `Portfolio data for ${month}` : 'Current portfolio data',
    `Approximate total value: ${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} THB`,
    `Total gain/loss: ${totalPL >= 0 ? '+' : ''}${totalPL.toFixed(1)}%`,
    `Number of holdings: ${holdings.length}`,
    '',
    'Holdings:',
    ...lines,
    '',
    "Please summarise Arthy's investing progress this month and what to learn next.",
  ].join('\n');
}

// ── Anthropic Messages API call ───────────────────────────

const SYSTEM_PROMPT = `You are Arthy's investment learning coach. Arthy is a teenager learning to invest.
Your role is to help Arthy understand what happened in the portfolio this month
and what to learn next. You MUST NOT give buy, sell, or price predictions, and you
must not tell Arthy to add, reduce, or hold any specific security.
Always frame feedback as learning opportunities.
Respond in English. Keep it encouraging, warm, and educational, suitable for a teenager.
healthScore is 0-100 reflecting diversification and learning habits (notes, ETF core,
concentration). whatWentWell, whatToReview, and questions each contain 2-4 short
sentences. questions are reflective questions for Arthy to think about — not advice.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    healthScore : { type: 'integer' },
    summary     : { type: 'string' },
    whatWentWell: { type: 'array', items: { type: 'string' } },
    whatToReview: { type: 'array', items: { type: 'string' } },
    questions   : { type: 'array', items: { type: 'string' } },
  },
  required: ['healthScore', 'summary', 'whatWentWell', 'whatToReview', 'questions'],
  additionalProperties: false,
};

async function callClaude(env, userPrompt) {
  const res = await fetch(ANTHROPIC_URL, {
    method : 'POST',
    headers: {
      'Content-Type'     : 'application/json',
      'x-api-key'        : env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model     : env.COACH_MODEL || DEFAULT_MODEL,
      max_tokens: 1500,
      system    : SYSTEM_PROMPT,
      messages  : [{ role: 'user', content: userPrompt }],
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status} ${detail.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.stop_reason === 'refusal')
    throw new Error('Claude declined to respond');

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');

  const parsed = JSON.parse(textBlock.text);

  // Clamp + normalise so the frontend always gets a safe shape
  return {
    healthScore : clampScore(parsed.healthScore),
    summary     : String(parsed.summary || ''),
    whatWentWell: toStrArray(parsed.whatWentWell),
    whatToReview: toStrArray(parsed.whatToReview),
    questions   : toStrArray(parsed.questions).slice(0, 4),
  };
}

// ── Helpers ───────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampScore(v) {
  const n = Math.round(num(v));
  return Math.max(0, Math.min(100, n));
}

function toStrArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(s => s.trim().length > 0);
}

function corsH() {
  return {
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsH() },
  });
}
