-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Per-user branch assignment (Step 1b foundation)
-- ───────────────────────────────────────────────────────────────────────────
-- Each membership (a user within a business) can belong to a branch. This is
-- what lets an invoice default to "the user's branch" — a Riyadh cashier's
-- invoices default to Riyadh because they're assigned to it.
--
-- Nullable: a user with no branch assignment falls back to the business's main
-- branch at invoice time. Existing members are seeded to the main branch so the
-- default works immediately. Additive, safe to run once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add branch link to memberships ───────────────────────────────────────
ALTER TABLE business_users
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_users_branch ON business_users(branch_id);


-- ── 2. Seed existing members to their business's main branch ─────────────────
-- So "default to my branch" resolves immediately for everyone. Only sets where
-- not already assigned.
UPDATE business_users bu
   SET branch_id = (
     SELECT br.id FROM branches br
     WHERE br.business_id = bu.business_id AND br.is_main = true
     LIMIT 1
   )
 WHERE bu.branch_id IS NULL;


-- ── 3. Add branch_id to invoices (the data layer — NOT the ZATCA XML) ────────
-- Records which branch issued each invoice. This is safe, testable data: it
-- powers the branch picker default, the invoice display/PDF seller details, and
-- branch-level sales reporting. It does NOT touch ZATCA hash/XML generation —
-- that injection is deliberately deferred until the hash issue is resolved.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_branch ON invoices(branch_id);

-- Backfill existing invoices to the main branch so reporting has no NULL gaps.
UPDATE invoices i
   SET branch_id = (
     SELECT br.id FROM branches br
     WHERE br.business_id = i.business_id AND br.is_main = true
     LIMIT 1
   )
 WHERE i.branch_id IS NULL
   AND EXISTS (SELECT 1 FROM branches br WHERE br.business_id = i.business_id);
-- ═══════════════════════════════════════════════════════════════════════════
