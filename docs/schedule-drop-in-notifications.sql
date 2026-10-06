-- Run in the hosted Supabase SQL Editor after deploying the notification worker.
-- Reuses the existing receipt worker key in Vault; never prints its value.
-- Rerunning updates only this notification job. The receipt job is unaffected.
do $setup$
declare
  v_job bigint;
  v_command text := $job$
    select net.http_post(
      url := 'https://mmxvfsuxvodcqhiksxzr.supabase.co/functions/v1/drop-in-notification-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets
                   where name = 'nva_receipt_worker_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$;
begin
  if (select count(*) from vault.decrypted_secrets
      where name = 'nva_receipt_worker_key' and decrypted_secret is not null) <> 1 then
    raise exception 'Existing receipt worker Vault key is missing or ambiguous';
  end if;
  select jobid into v_job from cron.job where jobname = 'nva_drop_in_notifications_1m';
  if v_job is null then
    perform cron.schedule('nva_drop_in_notifications_1m', '* * * * *', v_command);
  else
    perform cron.alter_job(v_job, schedule := '* * * * *', command := v_command, active := true);
  end if;
end;
$setup$;

select jobid, jobname, schedule, active
from cron.job where jobname = 'nva_drop_in_notifications_1m';
