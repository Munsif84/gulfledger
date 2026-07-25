-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Payroll foundation (Stage 1: schema + GOSI accounts, no posting yet)
-- ───────────────────────────────────────────────────────────────────────────
-- GulfLedger is an ACCOUNTING system, not an HR system. This module exists to
-- compute the financial side of compensation (gross, GOSI, net) and feed it
-- into the books. It is compliance-anchored to Saudi rules:
--   • GOSI base = basic salary + housing allowance only, capped at SAR 45,000
--   • Rates differ by nationality AND hire date (pre/post 3 July 2024 systems)
--   • Saudi: employer + employee contributions; non-Saudi: 2% employer (OH) only
--   • Rates rise on a schedule through 2028 → stored as DATA, not hardcoded
--
-- This migration creates the schema + the two missing GOSI accounts/roles.
-- It does NOT post journal entries (that's app logic, built next). Additive,
-- safe to run once. Matches the real schema:
--   chart_of_accounts(code, name_ar, name_en, type, normal_balance, ...)
--   account_role_map(business_id, role, account_code, ...)
--   journal_entries(source, source_id, status, ...) / journal_lines(account_code, ...)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. GOSI RATE TABLE (config, not hardcoded) ──────────────────────────────
-- Keyed by category + effective date so the scheduled increases through 2028
-- are data edits, not code changes. Rates are fractions (0.12 = 12%).
CREATE TABLE IF NOT EXISTS gosi_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category        text NOT NULL,            -- 'saudi_pre2024' | 'saudi_post2024' | 'non_saudi'
  label_en        text,
  label_ar        text,
  effective_from  date NOT NULL,
  employer_rate   numeric(6,4) NOT NULL DEFAULT 0,
  employee_rate   numeric(6,4) NOT NULL DEFAULT 0,
  wage_cap        numeric(10,2) NOT NULL DEFAULT 45000,   -- SAR monthly ceiling
  basis           text NOT NULL DEFAULT 'basic_plus_housing',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed current rules (Feb 2026 baseline). These are the company-wide defaults;
-- they are NOT per-business, so no business_id. Adjust here as ZATCA/GOSI update.
INSERT INTO gosi_rates (category, label_en, label_ar, effective_from, employer_rate, employee_rate, wage_cap, basis, notes)
SELECT * FROM (VALUES
  -- Saudi nationals hired BEFORE 3 July 2024 (legacy system)
  ('saudi_pre2024',  'Saudi (pre-Jul-2024)',  'سعودي (قبل يوليو 2024)', DATE '2020-01-01', 0.12,   0.0975, 45000, 'basic_plus_housing', 'Legacy GOSI system; employer 12% + employee 9.75%'),
  -- Saudi nationals hired ON/AFTER 3 July 2024 (new system, rising to 2028)
  ('saudi_post2024', 'Saudi (post-Jul-2024)', 'سعودي (بعد يوليو 2024)', DATE '2024-07-03', 0.1125, 0.1125, 45000, 'basic_plus_housing', 'New GOSI system; progressively increasing toward 2028'),
  -- Non-Saudi: occupational hazard only, employer-paid, no employee share
  ('non_saudi',      'Non-Saudi (OH only)',   'غير سعودي (أخطار مهنية)', DATE '2020-01-01', 0.02,   0.0,    45000, 'basic_plus_housing', 'Occupational hazard 2%, employer only')
) AS v(category,label_en,label_ar,effective_from,employer_rate,employee_rate,wage_cap,basis,notes)
WHERE NOT EXISTS (SELECT 1 FROM gosi_rates);   -- seed only if empty


-- ── 2. EMPLOYEES (accounting-focused, with fields for payslips/WPS later) ────
CREATE TABLE IF NOT EXISTS employees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id        uuid REFERENCES branches(id) ON DELETE SET NULL,  -- respects multi-branch

  -- Identity
  name_ar          text,
  name_en          text,
  employee_code    text,                    -- internal staff number
  nationality      text,                    -- ISO/text; 'SA' => Saudi rules
  is_saudi         boolean NOT NULL DEFAULT false,  -- drives GOSI category
  iqama_or_id      text,                    -- National ID (Saudi) or Iqama (expat)
  gosi_number      text,
  bank_iban        text,                    -- for future WPS / salary transfer

  -- Employment
  hire_date        date,                    -- drives pre/post-2024 GOSI system
  job_title        text,
  contract_type    text,                    -- 'fixed' | 'unlimited'
  status           text NOT NULL DEFAULT 'active',   -- 'active' | 'terminated'
  termination_date date,                    -- for EOSB (later stage)

  -- Salary components (split for GOSI: only basic + housing are contributory)
  basic_salary     numeric(10,2) NOT NULL DEFAULT 0,
  housing_allowance numeric(10,2) NOT NULL DEFAULT 0,
  transport_allowance numeric(10,2) NOT NULL DEFAULT 0,
  other_allowance  numeric(10,2) NOT NULL DEFAULT 0,

  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_business ON employees(business_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);


-- ── 3. PAYROLL RUNS (one per period) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id        uuid REFERENCES branches(id) ON DELETE SET NULL,
  period_year      int NOT NULL,
  period_month     int NOT NULL,            -- 1..12
  status           text NOT NULL DEFAULT 'draft',  -- draft | finalized | posted | reversed
  -- Frozen totals (filled when the run is computed)
  total_gross      numeric(12,2) NOT NULL DEFAULT 0,
  total_gosi_employee numeric(12,2) NOT NULL DEFAULT 0,
  total_gosi_employer numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions numeric(12,2) NOT NULL DEFAULT 0,
  total_net        numeric(12,2) NOT NULL DEFAULT 0,
  -- Accounting link: set when posted (journal_entries.source='payroll', source_id=this id)
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_at        timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_year, period_month, branch_id)  -- one run per period per branch
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_business ON payroll_runs(business_id);


