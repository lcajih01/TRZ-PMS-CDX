create table if not exists public.automation_queue (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  guest_email text,
  automation_type text not null check (automation_type in ('booking_confirmation', 'checkin_reminder', 'thank_you')),
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (booking_id, automation_type)
);

alter table public.automation_queue enable row level security;

revoke all on table public.automation_queue from anon;
grant select on table public.automation_queue to anon;

drop policy if exists "anon can read automation queue" on public.automation_queue;
create policy "anon can read automation queue" on public.automation_queue
for select to anon using (true);

create or replace function public.queue_booking_automation(
  input_booking_id uuid,
  input_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
  target_guest public.guests%rowtype;
  queue_subject text;
  queue_body text;
  queue_scheduled_for timestamptz;
  queue_status text := 'pending';
  queue_error text := null;
begin
  if input_type not in ('booking_confirmation', 'checkin_reminder', 'thank_you') then
    raise exception 'Invalid automation type.';
  end if;

  select * into target_booking
  from public.bookings
  where id = input_booking_id;

  if not found then
    raise exception 'Booking not found.';
  end if;

  select * into target_guest
  from public.guests
  where id = target_booking.guest_id;

  if not found then
    raise exception 'Guest not found.';
  end if;

  if input_type = 'checkin_reminder'
     and target_booking.status in ('Cancelled', 'Refunded', 'Archived') then
    return;
  end if;

  if input_type = 'thank_you'
     and target_booking.status <> 'Completed' then
    return;
  end if;

  if nullif(trim(coalesce(target_guest.email, '')), '') is null then
    queue_status := 'skipped';
    queue_error := 'Guest email missing.';
  end if;

  if input_type = 'booking_confirmation' then
    queue_scheduled_for := now();
    queue_subject := 'Booking Confirmation - ' || target_booking.booking_code;
    queue_body := 'Hi ' || target_guest.full_name || ', your booking ' || target_booking.booking_code || ' has been recorded by The Resthouse Zamboanga.';
  elsif input_type = 'checkin_reminder' then
    queue_scheduled_for := target_booking.start_at - interval '1 day';
    queue_subject := 'Check-in Reminder - ' || target_booking.booking_code;
    queue_body := 'Hi ' || target_guest.full_name || ', this is a reminder for your upcoming stay at The Resthouse Zamboanga.';
  else
    queue_scheduled_for := now();
    queue_subject := 'Thank You - ' || target_booking.booking_code;
    queue_body := 'Hi ' || target_guest.full_name || ', thank you for staying at The Resthouse Zamboanga.';
  end if;

  insert into public.automation_queue(
    booking_id,
    guest_email,
    automation_type,
    subject,
    body,
    status,
    scheduled_for,
    error_message
  )
  values (
    target_booking.id,
    nullif(trim(coalesce(target_guest.email, '')), ''),
    input_type,
    queue_subject,
    queue_body,
    queue_status,
    queue_scheduled_for,
    queue_error
  )
  on conflict (booking_id, automation_type)
  do update set
    guest_email = excluded.guest_email,
    subject = excluded.subject,
    body = excluded.body,
    scheduled_for = excluded.scheduled_for,
    status = case
      when public.automation_queue.status = 'sent' then public.automation_queue.status
      else excluded.status
    end,
    error_message = case
      when public.automation_queue.status = 'sent' then public.automation_queue.error_message
      else excluded.error_message
    end
  where public.automation_queue.status <> 'sent';
end;
$$;

create or replace function public.enqueue_booking_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.queue_booking_automation(new.id, 'booking_confirmation');
    perform public.queue_booking_automation(new.id, 'checkin_reminder');
  elsif tg_op = 'UPDATE' then
    perform public.queue_booking_automation(new.id, 'checkin_reminder');

    if new.status = 'Completed' and old.status is distinct from new.status then
      perform public.queue_booking_automation(new.id, 'thank_you');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_booking_automations on public.bookings;
create trigger trg_enqueue_booking_automations
after insert or update of guest_id, start_at, end_at, status on public.bookings
for each row execute function public.enqueue_booking_automations();

create or replace function public.set_automation_queue_status(
  input_queue_id uuid,
  input_status text,
  input_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_status not in ('pending', 'sent', 'failed', 'skipped') then
    raise exception 'Invalid automation status.';
  end if;

  update public.automation_queue
  set
    status = input_status,
    sent_at = case when input_status = 'sent' then now() else null end,
    error_message = case
      when input_status = 'failed' then coalesce(nullif(trim(input_error_message), ''), 'Marked failed manually.')
      when input_status = 'skipped' then coalesce(nullif(trim(input_error_message), ''), 'Skipped manually.')
      else null
    end
  where id = input_queue_id;

  if not found then
    raise exception 'Automation queue record not found.';
  end if;

  return true;
end;
$$;

grant execute on function public.set_automation_queue_status(uuid, text, text) to anon;
grant execute on function public.queue_booking_automation(uuid, text) to anon;

notify pgrst, 'reload schema';
