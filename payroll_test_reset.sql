-- ═══ GulfLedger · remove the duplicate payroll bank withdrawal ═══
-- The app-inserted duplicate is the one with source_type='manual' and NO
-- reference_number (the trigger's copy carries reference 'PAYROLL-PAY-…').
-- 1. LOOK first:
SELECT id, transaction_date, amount, description, reference_number, source_type
FROM bank_transactions
WHERE source_type = 'manual' AND reference_number IS NULL
  AND description LIKE '%رواتب%';

-- 2. If that shows exactly the duplicate(s), delete them:
DELETE FROM bank_transactions
WHERE source_type = 'manual' AND reference_number IS NULL
  AND description LIKE '%رواتب%';

-- 3. Refresh balances from the ledger (the source of truth):
UPDATE bank_accounts
SET current_balance = public.bank_account_balance(id), updated_at = NOW()
WHERE is_active = true;
