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
     and target_booking.status in ('Completed', 'Cancelled', 'Refunded', 'Archived') then
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
    queue_scheduled_for := target_booking.start_at - interval '3 days';
    queue_subject := 'Check-in Reminder - ' || target_booking.booking_code;
    queue_body := 'Hi ' || target_guest.full_name || ', this is a reminder for your upcoming stay at The Resthouse Zamboanga.';
  else
    queue_scheduled_for := now() + interval '3 hours';
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

update public.automation_queue aq
set scheduled_for = b.start_at - interval '3 days'
from public.bookings b
where aq.booking_id = b.id
  and aq.automation_type = 'checkin_reminder'
  and aq.status <> 'sent';

update public.automation_queue
set scheduled_for = created_at
where automation_type = 'booking_confirmation'
  and status <> 'sent';

update public.automation_queue aq
set scheduled_for = coalesce(al.created_at, aq.created_at) + interval '3 hours'
from public.bookings b
left join lateral (
  select created_at
  from public.audit_logs
  where entity_type = 'booking'
    and entity_id = b.id
    and action in ('checkout_settlement', 'status_change')
    and coalesce(reason, '') ilike '%completed%'
  order by created_at desc
  limit 1
) al on true
where aq.booking_id = b.id
  and aq.automation_type = 'thank_you'
  and b.status = 'Completed'
  and aq.status <> 'sent';

notify pgrst, 'reload schema';
