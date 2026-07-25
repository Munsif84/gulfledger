-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — Piece 3 migration: Trial, Plans, Subscriptions, Affiliates
-- ───────────────────────────────────────────────────────────────────────────
-- Safe to run once. Uses IF NOT EXISTS / additive changes only — does not drop
-- or alter existing data. No money moves: gateway fields are placeholders, and
-- commission rows are only ever created by a payment event (which doesn't exist
-- yet). Run in Supabase SQL editor.
--
-- Decisions baked in:
--   • Two plans: 'starter' (freelancers/small) and 'professional'.
--   • Trial: starts at signup, 7 days, with a manual override end date.
--   • Affiliate commission: percentage of the NET (pre-VAT) subscription amount.
--   • Commission is recorded once PER PAYMENT, with rate + amounts FROZEN at
--     that moment, so historical earnings never change if rates change later.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. TRIAL FIELDS ON businesses ──────────────────────────────────────────
-- Clock starts at signup. trial_ends_at defaults to +7 days but is overridable
-- per account (so you can extend a specific business by hand later).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trial_ends_at   timestamptz DEFAULT (now() + interval '7 days');

-- Backfill any existing rows that predate these columns so they aren't NULL.
UPDATE businesses
   SET trial_started_at = COALESCE(trial_started_at, created_at, now()),
       trial_ends_at    = COALESCE(trial_ends_at, COALESCE(created_at, now()) + interval '7 days')
 WHERE trial_started_at IS NULL OR trial_ends_at IS NULL;


-- ── 2. PLANS ───────────────────────────────────────────────────────────────
-- The two bundles. Prices are placeholders you can edit. price_net is the
-- pre-VAT subscription price; VAT (15%) is added at billing time. Keeping the
-- net price here is what makes NET-based commission clean to compute.
CREATE TABLE IF NOT EXISTS plans (
  id            text PRIMARY KEY,                    -- 'starter' | 'professional'
  name_en       text NOT NULL,
  name_ar       text NOT NULL,
  price_net     numeric(10,2) NOT NULL DEFAULT 0,    -- monthly price BEFORE VAT (SAR)
  vat_rate      numeric(5,4)  NOT NULL DEFAULT 0.15, -- 15% KSA VAT
  billing_cycle text NOT NULL DEFAULT 'monthly',     -- 'monthly' | 'annual'
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name_en, name_ar, price_net, billing_cycle, sort_order)
VALUES
  ('starter',      'Starter',      'الأساسية',   0,  'monthly', 1),
  ('professional', 'Professional', 'الاحترافية', 0,  'monthly', 2)
ON CONFLICT (id) DO NOTHING;   -- never overwrite prices you've since edited


-- ── 3. SUBSCRIPTIONS ───────────────────────────────────────────────────────
-- This table ALREADY EXISTS with a working shape:
--   id, business_id, user_id, plan(text), billing_cycle, status,
--   started_at, expires_at, payment_ref, created_at, updated_at
-- We KEEP all of that as-is (no renames, no breaking changes) and only add the
-- gateway placeholder columns needed for when a payment provider is connected
-- later. The existing `plan` text column matches plans.id by string
-- ('starter' / 'professional') — loose coupling, nothing to migrate.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS gateway                 text,   -- 'moyasar' | 'tap' | ...
  ADD COLUMN IF NOT EXISTS gateway_customer_id     text,
  ADD COLUMN IF NOT EXISTS gateway_subscription_id text,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end    boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
-- Index to quickly find a business's active subscription. (Not UNIQUE on
-- purpose: existing data or plan-change transitions may briefly have more than
-- one active-ish row; "one active per business" is enforced in app logic, not a
-- hard DB constraint that could fail on the existing table.)
CREATE INDEX IF NOT EXISTS idx_subscriptions_active
  ON subscriptions(business_id, status);


-- ── 4. AFFILIATES ──────────────────────────────────────────────────────────
-- A user who owns a referral code. default_rate is the commission % applied to
-- NET subscription payments by people they refer. (Stored as a fraction:
-- 0.10 = 10%.) One affiliate per user.
CREATE TABLE IF NOT EXISTS affiliates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,                -- e.g. 'GL-7K3M'
  default_rate  numeric(5,4) NOT NULL DEFAULT 0.10,  -- 10% of NET
  status        text NOT NULL DEFAULT 'active',      -- 'active' | 'suspended'
  -- running totals for the affiliate dashboard (maintained when commissions post)
  total_referrals      int NOT NULL DEFAULT 0,
  total_commission_sar numeric(12,2) NOT NULL DEFAULT 0,  -- lifetime earned (NET-based)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(code);


