-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Add branch_id to credit_notes
-- ───────────────────────────────────────────────────────────────────────────
-- Credit notes inherit the branch of the invoice they reverse (you can't credit
-- a Riyadh sale under Jeddah's CR). This adds the column + backfills existing
-- credit notes from their original invoice. Run ONLY if the column-check showed
-- credit_notes has no branch_id. Safe/additive.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_credit_notes_branch ON credit_notes(branch_id);

-- Backfill existing credit notes from their original invoice's branch.
UPDATE credit_notes cn
   SET branch_id = (
     SELECT i.branch_id FROM invoices i WHERE i.id = cn.original_invoice_id
   )
 WHERE cn.branch_id IS NULL
   AND cn.original_invoice_id IS NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════════
