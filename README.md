# Arthy Investment Coach 📈

> **เรียนรู้การลงทุนผ่านพอร์ตจำลองจากหุ้นและ ETF**
>
> สำหรับการเรียนรู้เท่านั้น ไม่ใช่คำแนะนำการลงทุน

---

## What is this?

Arthy Investment Coach is a **mobile-first educational portfolio tracker** built for Arthy to learn investing.  
This is **not** a real brokerage account. Real investments are managed by a parent through Dime.

The app lets Arthy:
- Record holdings (stocks & ETFs) from Thai and US markets
- Track cost, current value, and gain/loss manually
- Write investment learning notes (journal)
- See portfolio concentration warnings
- Get rule-based AI Coach feedback each month

---

## Phase 1 — Running Locally

No build step needed. Just open the file.

```bash
# Option 1: open directly
open index.html          # macOS
start index.html         # Windows

# Option 2: local dev server (recommended — avoids CORS issues)
npx serve .
# or
python -m http.server 8080
```

All data is stored in **LocalStorage**. No internet required.

---

## Deploying to Cloudflare Pages (Phase 1)

```bash
# Install Wrangler
npm install -g wrangler
wrangler login

# Deploy static files
wrangler pages deploy . --project-name arthy-investment-coach
```

Or connect your GitHub repo in the Cloudflare Pages dashboard — it will auto-deploy on every push.

Files served: `index.html`, `app.js`, `styles.css`

---

## Phase Roadmap

### ✅ Phase 1 — LocalStorage (current)
- HTML + Tailwind CSS + Vanilla JS
- Full CRUD: add, edit, delete holdings
- Manual price update
- Portfolio calculations (value, gain/loss, allocation)
- Rule-based warnings (concentration, no ETF, loss without note…)
- Rule-based AI Coach panel with health score
- Demo data loader
- Export to JSON
- Zero backend, runs from `index.html`

---

### ⏳ Phase 2 — Live US Stock Prices (Cloudflare Worker)

**Goal:** Fetch real-time (or 15-min delayed) US stock prices automatically.

**Files:** `worker-example.js`, `wrangler.toml`

**Steps:**
1. Register at Finnhub or Polygon.io for a free API key
2. `wrangler d1 create quote-cache` (or use KV)
3. `wrangler secret put STOCK_API_KEY`
4. Deploy: `wrangler deploy`
5. In `app.js`, update `WORKER_URL` and uncomment Phase 2 block in `fetchQuote()`

**Security rules:**
- API key lives only in Cloudflare Worker Secrets — never in frontend JS
- Worker validates symbol and market before calling external API
- KV cache reduces external API calls (15-min TTL during market hours)
- Rate limiting via Cloudflare dashboard or custom counter in KV

**Thai stocks:** SET Smart / Bisnews API requires a licensed subscription.  
TH prices remain manual until a suitable API is sourced.

---

### ⏳ Phase 3 — Permanent Cloud Storage (Cloudflare D1)

**Goal:** Move from LocalStorage to a real database so data survives device changes and enables multiple-device access.

**Files:** `schema.sql`

**Tables:**
| Table | Purpose |
|---|---|
| `portfolios` | One portfolio per owner |
| `holdings` | Current positions snapshot |
| `transactions` | Append-only buy/sell/dividend log |
| `monthly_reflections` | Arthy's written monthly reviews |
| `price_cache` | D1 fallback for last known prices |

**Steps:**
1. `wrangler d1 create arthy-portfolio`
2. `wrangler d1 execute arthy-portfolio --file=schema.sql`
3. Add D1 binding to `wrangler.toml`
4. Extend `worker-example.js` with REST endpoints:
   - `GET /api/portfolio`
   - `POST /api/portfolio/holdings`
   - `PUT /api/portfolio/holdings/:id`
   - `DELETE /api/portfolio/holdings/:id`
   - `GET /api/portfolio/holdings/:id/transactions`
5. Update `app.js` to call Worker instead of LocalStorage

**Migration:** export LocalStorage JSON → import into D1 via a one-time migration script.

---

### ⏳ Phase 4 — AI Coach via Claude API

**Goal:** Replace rule-based coach with Claude (claude-sonnet or claude-haiku) for richer, more personalised monthly summaries.

**Worker endpoint:** `POST /api/coach/monthly-summary`

