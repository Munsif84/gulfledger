-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Pay Components model (variable pay: bonuses, overtime, etc.)
-- ───────────────────────────────────────────────────────────────────────────
-- Saudi compliance requires different treatment per pay component:
--   • GOSI base  = basic + housing only (capped 45,000)
--   • EOSB base  = basic + housing + FIXED allowances (transport, fixed) — not variable
--   • Gross      = all earnings; Net = gross − employee GOSI − deductions
-- So each component carries: in_gosi_base, in_eosb_base, is_variable, kind.
-- This lets a bonus add to gross WITHOUT inflating GOSI (the #1 compliance error).
--
-- Two layers:
--   • Recurring components live on the employee (basic/housing/transport/fixed) —
--     already on the employees table as columns; unchanged.
--   • Per-period variable components (bonus/overtime/commission/deduction) are
--     entered per run and stored here, frozen with their treatment flags.
-- Additive, safe to run once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. COMPONENT TYPE PRESETS (company-wide reference, guided choices) ───────
CREATE TABLE IF NOT EXISTS pay_component_types (
  code           text PRIMARY KEY,         -- 'bonus','overtime','commission','deduction',...
  label_en       text NOT NULL,
  label_ar       text NOT NULL,
  kind           text NOT NULL DEFAULT 'earning',  -- 'earning' | 'deduction'
  in_gosi_base   boolean NOT NULL DEFAULT false,
  in_eosb_base   boolean NOT NULL DEFAULT false,
  is_variable    boolean NOT NULL DEFAULT true,     -- per-period vs recurring
  is_recurring_field boolean NOT NULL DEFAULT false, -- true = lives on employee record
  display_order  int NOT NULL DEFAULT 100,
  is_active      boolean NOT NULL DEFAULT true
);

INSERT INTO pay_component_types (code,label_en,label_ar,kind,in_gosi_base,in_eosb_base,is_variable,is_recurring_field,display_order)
SELECT * FROM (VALUES
  -- Recurring (live as columns on employees; listed here for reference/treatment)
  ('basic',        'Basic Salary',      'الراتب الأساسي',  'earning', true,  true,  false, true,  10),
  ('housing',      'Housing Allowance', 'بدل السكن',       'earning', true,  true,  false, true,  20),
  ('transport',    'Transport Allowance','بدل المواصلات',  'earning', false, true,  false, true,  30),
  ('fixed_allow',  'Fixed Allowance',   'بدل ثابت',        'earning', false, true,  false, true,  40),
  -- Per-period variable
  ('bonus',        'Bonus / Incentive', 'مكافأة / حافز',   'earning', false, false, true,  false, 50),
  ('commission',   'Commission',        'عمولة',           'earning', false, false, true,  false, 60),
  ('overtime',     'Overtime',          'عمل إضافي',       'earning', false, false, true,  false, 70),
  ('deduction',    'Deduction',         'خصم',             'deduction',false,false, true,  false, 80)
) AS v(code,label_en,label_ar,kind,in_gosi_base,in_eosb_base,is_variable,is_recurring_field,display_order)
WHERE NOT EXISTS (SELECT 1 FROM pay_component_types);


-- ── 2. PER-PERIOD COMPONENTS on a run line (variable pay, frozen) ────────────
CREATE TABLE IF NOT EXISTS payroll_run_line_components (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_line_id    uuid NOT NULL REFERENCES payroll_run_lines(id) ON DELETE CASCADE,
  component_code text NOT NULL,            -- references pay_component_types.code (soft ref)
  label          text,                     -- snapshot of the label at run time
  kind           text NOT NULL DEFAULT 'earning',
  amount         numeric(10,2) NOT NULL DEFAULT 0,
  -- Treatment flags FROZEN at run time (so historical runs stay correct even if
  -- the preset definitions change later)
  in_gosi_base   boolean NOT NULL DEFAULT false,
  in_eosb_base   boolean NOT NULL DEFAULT false,
  is_variable    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prlc_line ON payroll_run_line_components(run_line_id);


-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE pay_component_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pct_read ON pay_component_types;
CREATE POLICY pct_read ON pay_component_types FOR SELECT TO authenticated USING (true);

ALTER TABLE payroll_run_line_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prlc_read ON payroll_run_line_components;
CREATE POLICY prlc_read ON payroll_run_line_components FOR SELECT TO authenticated
  USING (run_line_id IN (
    SELECT rl.id FROM payroll_run_lines rl
    JOIN payroll_runs r ON r.id = rl.run_id
    WHERE r.business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active')
  ));
DROP POLICY IF EXISTS prlc_write ON payroll_run_line_components;
CREATE POLICY prlc_write ON payroll_run_line_components FOR ALL TO authenticated
  USING (run_line_id IN (
    SELECT rl.id FROM payroll_run_lines rl
    JOIN payroll_runs r ON r.id = rl.run_id
    WHERE r.business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant'))
  ))
  WITH CHECK (run_line_id IN (
    SELECT rl.id FROM payroll_run_lines rl
    JOIN payroll_runs r ON r.id = rl.run_id
    WHERE r.business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant'))
  ));
-- ═══════════════════════════════════════════════════════════════════════════
