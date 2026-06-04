drop function if exists public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text);
drop function if exists public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text, numeric);

create or replace function public.perform_checkin_payment(
  input_booking_id uuid,
  package_payment_amount numeric default 0,
  package_wallet_id uuid default null,
  deposit_payment_amount numeric default 0,
  deposit_wallet_id uuid default null,
  payment_notes text default '',
  start_meter_reading numeric default null
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
  package_line_id uuid;
  deposit_entry_id uuid;
  deposit_line_id uuid;
begin
  select *
  into target_booking
  from public.bookings
  where id = input_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if target_booking.status = 'Checked In' then
    raise exception 'Booking is already checked in.';
  end if;

  if target_booking.status in ('Checked Out', 'Completed', 'Cancelled', 'Refunded', 'Archived') then
    raise exception 'Booking cannot be checked in from its current status.';
  end if;

  if start_meter_reading is not null and start_meter_reading < 0 then
    raise exception 'Starting meter reading cannot be negative.';
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
    values (package_entry_id, package_wallet_id, 'Revenue', package_payment_amount)
    returning id into package_line_id;

    insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
    values (
      'ledger_entry',
      package_entry_id,
      'create',
      jsonb_build_object(
        'booking_id', input_booking_id,
        'ledger_entry_id', package_entry_id,
        'ledger_line_id', package_line_id,
        'wallet_id', package_wallet_id,
        'account_type', 'Revenue',
        'amount', package_payment_amount
      ),
      'Check-in package payment recorded'
    );
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
    values (deposit_entry_id, deposit_wallet_id, 'Security Deposit Liability', deposit_payment_amount)
    returning id into deposit_line_id;

    insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
    values (
      'ledger_entry',
      deposit_entry_id,
      'create',
      jsonb_build_object(
        'booking_id', input_booking_id,
        'ledger_entry_id', deposit_entry_id,
        'ledger_line_id', deposit_line_id,
        'wallet_id', deposit_wallet_id,
        'account_type', 'Security Deposit Liability',
        'amount', deposit_payment_amount
      ),
      'Check-in security deposit payment recorded'
    );
  end if;

  perform set_config('app.checkin_payment', 'on', true);

  update public.bookings
  set
    status = 'Checked In',
    start_meter = coalesce(start_meter_reading, start_meter)
  where id = input_booking_id;

  insert into public.audit_logs(entity_type, entity_id, action, before_data, after_data, reason)
  values (
    'booking',
    input_booking_id,
    'checkin_payment',
    to_jsonb(target_booking),
    jsonb_build_object(
      'status', 'Checked In',
      'package_payment_amount', package_payment_amount,
      'deposit_payment_amount', deposit_payment_amount,
      'start_meter', start_meter_reading,
      'payment_notes', coalesce(payment_notes, '')
    ),
    case
      when package_payment_amount = 0 and deposit_payment_amount = 0 then 'Checked in with no payment recorded'
      else 'Check-in payment confirmed'
    end
  );

  return true;
end;
$$;

grant execute on function public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text, numeric) to anon;

notify pgrst, 'reload schema';