**Request body:**
```json
{
  "portfolio": { "holdings": [...], "totalValue": 12345 },
  "month": "2026-06"
}
```

**Response:**
```json
{
  "healthScore": 78,
  "summary": "เดือนนี้ Arthy...",
  "whatWentWell": ["..."],
  "whatToReview": ["..."],
  "questions": ["?", "?", "?"]
}
```

**Security rules:**
- Anthropic API key stored as Cloudflare Worker Secret (`ANTHROPIC_API_KEY`)
- Never exposed to frontend
- System prompt instructs Claude to act as a learning coach — no buy/sell advice
- User data sent to Claude is minimal (no PII, no full names)

**System prompt template:**
```
You are Arthy's investment learning coach. Arthy is a teenager learning to invest.
Your role is to help Arthy understand what happened in the portfolio this month
and what to learn next. You MUST NOT give buy, sell, or price predictions.
Always frame feedback as learning opportunities.
Respond in Thai. Keep it encouraging and educational.
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Cloudflare Pages                    │
│         index.html · app.js · styles.css             │
└────────────────────┬────────────────────────────────┘
                     │ fetch (Phase 2+)
┌────────────────────▼────────────────────────────────┐
│                 Cloudflare Worker                    │
│  /api/quote    /api/portfolio    /api/coach/*        │
│                                                      │
│  Secrets: STOCK_API_KEY  ANTHROPIC_API_KEY           │
└──────────┬─────────────────────┬────────────────────┘
           │ KV cache            │ D1 queries
┌──────────▼──────┐   ┌──────────▼──────────────────┐
│  Cloudflare KV  │   │      Cloudflare D1           │
│  Quote cache    │   │  portfolios / holdings /     │
│  (15-min TTL)   │   │  transactions / reflections  │
└─────────────────┘   └──────────────────────────────┘
           │
┌──────────▼──────────────────┐
│  External Stock Price API   │
│  (Finnhub / Polygon.io)     │
└─────────────────────────────┘
```

---

## Data Model (Phase 1 LocalStorage)

Each holding is stored as JSON:

```json
{
  "id": "unique-id",
  "symbol": "VOO",
  "market": "US",
  "name": "Vanguard S&P 500 ETF",
  "assetType": "ETF",
  "category": "Core ETF",
  "quantity": 0.25,
  "averageBuyPrice": 450,
  "buyCurrency": "USD",
  "fxRate": 36.5,
  "totalCostTHB": 4106.25,
  "currentPrice": 470,
  "currentPriceCurrency": "USD",
  "buyDate": "2026-06-05",
  "riskLevel": "ปานกลาง",
  "learningNote": "This ETF tracks the S&P 500…",
  "createdAt": "2026-06-05T10:00:00Z",
  "updatedAt": "2026-06-05T10:00:00Z"
}
```

**Calculations:**
```
currentValueTHB  = quantity × currentPrice × fxRate  (USD)
                 = quantity × currentPrice            (THB)

gainLossTHB      = currentValueTHB − totalCostTHB
gainLossPercent  = gainLossTHB / totalCostTHB × 100
```

---

## Rule-Based Warnings

| Rule | Threshold | Message |
|---|---|---|
| Single holding too heavy | > 20% of portfolio | Review concentration |
| Too many individual stocks | > 40% of portfolio | Learn diversification |
| No ETF in portfolio | — | Portfolio lacks broad diversification |
| Losing holding, no note | Loss > 10% | Write a learning note before acting |
| USD holding, FX rate missing | fxRate ≤ 0 | THB valuation will be inaccurate |

---

## Important Disclaimers

- **This is not a real investment account.** All data is for learning purposes only.
- Prices are updated manually and may not reflect real market prices.
- Gain/loss figures are estimates based on manually entered data.
- This app does not give investment advice.
- Real portfolio management is handled by Arthy's parent through Dime.

---

## File Structure

```
arthy investment/
├── index.html          ← App shell + all screens
├── app.js              ← All logic (state, CRUD, render, coach)
├── styles.css          ← Minimal custom CSS (Tailwind handles the rest)
├── worker-example.js   ← Phase 2: Cloudflare Worker scaffold
├── schema.sql          ← Phase 3: Cloudflare D1 schema
└── README.md           ← This file
```
