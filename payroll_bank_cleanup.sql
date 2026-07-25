-- ═══ GulfLedger · allow payroll sources in bank_transactions ═══════════════
-- ROOT CAUSE: a trigger mirrors journal entries into bank_transactions using
-- the journal's `source` as `source_type`. The allowed list predates payroll,
-- so every payroll payment/reversal was rolled back wholesale by the check.
-- This recreates the constraint with the payroll family added.

ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_tx_source_type_check;

ALTER TABLE bank_transactions ADD CONSTRAINT bank_tx_source_type_check
CHECK (source_type IS NULL OR source_type = ANY (ARRAY[
  'invoice','payment','credit_note','credit_note_refund','debit_note',
  'invoice_reversal','expense','expense_payment','expense_void','expense_reversal',
  'stock_receipt','receipt_payment','receipt_reversal',
  'manual','transfer','opening','journal','gl_backfill','test',
  -- payroll family (new):
  'payroll','payroll_payment','payroll_reversal','eosb_accrual','eosb_settlement'
]::text[]));

-- OPTIONAL — confirm the mirror-trigger theory (paste the output to Claude):
-- select t.tgname, p.proname
-- from pg_trigger t join pg_proc p on p.oid=t.tgfoid
-- where t.tgrelid in ('journal_entries'::regclass,'journal_lines'::regclass)
--   and not t.tgisinternal;
