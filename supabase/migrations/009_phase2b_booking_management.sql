create or replace function public.enforce_booking_status_flow()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Checked In'
     and old.status is distinct from new.status
     and coalesce(current_setting('app.checkin_payment', true), '') <> 'on' then
    raise exception 'Check-in payment confirmation is required before changing status to Checked In.';
  end if;

  if new.status = 'Completed'
     and old.status <> 'Checked Out'
     and old.status <> 'Completed'
     and coalesce(current_setting('app.checkout_settlement', true), '') <> 'on' then
    raise exception 'Checkout settlement is required before completing a booking.';
  end if;

  if new.status = 'Checked Out'
     and old.status is distinct from new.status
     and coalesce(current_setting('app.checkout_settlement', true), '') <> 'on' then
    raise exception 'Checkout settlement is required before changing status to Checked Out.';
  end if;

  if new.status = 'Archived'
     and old.status not in ('Completed', 'Cancelled', 'Refunded', 'Archived') then
    raise exception 'Only Completed, Cancelled, or Refunded bookings can be archived.';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
