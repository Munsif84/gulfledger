-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Payroll settings: per-business GOSI overrides + preferences
-- ───────────────────────────────────────────────────────────────────────────
-- GOSI rates remain GLOBAL + statutory by default (gosi_rates, shared). A
-- business may OPT IN to override a category's rate for its own payroll only;
-- the engine uses the override when present, else the global default. Overriding
-- shifts compliance responsibility to the business (warned in the UI).
--
-- Plus per-business payroll PREFERENCES: pay day, default housing %, overtime
-- multiplier. Additive, safe to run once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. PER-BUSINESS GOSI OVERRIDES (optional, opt-in) ───────────────────────
CREATE TABLE IF NOT EXISTS business_gosi_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category      text NOT NULL,            -- matches gosi_rates.category
  employer_rate numeric(6,4) NOT NULL DEFAULT 0,
  employee_rate numeric(6,4) NOT NULL DEFAULT 0,
  wage_cap      numeric(10,2) NOT NULL DEFAULT 45000,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, category)          -- one override per category per business
);
CREATE INDEX IF NOT EXISTS idx_gosi_overrides_biz ON business_gosi_overrides(business_id);


-- ── 2. PER-BUSINESS PAYROLL PREFERENCES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_settings (
  business_id          uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  pay_day              int  NOT NULL DEFAULT 28,     -- day of month salaries posted (1..28)
  default_housing_pct  numeric(5,2) NOT NULL DEFAULT 25,   -- auto-fill housing as % of basic
  overtime_multiplier  numeric(4,2) NOT NULL DEFAULT 1.5,  -- 150% per Saudi labor law
  default_bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);


-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE business_gosi_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bgo_read ON business_gosi_overrides;
CREATE POLICY bgo_read ON business_gosi_overrides FOR SELECT TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active'));
DROP POLICY IF EXISTS bgo_write ON business_gosi_overrides;
CREATE POLICY bgo_write ON business_gosi_overrides FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')));

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ps_read ON payroll_settings;
CREATE POLICY ps_read ON payroll_settings FOR SELECT TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active'));
DROP POLICY IF EXISTS ps_write ON payroll_settings;
CREATE POLICY ps_write ON payroll_settings FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')));
-- ═══════════════════════════════════════════════════════════════════════════
