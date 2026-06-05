-- ============================================================
-- Arthy Investment Coach — schema.sql
-- Phase 3: Cloudflare D1 database schema
--
-- Deploy:
--   wrangler d1 create arthy-portfolio
--   wrangler d1 execute arthy-portfolio --file=schema.sql
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── portfolios ────────────────────────────────────────────
-- One portfolio per user. Phase 3 starts single-user (Arthy only).
-- owner_name / owner_email added here for future multi-user support.

CREATE TABLE IF NOT EXISTS portfolios (
  id            TEXT    PRIMARY KEY,          -- nanoid / UUID
  owner_name    TEXT    NOT NULL DEFAULT 'Arthy',
  owner_email   TEXT,
  base_currency TEXT    NOT NULL DEFAULT 'THB',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── holdings ──────────────────────────────────────────────
-- Current snapshot of each position.

CREATE TABLE IF NOT EXISTS holdings (
  id                     TEXT    PRIMARY KEY,
  portfolio_id           TEXT    NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol                 TEXT    NOT NULL,
  market                 TEXT    NOT NULL CHECK (market IN ('US','TH','SG','HK','OTHER')),
  name                   TEXT    NOT NULL,
  asset_type             TEXT    NOT NULL CHECK (asset_type IN ('ETF','หุ้น','Bond','Crypto','Other')),
  category               TEXT    NOT NULL DEFAULT 'ทั่วไป',
  quantity               REAL    NOT NULL CHECK (quantity > 0),
  average_buy_price      REAL    NOT NULL CHECK (average_buy_price > 0),
  buy_currency           TEXT    NOT NULL DEFAULT 'THB',
  fx_rate                REAL    NOT NULL DEFAULT 1.0,   -- buy_currency → THB at purchase time
  total_cost_thb         REAL    NOT NULL,
  current_price          REAL    NOT NULL DEFAULT 0,
  current_price_currency TEXT    NOT NULL DEFAULT 'THB',
  current_value_thb      REAL    GENERATED ALWAYS AS (quantity * current_price * fx_rate) VIRTUAL,
  buy_date               TEXT,                           -- ISO date YYYY-MM-DD
  risk_level             TEXT    NOT NULL DEFAULT 'ปานกลาง',
  learning_note          TEXT    NOT NULL DEFAULT '',
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio
  ON holdings(portfolio_id);

CREATE INDEX IF NOT EXISTS idx_holdings_symbol_market
  ON holdings(symbol, market);

-- ── transactions ──────────────────────────────────────────
-- Append-only log of every buy / sell / dividend event.

CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT    PRIMARY KEY,
  holding_id       TEXT    NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  transaction_type TEXT    NOT NULL CHECK (transaction_type IN ('BUY','SELL','DIVIDEND','SPLIT','TRANSFER')),
  quantity         REAL    NOT NULL,
  price            REAL    NOT NULL,
  currency         TEXT    NOT NULL DEFAULT 'THB',
  fx_rate          REAL    NOT NULL DEFAULT 1.0,
  fee_thb          REAL    NOT NULL DEFAULT 0,
  transaction_date TEXT    NOT NULL,   -- ISO date
  note             TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_holding
  ON transactions(holding_id);

CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON transactions(transaction_date);

-- ── monthly_reflections ───────────────────────────────────
-- Arthy writes a portfolio reflection each month.
-- Stores a snapshot of portfolio value at the time of writing.

CREATE TABLE IF NOT EXISTS monthly_reflections (
  id                TEXT    PRIMARY KEY,
  portfolio_id      TEXT    NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  month             TEXT    NOT NULL,    -- "2026-06" (YYYY-MM)
  total_cost_thb    REAL    NOT NULL DEFAULT 0,
  total_value_thb   REAL    NOT NULL DEFAULT 0,
  gain_loss_thb     REAL    GENERATED ALWAYS AS (total_value_thb - total_cost_thb) VIRTUAL,
  gain_loss_percent REAL    GENERATED ALWAYS AS (
    CASE WHEN total_cost_thb > 0
         THEN (total_value_thb - total_cost_thb) / total_cost_thb * 100
         ELSE 0 END
  ) VIRTUAL,
  reflection_text   TEXT    NOT NULL DEFAULT '',
  health_score      INTEGER NOT NULL DEFAULT 0,   -- 0–100 from AI Coach
  ai_summary        TEXT    NOT NULL DEFAULT '',  -- Phase 4: Claude AI Coach summary
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reflection_unique
  ON monthly_reflections(portfolio_id, month);

-- ── price_cache ───────────────────────────────────────────
-- Optional: store last-fetched prices in D1 as fallback when KV is cold.
-- Primary cache remains Cloudflare KV (faster, lower cost for reads).

CREATE TABLE IF NOT EXISTS price_cache (
  symbol       TEXT NOT NULL,
  market       TEXT NOT NULL,
  price        REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  change_pct   REAL NOT NULL DEFAULT 0,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, market)
);

-- ============================================================
-- Seed: default portfolio for Arthy (run once after schema)
-- ============================================================

INSERT OR IGNORE INTO portfolios (id, owner_name, base_currency)
  VALUES ('arthy-portfolio-001', 'Arthy', 'THB');

-- ============================================================
-- Example query: portfolio summary
-- ============================================================
-- SELECT
--   h.symbol,
--   h.market,
--   h.name,
--   h.quantity,
--   h.total_cost_thb,
--   h.current_value_thb,
--   (h.current_value_thb - h.total_cost_thb) AS gain_loss_thb,
--   ROUND((h.current_value_thb - h.total_cost_thb) / h.total_cost_thb * 100, 2) AS gain_loss_pct
-- FROM holdings h
-- WHERE h.portfolio_id = 'arthy-portfolio-001'
-- ORDER BY h.current_value_thb DESC;
