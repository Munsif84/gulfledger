-- ═══ GulfLedger · PAYROLL TEST-DATA RESET ═══════════════════════════════════
-- Wipes ALL payroll-related test postings for a clean end-to-end run.
-- Employees and settings are KEPT. Journal + bank mirrors + runs are wiped.
-- The bank sync trigger's rows are removed with their journal parents; the
-- final UPDATE recomputes balances from the ledger (source of truth).

-- 1. Bank mirrors of payroll journals
DELETE FROM bank_transactions bt
USING journal_entries je
WHERE bt.source_id = je.id
  AND je.source IN ('payroll','payroll_payment','payroll_reversal','eosb_accrual');

-- Any stray app-inserted payroll bank rows (manual, no reference)
DELETE FROM bank_transactions
WHERE source_type = 'manual' AND reference_number IS NULL AND description LIKE '%رواتب%';

-- 2. Payroll journals (lines cascade via FK)
DELETE FROM journal_entries
WHERE source IN ('payroll','payroll_payment','payroll_reversal','eosb_accrual');

-- 3. Runs + lines, EOSB accruals
DELETE FROM payroll_run_lines;
DELETE FROM payroll_runs;
DELETE FROM eosb_accrual_lines;
DELETE FROM eosb_accruals;

-- 4. Balances back to ledger truth
UPDATE bank_accounts
SET current_balance = public.bank_account_balance(id), updated_at = NOW()
WHERE is_active = true;
