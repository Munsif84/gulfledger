-- ═══ GulfLedger · check + clean historical expense-payment bank doubles ═══
-- The expense flow inserted an explicit bank withdrawal (source_type='expense')
-- ALONGSIDE the trigger's mirror (source_type='expense_payment' — copied from
-- the journal source). If both exist for the same expense, the explicit one is
-- the duplicate.

-- 1. LOOK: list suspected duplicate pairs
SELECT bt.id, bt.transaction_date, bt.amount, bt.description, bt.source_type
FROM bank_transactions bt
WHERE bt.source_type = 'expense'
  AND EXISTS (
    SELECT 1 FROM bank_transactions m
    WHERE m.account_id = bt.account_id
      AND m.source_type = 'expense_payment'
      AND m.amount = bt.amount
      AND m.transaction_date = bt.transaction_date
  )
ORDER BY bt.transaction_date DESC;

-- 2. If the list is confirmed duplicates, delete them:
-- DELETE FROM bank_transactions bt
-- WHERE bt.source_type = 'expense'
--   AND EXISTS (SELECT 1 FROM bank_transactions m
--     WHERE m.account_id = bt.account_id AND m.source_type='expense_payment'
--       AND m.amount = bt.amount AND m.transaction_date = bt.transaction_date);

-- 3. Rebalance from the ledger:
-- UPDATE bank_accounts SET current_balance = public.bank_account_balance(id),
--   updated_at = NOW() WHERE is_active = true;
