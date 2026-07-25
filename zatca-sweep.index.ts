-- ═══ GulfLedger · one-time cleanup after the payment-bug test session ═══
-- 1. Remove the six orphaned EMPTY payroll_payment journal headers
--    (headers whose line inserts failed — no lines attached).
DELETE FROM journal_entries e
WHERE e.source = 'payroll_payment'
  AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = e.id);

-- 2. The duplicate accrual: you have TWO 'PAYROLL-2026-07' runs. Keep ONE.
--    Use the app's Reverse button on the extra run (audit-safe), OR if you
--    prefer wiping the duplicate test data entirely, uncomment below and
--    replace the id after checking:
-- SELECT id, created_at, total_gross FROM payroll_runs
--   WHERE period_year=2026 AND period_month=7 ORDER BY created_at;
-- (then reverse the newer one from the app)
