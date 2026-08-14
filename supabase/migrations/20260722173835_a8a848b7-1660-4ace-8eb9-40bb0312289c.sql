
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior job with the same name
DO $$
BEGIN
  PERFORM cron.unschedule('publish-scheduled-posts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'publish-scheduled-posts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b78b31d7-4671-40ce-a64a-e9ce64cbb046.lovable.app/api/public/hooks/publish-scheduled-posts',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
