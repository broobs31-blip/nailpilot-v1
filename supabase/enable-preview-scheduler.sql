-- OPTIONAL: run ONLY after validating the dedicated NailPilot preview database.
-- No external message delivery. No Vercel production Cron Job.
-- Uses the database compute already provisioned; do not upgrade a plan for this.
create extension if not exists pg_cron;
select cron.schedule('nailpilot-preview-notifications', '*/5 * * * *', 'select public.np_refresh_notifications();');
