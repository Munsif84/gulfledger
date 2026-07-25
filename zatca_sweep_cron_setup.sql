-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Payroll RLS: allow accountant (not just owner) to manage payroll
-- ───────────────────────────────────────────────────────────────────────────
-- The payroll UI lets an owner OR accountant run and reverse payroll. The
-- original RLS allowed owner-only writes, which would block accountants at the
-- database level. This aligns the policies with the intended permissions:
-- writes allowed for role IN ('owner','accountant'); reads unchanged (any active
-- member). Safe to run once; replaces the prior write policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- EMPLOYEES
DROP POLICY IF EXISTS employees_write ON employees;
CREATE POLICY employees_write ON employees FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant')))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant')));

-- PAYROLL RUNS
DROP POLICY IF EXISTS payroll_runs_write ON payroll_runs;
CREATE POLICY payroll_runs_write ON payroll_runs FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant')))
  WITH CHECK (business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant')));

-- PAYROLL RUN LINES
DROP POLICY IF EXISTS payroll_lines_write ON payroll_run_lines;
CREATE POLICY payroll_lines_write ON payroll_run_lines FOR ALL TO authenticated
  USING (run_id IN (SELECT id FROM payroll_runs WHERE business_id IN
    (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant'))))
  WITH CHECK (run_id IN (SELECT id FROM payroll_runs WHERE business_id IN
    (SELECT business_id FROM business_users WHERE user_id = auth.uid() AND status='active' AND role IN ('owner','accountant'))));
-- ═══════════════════════════════════════════════════════════════════════════