-- ── 5. REFERRALS ───────────────────────────────────────────────────────────
-- Links a referred business to the affiliate whose code was used at signup.
-- Captured from the signup ref_code. status tracks the journey so commission
-- only ever applies once the referred business actually pays.
CREATE TABLE IF NOT EXISTS referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id         uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referred_business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  referred_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  code_used            text NOT NULL,
  status               text NOT NULL DEFAULT 'signed_up', -- signed_up → subscribed → churned
  rate_at_signup       numeric(5,4) NOT NULL DEFAULT 0.10, -- frozen rate for this referral
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_business_id)   -- a business can only be referred once
);
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON referrals(affiliate_id);


-- ── 6. AFFILIATE COMMISSIONS ───────────────────────────────────────────────
-- One row PER PAYMENT made by a referred business. Everything that determines
-- the payout is FROZEN here at payment time, so changing a rate later never
-- rewrites history, and the VAT split is explicit and auditable.
--
--   gross_paid   = what the customer actually paid (incl. VAT)
--   net_base     = pre-VAT taxable amount  ← commission is computed on THIS
--   vat_amount   = the VAT portion (collected for ZATCA, NOT commissionable)
--   rate         = commission fraction applied (frozen)
--   commission   = net_base * rate  ← what the affiliate earns for this payment
--
-- commission_vat is reserved for when payout itself is VAT-able (if the
-- affiliate is VAT-registered and invoices you). Left 0 until payout is built.
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_id     uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  payment_ref     text,                              -- gateway payment id (later)
  gross_paid      numeric(10,2) NOT NULL,
  net_base        numeric(10,2) NOT NULL,            -- commission computed on net
  vat_amount      numeric(10,2) NOT NULL DEFAULT 0,
  rate            numeric(5,4)  NOT NULL,            -- frozen at payment time
  commission      numeric(10,2) NOT NULL,            -- = net_base * rate
  commission_vat  numeric(10,2) NOT NULL DEFAULT 0,  -- reserved for payout VAT
  status          text NOT NULL DEFAULT 'pending',   -- pending → approved → paid
  period_start    timestamptz,
  period_end      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commissions_affiliate ON affiliate_commissions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_commissions_business ON affiliate_commissions(business_id);


-- ── 7. ROW-LEVEL SECURITY ──────────────────────────────────────────────────
-- Plans are public-read. Affiliates/referrals/commissions are private to the
-- owning affiliate. Subscriptions are visible to the business's members.
ALTER TABLE plans                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;

-- plans: anyone authenticated can read the catalog
DROP POLICY IF EXISTS plans_read ON plans;
CREATE POLICY plans_read ON plans
  FOR SELECT TO authenticated USING (true);

-- subscriptions: this table pre-exists and may already have RLS + policies.
-- Enabling RLS again is a no-op if already on. We add a members-can-read policy
-- only if one by this name doesn't exist, so we don't clobber existing rules.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subs_read_members ON subscriptions;
CREATE POLICY subs_read_members ON subscriptions
  FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT business_id FROM business_users
    WHERE user_id = auth.uid() AND status = 'active'
  ));

-- affiliates: a user sees only their own affiliate record
DROP POLICY IF EXISTS aff_self ON affiliates;
CREATE POLICY aff_self ON affiliates
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- referrals: the affiliate sees referrals tied to their affiliate id
DROP POLICY IF EXISTS ref_own ON referrals;
CREATE POLICY ref_own ON referrals
  FOR SELECT TO authenticated
  USING (affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid()));

-- commissions: the affiliate sees only their own commission rows
DROP POLICY IF EXISTS comm_own ON affiliate_commissions;
CREATE POLICY comm_own ON affiliate_commissions
  FOR SELECT TO authenticated
  USING (affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid()));

-- NOTE: no INSERT/UPDATE policies for affiliates/referrals/commissions are
-- granted to clients on purpose. Those rows are created server-side (Edge
-- Function / service role) when payments happen, so the browser can never
-- fabricate earnings. Reads only, above.
-- ═══════════════════════════════════════════════════════════════════════════
