-- Live scoring: only inside real game hours (NY time), not around the clock.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'live-scoring-refresh'),
  schedule := '*/2 * * * 0,1,4'
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'live-scoring-refresh'),
  command := $cmd$
  select case
    when (extract(dow from now() at time zone 'America/New_York') = 0
          and extract(hour from now() at time zone 'America/New_York') between 12 and 23)
      or (extract(dow from now() at time zone 'America/New_York') in (1,4)
          and extract(hour from now() at time zone 'America/New_York') between 19 and 23)
    then net.http_post(
      url := 'https://project--705471d8-61cd-4526-b4dd-81ea3db52ccf-dev.lovable.app/api/public/cron/live-scoring',
      headers := jsonb_build_object('content-type','application/json','authorization','Bearer '||(select token from public.cron_keys where name='live-scoring')),
      body := '{}'::jsonb
    ) end;
  $cmd$
);

-- Injury feed: the endpoint already throttles itself to ten minutes off-peak,
-- so stop paying for the extra HTTP calls that only get skipped.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'injury-feed'),
  schedule := '*/10 * * * *'
);

-- FFPC live refresh: only during game windows.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'ffpc-live-refresh'),
  command := $cmd$
  select case
    when (extract(dow from now() at time zone 'America/New_York') = 0
          and extract(hour from now() at time zone 'America/New_York') between 12 and 23)
      or (extract(dow from now() at time zone 'America/New_York') in (1,4)
          and extract(hour from now() at time zone 'America/New_York') between 19 and 23)
    then net.http_post(
      url := 'https://project--705471d8-61cd-4526-b4dd-81ea3db52ccf-dev.lovable.app/api/public/cron/ffpc',
      headers := jsonb_build_object('content-type','application/json','authorization','Bearer '||(select token from public.cron_keys where name='live-scoring')),
      body := '{}'::jsonb
    ) end;
  $cmd$
);

-- Compute worker: every 5 minutes during game windows, every 15 otherwise.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'compute-queue-worker'),
  command := $cmd$
  select case
    when (extract(dow from now() at time zone 'America/New_York') = 0
          and extract(hour from now() at time zone 'America/New_York') between 12 and 23)
      or (extract(dow from now() at time zone 'America/New_York') in (1,4)
          and extract(hour from now() at time zone 'America/New_York') between 19 and 23)
      or extract(minute from now()) % 15 = 0
    then net.http_post(
      url := 'https://project--705471d8-61cd-4526-b4dd-81ea3db52ccf-dev.lovable.app/api/public/cron/compute',
      headers := jsonb_build_object('content-type','application/json','authorization','Bearer '||(select token from public.cron_keys where name='live-scoring')),
      body := '{}'::jsonb
    ) end;
  $cmd$
);
