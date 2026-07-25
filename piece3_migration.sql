-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger — subscription_interest (warm-lead capture from plans.html)
-- ───────────────────────────────────────────────────────────────────────────
-- Until the payment gateway is live, the "Subscribe" CTA captures intent here:
-- every person who clicks Subscribe and leaves a phone number is a warm lead to
-- call the day payments launch. Run once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_interest (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  phone       text NOT NULL,
  plan        text,                 -- 'starter' | 'professional' | null
  lang        text,
  contacted   boolean NOT NULL DEFAULT false,  -- you flip this once you've called them
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sub_interest_created ON subscription_interest(created_at DESC);

-- RLS: authenticated users may INSERT their own interest, but cannot read the
-- list (it's a sales lead list — admin/service-role reads only). An anon/logged
-- -in user inserting their own phone is fine; reading everyone's is not.
ALTER TABLE subscription_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sub_interest_insert ON subscription_interest;
CREATE POLICY sub_interest_insert ON subscription_interest
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- No SELECT policy for normal users on purpose → only the service role (your
-- admin tooling / Supabase dashboard) can read the lead list.
-- ═══════════════════════════════════════════════════════════════════════════
