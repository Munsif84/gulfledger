-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Payroll module controls (activation, run mode, EOSB)
-- ───────────────────────────────────────────────────────────────────────────
-- Makes payroll an ACTIVATABLE module configured from the Settings page:
--   • payroll_enabled  — master on/off (gated by plan in the UI)
--   • run_mode         — 'manual' | 'auto'
--   • eosb_enabled     — accrue end-of-service liability?
--   • eosb_cadence     — 'monthly' | 'periodic'
--   • eosb_base        — 'basic_plus_fixed' (Article 84) | 'basic_only'
-- Additive; safe to run once. (payroll_settings was created earlier.)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS payroll_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS run_mode    text NOT NULL DEFAULT 'manual';   -- manual | auto
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS eosb_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS eosb_cadence text NOT NULL DEFAULT 'monthly';  -- monthly | periodic
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS eosb_base   text NOT NULL DEFAULT 'basic_plus_fixed'; -- basic_plus_fixed | basic_only


-- ── EOSB ACCRUAL RECORDS (the provision liability built up over time) ────────
-- Each accrual run records the period and the per-employee provision posted,
-- linked to its journal entry. Settlement (final payout) reads the accumulated
-- provision. Audit-safe: never edited, reversible like payroll runs.
CREATE TABLE IF NOT EXISTS eosb_accruals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_year    int NOT NULL,
  period_month   int NOT NULL,
  status         text NOT NULL DEFAULT 'posted',     -- posted | reversed
  total_amount   numeric(12,2) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS idx_eosb_accruals_biz ON eosb_accruals(business_id);

CREATE TABLE IF NOT EXISTS eosb_accrual_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accrual_id     uuid NOT NULL REFERENCES eosb_accruals(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  eosb_base_wage numeric(10,2) NOT NULL DEFAULT 0,   -- the wage base used
  months_accrued numeric(6,3) NOT NULL DEFAULT 0,    -- service fraction this period
  amount         numeric(10,2) NOT NULL DEFAULT 0,   -- provision added this period
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eosb_lines_accrual ON eosb_accrual_lines(accrual_id);

-- EOSB accounting accounts (expense + payable provision), per business with payroll
INSERT INTO chart_of_accounts (business_id, code, name_ar, name_en, type, normal_balance, is_system, is_active, vat_relevant)
SELECT DISTINCT m.business_id, '5420', 'مصروف مكافأة نهاية الخدمة', 'EOSB Expense', 'expense', 'DR', false, true, false
FROM account_role_map m WHERE m.role='salaries_expense'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id=m.business_id AND c.code='5420');
INSERT INTO chart_of_accounts (business_id, code, name_ar, name_en, type, normal_balance, is_system, is_active, vat_relevant)
SELECT DISTINCT m.business_id, '2320', 'مخصص مكافأة نهاية الخدمة', 'EOSB Provision (Payable)', 'liability', 'CR', false, true, false
FROM account_role_map m WHERE m.role='salaries_payable'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id=m.business_id AND c.code='2320');

-- Role-catalog entries (idempotent; FK requires these before mapping)
INSERT INTO role_catalog (role, group_name, display_order, label_en, label_ar, description_en, description_ar, qualifying_types, qualifying_normal, name_patterns_en, name_patterns_ar, code_patterns, is_required, fallback_role, allow_silent_fallback)
SELECT 'eosb_expense','expenses',812,'EOSB Expense','مصروف نهاية الخدمة','End-of-service benefit expense.','مصروف مكافأة نهاية الخدمة.',ARRAY['expense'],'DR',ARRAY['end of service','eosb','gratuity'],ARRAY['نهاية الخدمة','مكافأة'],ARRAY['^5[0-9]+$'],false,'salaries_expense',false
WHERE NOT EXISTS (SELECT 1 FROM role_catalog WHERE role='eosb_expense');
INSERT INTO role_catalog (role, group_name, display_order, label_en, label_ar, description_en, description_ar, qualifying_types, qualifying_normal, name_patterns_en, name_patterns_ar, code_patterns, is_required, fallback_role, allow_silent_fallback)
SELECT 'eosb_payable','expenses',822,'EOSB Provision','مخصص نهاية الخدمة','End-of-service provision liability.','مخصص مكافأة نهاية الخدمة.',ARRAY['liability'],'CR',ARRAY['end of service provision','eosb payable'],ARRAY['مخصص نهاية الخدمة'],ARRAY['^2[0-9]+$'],false,'salaries_payable',false
WHERE NOT EXISTS (SELECT 1 FROM role_catalog WHERE role='eosb_payable');

-- Role mappings (sourced from chart_of_accounts, no self-reference)
INSERT INTO account_role_map (business_id, role, account_code, mapped_by, source)
SELECT DISTINCT c.business_id, 'eosb_expense', '5420', c.user_id, 'eosb_migration'
FROM chart_of_accounts c WHERE c.code='5420'
  AND NOT EXISTS (SELECT 1 FROM account_role_map r WHERE r.business_id=c.business_id AND r.role='eosb_expense');
INSERT INTO account_role_map (business_id, role, account_code, mapped_by, source)
SELECT DISTINCT c.business_id, 'eosb_payable', '2320', c.user_id, 'eosb_migration'
FROM chart_of_accounts c WHERE c.code='2320'
  AND NOT EXISTS (SELECT 1 FROM account_role_map r WHERE r.business_id=c.business_id AND r.role='eosb_payable');

-- RLS for the EOSB tables
ALTER TABLE eosb_accruals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eosb_read ON eosb_accruals;
CREATE POLICY eosb_read ON eosb_accruals FOR SELECT TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active'));
DROP POLICY IF EXISTS eosb_write ON eosb_accruals;
CREATE POLICY eosb_write ON eosb_accruals FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant')));

ALTER TABLE eosb_accrual_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eosb_lines_read ON eosb_accrual_lines;
CREATE POLICY eosb_lines_read ON eosb_accrual_lines FOR SELECT TO authenticated
  USING (accrual_id IN (SELECT id FROM eosb_accruals WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active')));
DROP POLICY IF EXISTS eosb_lines_write ON eosb_accrual_lines;
CREATE POLICY eosb_lines_write ON eosb_accrual_lines FOR ALL TO authenticated
  USING (accrual_id IN (SELECT id FROM eosb_accruals WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant'))))
  WITH CHECK (accrual_id IN (SELECT id FROM eosb_accruals WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id=auth.uid() AND status='active' AND role IN ('owner','accountant'))));
-- ═══════════════════════════════════════════════════════════════════════════
