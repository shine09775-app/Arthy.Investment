-- ============================================================
-- Arthy Investment Coach — schema.sql
-- Cloudflare D1 compatible (SQLite subset — no PRAGMA, no GENERATED columns)
--
-- Deploy:
--   npx wrangler d1 execute arthy-portfolio --file=schema.sql --remote
-- ============================================================

-- ── portfolios ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolios (
  id            TEXT PRIMARY KEY,
  owner_name    TEXT NOT NULL DEFAULT 'Arthy',
  owner_email   TEXT,
  base_currency TEXT NOT NULL DEFAULT 'THB',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── holdings ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS holdings (
  id                     TEXT PRIMARY KEY,
  portfolio_id           TEXT NOT NULL,
  symbol                 TEXT NOT NULL,
  market                 TEXT NOT NULL DEFAULT 'US',
  name                   TEXT NOT NULL,
  asset_type             TEXT NOT NULL DEFAULT 'Stock',
  category               TEXT NOT NULL DEFAULT 'General',
  quantity               REAL NOT NULL DEFAULT 0,
  average_buy_price      REAL NOT NULL DEFAULT 0,
  buy_currency           TEXT NOT NULL DEFAULT 'THB',
  fx_rate                REAL NOT NULL DEFAULT 1,
  total_cost_thb         REAL NOT NULL DEFAULT 0,
  current_price          REAL NOT NULL DEFAULT 0,
  current_price_currency TEXT NOT NULL DEFAULT 'THB',
  buy_date               TEXT,
  risk_level             TEXT NOT NULL DEFAULT 'Medium',
  learning_note          TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio
  ON holdings(portfolio_id);

CREATE INDEX IF NOT EXISTS idx_holdings_symbol
  ON holdings(symbol, market);

-- ── transactions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  holding_id       TEXT NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'BUY',
  quantity         REAL NOT NULL DEFAULT 0,
  price            REAL NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'THB',
  fx_rate          REAL NOT NULL DEFAULT 1,
  fee_thb          REAL NOT NULL DEFAULT 0,
  transaction_date TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transactions_holding
  ON transactions(holding_id);

-- ── monthly_reflections ───────────────────────────────────

CREATE TABLE IF NOT EXISTS monthly_reflections (
  id              TEXT PRIMARY KEY,
  portfolio_id    TEXT NOT NULL,
  month           TEXT NOT NULL,
  total_cost_thb  REAL NOT NULL DEFAULT 0,
  total_value_thb REAL NOT NULL DEFAULT 0,
  health_score    INTEGER NOT NULL DEFAULT 0,
  reflection_text TEXT NOT NULL DEFAULT '',
  ai_summary      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
  UNIQUE (portfolio_id, month)
);

-- ── price_cache ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_cache (
  symbol      TEXT NOT NULL,
  market      TEXT NOT NULL,
  price       REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  change_pct  REAL NOT NULL DEFAULT 0,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, market)
);

-- ── Seed: default portfolio ───────────────────────────────

INSERT OR IGNORE INTO portfolios (id, owner_name, base_currency)
  VALUES ('arthy-001', 'Arthy', 'THB');
