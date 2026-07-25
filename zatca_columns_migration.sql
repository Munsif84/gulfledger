-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Correct GOSI rates to researched 2026 figures
-- ───────────────────────────────────────────────────────────────────────────
-- The initial seed used placeholder rates. These are the actual rates per
-- multiple 2026 sources (Infura Group, Ratiby, Payroll ME), basic+housing base,
-- SAR 45,000 cap:
--   • Saudi hired BEFORE 3 Jul 2024: total 21.5% = employer 11.75% + employee 9.75%
--       (employer: 9% retirement + 2% occupational hazard + 0.75% unemployment)
--       (employee: 9% retirement + 0.75% unemployment)
--   • Saudi hired ON/AFTER 3 Jul 2024 (new law): total 22.5% as of Feb 2026,
--       rising toward 24% by 2028. Split: employer 12.75% + employee 9.75%.
--       NOTE: the annual step-up schedule should be confirmed against GOSI each
--       year and edited here (or via the Settings UI).
--   • Non-Saudi: 2% occupational hazard, employer only.
--
-- Idempotent: updates the existing rows by category.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE gosi_rates
   SET employer_rate = 0.1175, employee_rate = 0.0975, wage_cap = 45000,
       notes = 'Pre-3-Jul-2024 Saudi: employer 11.75% (9% retire +2% OH +0.75% unemployment), employee 9.75%'
 WHERE category = 'saudi_pre2024';

UPDATE gosi_rates
   SET employer_rate = 0.1275, employee_rate = 0.0975, wage_cap = 45000,
       notes = 'Post-3-Jul-2024 Saudi (new law): total 22.5% as of Feb 2026, rising to 24% by 2028 - verify yearly'
 WHERE category = 'saudi_post2024';

UPDATE gosi_rates
   SET employer_rate = 0.02, employee_rate = 0.0, wage_cap = 45000,
       notes = 'Non-Saudi: 2% occupational hazard, employer only'
 WHERE category = 'non_saudi';

-- Verify:
-- SELECT category, employer_rate, employee_rate, wage_cap FROM gosi_rates ORDER BY category;
-- ═══════════════════════════════════════════════════════════════════════════
