-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Branches foundation (Step 1a: schema only, no invoice wiring)
-- ───────────────────────────────────────────────────────────────────────────
-- A "branch" is a CR-registered business unit under the company's single VAT
-- number. Per ZATCA, each branch's invoices must show THAT branch's CR number
-- and national address. This migration creates the branches entity and seeds a
-- "Main Branch" from each business's existing CR/address so nothing is empty.
--
-- Compliance-first design decisions:
--   • Branch is SEPARATE from inventory 'locations' (legal identity ≠ stock place)
--   • CR number + national address live PER BRANCH (the ZATCA mandate)
--   • The 15-digit VAT number stays on the business (one VAT, shared) — branches
--     carry only the 3-digit vat_branch_code segment
--   • A location MAY optionally belong to a branch (nullable link) — flexibility
--     without forcing anything; existing multi-warehouse is untouched
--
-- This migration does NOT touch invoices or ZATCA generation. That's a later,
-- deliberate phase. Safe to run once. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. BRANCHES ─────────────────────────────────────────────────────────────
-- Address fields mirror the businesses table column names exactly, so seeding
-- and the eventual invoice-population logic map 1:1 with no translation.
CREATE TABLE IF NOT EXISTS branches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  name              text NOT NULL,            -- display name (Arabic primary)
  name_ar           text,
  name_en           text,
  branch_code       text,                     -- internal short code, e.g. "RUH"

  -- ── Compliance identity (the ZATCA mandate) ──
  cr_number         text,                     -- this branch's OWN Commercial Registration
  vat_branch_code   text,                     -- 3-digit branch segment of the shared VAT no.

  -- ── National address (mirrors businesses.* exactly) ──
  building_number   text,
  street_name       text,
  district          text,
  city              text,
  postal_code       text,
  additional_number text,
  country           text DEFAULT 'SA',

  -- ── Status ──
  is_main           boolean NOT NULL DEFAULT false,  -- the HQ / default branch
  is_active         boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_branches_business ON branches(business_id);
-- At most one main branch per business (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_one_main
  ON branches(business_id) WHERE is_main = true;


-- ── 2. SEED a Main Branch for every existing business ───────────────────────
-- Copies the business's current CR + national address into a default branch so
-- the feature appears populated immediately and current invoicing identity is
-- preserved. Only creates one where none exists yet.
INSERT INTO branches (
  business_id, name, name_ar, name_en, cr_number,
  building_number, street_name, district, city, postal_code, additional_number, country,
  is_main, is_active
)
SELECT
  b.id,
  COALESCE(b.name, 'الفرع الرئيسي'),
  COALESCE(b.name_ar, 'الفرع الرئيسي'),
  COALESCE(b.name_en, 'Main Branch'),
  b.cr_number,
  b.building_number, b.street_name, b.district, b.city, b.postal_code, b.additional_number,
  COALESCE(b.country, 'SA'),
  true, true
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM branches br WHERE br.business_id = b.id
);


-- ── 3. OPTIONAL location → branch link ──────────────────────────────────────
-- A nullable link: an inventory location MAY belong to a branch. Existing
-- locations stay unlinked (NULL) — multi-warehouse keeps working unchanged.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;


-- ── 4. ROW-LEVEL SECURITY ───────────────────────────────────────────────────
-- READ: any active member of the business may see its branches (a cashier's
--       invoice screen needs to know its branch's CR/address).
-- WRITE: only the business OWNER may create/edit/delete branches — these carry
--       CR numbers that drive legal invoice compliance, so management sits in
--       the same protected tier as team management and business profile.
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_read ON branches;
CREATE POLICY branches_read ON branches
  FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT business_id FROM business_users
    WHERE user_id = auth.uid() AND status = 'active'
  ));

DROP POLICY IF EXISTS branches_write ON branches;
CREATE POLICY branches_write ON branches
  FOR ALL TO authenticated
  USING (business_id IN (
    SELECT business_id FROM business_users
    WHERE user_id = auth.uid() AND status = 'active' AND role = 'owner'
  ))
  WITH CHECK (business_id IN (
    SELECT business_id FROM business_users
    WHERE user_id = auth.uid() AND status = 'active' AND role = 'owner'
  ));
-- ═══════════════════════════════════════════════════════════════════════════
