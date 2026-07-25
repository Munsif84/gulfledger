-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Branch backfill only
-- ───────────────────────────────────────────────────────────────────────────
-- The branch_id columns already exist on business_users and invoices (added by
-- the earlier multi-location work). So this is BACKFILL ONLY: point existing
-- members and existing invoices at the main branch, so "default to my branch"
-- resolves immediately with no NULL gaps. Safe, idempotent (only fills NULLs).
-- ═══════════════════════════════════════════════════════════════════════════

-- Members → their business's main branch (only where unassigned)
UPDATE business_users bu
   SET branch_id = (
     SELECT br.id FROM branches br
     WHERE br.business_id = bu.business_id AND br.is_main = true
     LIMIT 1
   )
 WHERE bu.branch_id IS NULL
   AND EXISTS (SELECT 1 FROM branches br WHERE br.business_id = bu.business_id AND br.is_main = true);

-- Existing invoices → main branch (only where unassigned), so branch reporting
-- has no NULL gaps.
UPDATE invoices i
   SET branch_id = (
     SELECT br.id FROM branches br
     WHERE br.business_id = i.business_id AND br.is_main = true
     LIMIT 1
   )
 WHERE i.branch_id IS NULL
   AND EXISTS (SELECT 1 FROM branches br WHERE br.business_id = i.business_id AND br.is_main = true);

-- Quick check (optional) — see how many got assigned:
-- SELECT count(*) FILTER (WHERE branch_id IS NOT NULL) AS members_assigned FROM business_users;
-- SELECT count(*) FILTER (WHERE branch_id IS NOT NULL) AS invoices_assigned FROM invoices;
-- ═══════════════════════════════════════════════════════════════════════════
