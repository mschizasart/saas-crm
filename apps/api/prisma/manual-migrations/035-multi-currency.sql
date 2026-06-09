-- ─────────────────────────────────────────────────────────────
--  Migration: 035 — Multi-currency + daily FX rates (Wave F3)
--
--  Adds:
--    * `fx_currencies` — GLOBAL ISO-4217 reference table (no org_id).
--      The same for every tenant; seeded with 20 common currencies.
--      Distinct from the existing per-org `currencies` table (which
--      stores per-tenant formatting prefs + a legacy `exchangeRate`).
--
--    * `exchange_rates` — PER-ORG daily FX rates. One row per
--      (org, from, to, date, source). `source` distinguishes ECB
--      auto-pulled feeds from manual admin overrides so a daily
--      refresh can't overwrite a hand-set rate.
--
--    * `organizations.base_currency` — the tenant's reporting
--      currency. Defaults to 'USD'. The existing per-org `currencies`
--      table has its own `isDefault` flag for legacy formatting
--      lookups; this new column is the canonical base for FX maths.
--
--  Indexes:
--    * (org, from, to, date DESC) on `exchange_rates` — powers the
--      "latest rate at or before date" query inside FxService.getRate().
--
--  Idempotency:
--    * CREATE TABLE IF NOT EXISTS
--    * Currency seed uses ON CONFLICT (code) DO NOTHING
--    * The ALTER TABLE for organizations.base_currency is guarded
--      with an information_schema check.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Global currency reference ──────────────────────────────

CREATE TABLE IF NOT EXISTS "fx_currencies" (
  "code"           TEXT PRIMARY KEY,            -- ISO 4217, e.g. 'USD'
  "name"           TEXT NOT NULL,
  "symbol"         TEXT NOT NULL,
  "decimalPlaces"  INTEGER NOT NULL DEFAULT 2
);

-- Seed ≥ 20 common currencies. Idempotent — re-runs are no-ops.
INSERT INTO "fx_currencies" ("code", "name", "symbol", "decimalPlaces") VALUES
  ('USD', 'US Dollar',           '$',   2),
  ('EUR', 'Euro',                 '€',   2),
  ('GBP', 'British Pound',        '£',   2),
  ('JPY', 'Japanese Yen',         '¥',   0),
  ('CAD', 'Canadian Dollar',      'C$',  2),
  ('AUD', 'Australian Dollar',    'A$',  2),
  ('CHF', 'Swiss Franc',          'CHF', 2),
  ('CNY', 'Chinese Yuan',         '¥',   2),
  ('INR', 'Indian Rupee',         '₹',   2),
  ('BRL', 'Brazilian Real',       'R$',  2),
  ('MXN', 'Mexican Peso',         'Mex$',2),
  ('KRW', 'South Korean Won',     '₩',   0),
  ('SGD', 'Singapore Dollar',     'S$',  2),
  ('HKD', 'Hong Kong Dollar',     'HK$', 2),
  ('NZD', 'New Zealand Dollar',   'NZ$', 2),
  ('NOK', 'Norwegian Krone',      'kr',  2),
  ('SEK', 'Swedish Krona',        'kr',  2),
  ('DKK', 'Danish Krone',         'kr',  2),
  ('ZAR', 'South African Rand',   'R',   2),
  ('TRY', 'Turkish Lira',         '₺',   2)
ON CONFLICT ("code") DO NOTHING;

-- ─── 2. Per-org exchange rates ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT NOT NULL,
  "fromCurrency"    TEXT NOT NULL,
  "toCurrency"      TEXT NOT NULL,
  "rate"            NUMERIC(20, 10) NOT NULL,
  "date"            DATE NOT NULL,
  -- 'manual' = admin override, 'ecb' = European Central Bank daily feed,
  -- 'openexchange' = Open Exchange Rates (reserved for future). Manual
  -- rates take precedence on read — see FxService.getRate() ordering.
  "source"          TEXT NOT NULL DEFAULT 'ecb'
    CHECK ("source" IN ('manual', 'ecb', 'openexchange')),
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rate per (org, pair, day, source). Lets manual + ecb co-exist
  -- for the same day (so a manual override won't collide with the
  -- next morning's auto-refresh).
  CONSTRAINT "exchange_rates_org_pair_date_source_uniq"
    UNIQUE ("organizationId", "fromCurrency", "toCurrency", "date", "source")
);

-- "latest rate at or before X" — used on every convert() call.
CREATE INDEX IF NOT EXISTS "exchange_rates_org_pair_date_idx"
  ON "exchange_rates" ("organizationId", "fromCurrency", "toCurrency", "date" DESC);

-- ─── 3. organizations.base_currency ────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'organizations'
      AND column_name = 'baseCurrency'
  ) THEN
    ALTER TABLE "organizations"
      ADD COLUMN "baseCurrency" TEXT NOT NULL DEFAULT 'USD';
  END IF;
END $$;

COMMIT;
