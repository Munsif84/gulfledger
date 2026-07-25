-- ═══════════════════════════════════════════════════════════════════════════
-- GulfLedger · schedule zatca-sweep every 5 minutes
-- ───────────────────────────────────────────────────────────────────────────
-- EASIEST PATH — NO SQL (recommended):
--   Supabase Dashboard → Integrations → Cron → Create job
--     Name:      zatca-sweep
--     Schedule:  */5 * * * *          (every 5 minutes)
--     Type:      Supabase Edge Function → pick "zatca-sweep" → method POST
--   The dashboard wires the auth for you. Done — ignore the SQL below.
--
-- SQL FALLBACK (only if you prefer doing it here). Two placeholders to fill:
--   YOUR_SERVICE_ROLE_KEY → Dashboard → Settings → API → service_role (secret!)
-- ═══════════════════════════════════════════════════════════════════════════
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'zatca-sweep',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://ykzivnasjwtuhvjxfxzf.supabase.co/functions/v1/zatca-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To pause later:  select cron.unschedule('zatca-sweep');
-- To inspect runs: select * from cron.job_run_details order by start_time desc limit 20;
