create or replace function public.enforce_booking_status_flow()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Completed' and old.status <> 'Checked Out' and old.status <> 'Completed' then
    raise exception 'Booking must be Checked Out before it can be Completed.';
  end if;

  if new.status = 'Checked In'
     and old.status is distinct from new.status
     and coalesce(current_setting('app.checkin_payment', true), '') <> 'on' then
    raise exception 'Check-in payment confirmation is required before changing status to Checked In.';
  end if;

  if new.status = 'Checked Out'
     and old.status is distinct from new.status
     and coalesce(current_setting('app.checkout_settlement', true), '') <> 'on' then
    raise exception 'Checkout settlement is required before changing status to Checked Out.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_status_flow on public.bookings;
create trigger trg_enforce_booking_status_flow
before update of status on public.bookings
for each row execute function public.enforce_booking_status_flow();

create or replace function public.perform_checkin_payment(
  input_booking_id uuid,
  package_payment_amount numeric default 0,
  package_wallet_id uuid default null,
  deposit_payment_amount numeric default 0,
  deposit_wallet_id uuid default null,
  payment_notes text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
  package_balance numeric(12,2);
  deposit_balance numeric(12,2);
  package_entry_id uuid;
  deposit_entry_id uuid;
begin
  select *
  into target_booking
  from public.bookings
  where id = input_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if target_booking.status = 'Completed' then
    raise exception 'Completed bookings cannot be checked in.';
  end if;

  package_payment_amount := coalesce(package_payment_amount, 0);
  deposit_payment_amount := coalesce(deposit_payment_amount, 0);
  package_balance := greatest(target_booking.base_price - target_booking.total_revenue, 0);
  deposit_balance := greatest(target_booking.security_deposit_amount - target_booking.total_deposit_received, 0);

  if package_payment_amount < 0 then
    raise exception 'Package payment amount cannot be negative.';
  end if;

  if deposit_payment_amount < 0 then
    raise exception 'Security deposit payment amount cannot be negative.';
  end if;

  if package_payment_amount > package_balance then
    raise exception 'Package payment cannot exceed balance due.';
  end if;

  if deposit_payment_amount > deposit_balance then
    raise exception 'Security deposit payment cannot exceed remaining deposit balance.';
  end if;

  if package_payment_amount > 0 and package_wallet_id is null then
    raise exception 'Package payment wallet is required.';
  end if;

  if deposit_payment_amount > 0 and deposit_wallet_id is null then
    raise exception 'Security deposit wallet is required.';
  end if;

  if package_payment_amount > 0 then
    insert into public.ledger_entries(booking_id, entry_date, description, status)
    values (
      input_booking_id,
      current_date,
      'Check-in package payment: ' || coalesce(nullif(trim(payment_notes), ''), 'Check-in payment'),
      'posted'
    )
    returning id into package_entry_id;

    insert into public.ledger_lines(ledger_entry_id, wallet_id, account_type, amount)
    values (package_entry_id, package_wallet_id, 'Revenue', package_payment_amount);
  end if;

  if deposit_payment_amount > 0 then
    insert into public.ledger_entries(booking_id, entry_date, description, status)
    values (
      input_booking_id,
      current_date,
      'Check-in security deposit payment: ' || coalesce(nullif(trim(payment_notes), ''), 'Check-in payment'),
      'posted'
    )
    returning id into deposit_entry_id;

    insert into public.ledger_lines(ledger_entry_id, wallet_id, account_type, amount)
    values (deposit_entry_id, deposit_wallet_id, 'Security Deposit Liability', deposit_payment_amount);
  end if;

  perform set_config('app.checkin_payment', 'on', true);

  update public.bookings
  set status = 'Checked In'
  where id = input_booking_id;

  return true;
end;
$$;

grant execute on function public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text) to anon;

notify pgrst, 'reload schema';