-- ── 4. PAYROLL RUN LINES (one per employee per run, all frozen) ─────────────
CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  -- Snapshot of pay components at run time (so history never shifts)
  basic_salary     numeric(10,2) NOT NULL DEFAULT 0,
  housing_allowance numeric(10,2) NOT NULL DEFAULT 0,
  transport_allowance numeric(10,2) NOT NULL DEFAULT 0,
  other_allowance  numeric(10,2) NOT NULL DEFAULT 0,
  gross            numeric(10,2) NOT NULL DEFAULT 0,
  -- GOSI
  gosi_category    text,                    -- which gosi_rates category applied
  gosi_base        numeric(10,2) NOT NULL DEFAULT 0,   -- min(basic+housing, cap)
  gosi_employee    numeric(10,2) NOT NULL DEFAULT 0,
  gosi_employer    numeric(10,2) NOT NULL DEFAULT 0,
  -- Other adjustments + net
  other_deductions numeric(10,2) NOT NULL DEFAULT 0,
  net_pay          numeric(10,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_run_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_employee ON payroll_run_lines(employee_id);


-- ── 5. GOSI ACCOUNTS + ROLES (auto-created per business) ─────────────────────
-- The role map already has salaries_expense (5400) and salaries_payable (2300),
-- but GOSI needs its own expense + payable so employer contributions and the
-- amount owed to GOSI are tracked separately from net wages. We add:
--   gosi_expense  → 5410 (expense, near salaries_expense 5400)
--   gosi_payable  → 2310 (liability, near salaries_payable 2300)
-- For every business that already has a salaries_expense mapping (i.e. has a
-- chart set up), create the accounts + role rows if missing.

-- 5a. chart_of_accounts rows (per business that has salaries set up)
INSERT INTO chart_of_accounts (business_id, code, name_ar, name_en, type, normal_balance, is_system, is_active, vat_relevant)
SELECT DISTINCT m.business_id, '5410', 'مصروف التأمينات الاجتماعية (GOSI)', 'GOSI Expense (Employer)', 'expense', 'DR', false, true, false
FROM account_role_map m
WHERE m.role = 'salaries_expense'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id = m.business_id AND c.code = '5410');

INSERT INTO chart_of_accounts (business_id, code, name_ar, name_en, type, normal_balance, is_system, is_active, vat_relevant)
SELECT DISTINCT m.business_id, '2310', 'تأمينات اجتماعية مستحقة (GOSI)', 'GOSI Payable', 'liability', 'CR', false, true, false
FROM account_role_map m
WHERE m.role = 'salaries_payable'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.business_id = m.business_id AND c.code = '2310');

-- 5b. Roles gosi_expense / gosi_payable are already registered in role_catalog.
--     (They were added directly; the FK from account_role_map.role is satisfied.)

-- 5c. role-map rows pointing at those accounts
INSERT INTO account_role_map (business_id, role, account_code, mapped_by, source)
SELECT DISTINCT c.business_id, 'gosi_expense', '5410', c.user_id, 'payroll_migration'
FROM chart_of_accounts c
WHERE c.code = '5410'
  AND NOT EXISTS (SELECT 1 FROM account_role_map r WHERE r.business_id = c.business_id AND r.role = 'gosi_expense');

INSERT INTO account_role_map (business_id, role, account_code, mapped_by, source)
SELECT DISTINCT c.business_id, 'gosi_payable', '2310', c.user_id, 'payroll_migration'
FROM chart_of_accounts c
WHERE c.code = '2310'
  AND NOT EXISTS (SELECT 1 FROM account_role_map r WHERE r.business_id = c.business_id AND r.role = 'gosi_payable');


-- ── 6. ROW-LEVEL SECURITY ───────────────────────────────────────────────────
-- gosi_rates: company-wide config, readable by all authenticated users.
ALTER TABLE gosi_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gosi_rates_read ON gosi_rates;
CREATE POLICY gosi_rates_read ON gosi_rates FOR SELECT TO authenticated USING (true);

-- employees / payroll_runs / payroll_run_lines: read by active members,
-- write by OWNER only (payroll is sensitive compensation data).
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employees_read ON employees;
CREATE POLICY employees_read ON employees FOR SELECT TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active'));
DROP POLICY IF EXISTS employees_write ON employees;
CREATE POLICY employees_write ON employees FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner'))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner'));

DROP POLICY IF EXISTS payroll_runs_read ON payroll_runs;
CREATE POLICY payroll_runs_read ON payroll_runs FOR SELECT TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active'));
DROP POLICY IF EXISTS payroll_runs_write ON payroll_runs;
CREATE POLICY payroll_runs_write ON payroll_runs FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner'))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner'));

-- run lines: gated through their parent run's business membership
DROP POLICY IF EXISTS payroll_lines_read ON payroll_run_lines;
CREATE POLICY payroll_lines_read ON payroll_run_lines FOR SELECT TO authenticated
  USING (run_id IN (SELECT id FROM payroll_runs WHERE business_id IN
    (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active')));
DROP POLICY IF EXISTS payroll_lines_write ON payroll_run_lines;
CREATE POLICY payroll_lines_write ON payroll_run_lines FOR ALL TO authenticated
  USING (run_id IN (SELECT id FROM payroll_runs WHERE business_id IN
    (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner')))
  WITH CHECK (run_id IN (SELECT id FROM payroll_runs WHERE business_id IN
    (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role='owner')));
-- ═══════════════════════════════════════════════════════════════════════════
