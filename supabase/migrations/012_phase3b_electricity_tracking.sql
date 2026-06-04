alter table public.bookings
  add column if not exists start_meter numeric(12,2) check (start_meter >= 0),
  add column if not exists end_meter numeric(12,2) check (end_meter >= 0),
  add column if not exists rate_per_kwh numeric(12,2) check (rate_per_kwh >= 0);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'kwh_used'
  ) then
    alter table public.bookings
      add column kwh_used numeric(12,2)
      generated always as (
        case
          when start_meter is not null and end_meter is not null then end_meter - start_meter
          else null
        end
      ) stored;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'electricity_cost'
  ) then
    alter table public.bookings
      add column electricity_cost numeric(12,2)
      generated always as (
        case
          when start_meter is not null and end_meter is not null and rate_per_kwh is not null
            then (end_meter - start_meter) * rate_per_kwh
          else null
        end
      ) stored;
  end if;
end $$;

alter table public.bookings
  drop constraint if exists bookings_meter_order,
  add constraint bookings_meter_order check (
    start_meter is null
    or end_meter is null
    or end_meter >= start_meter
  );

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

  if target_booking.status = 'Completed' then
    raise exception 'Completed bookings cannot be checked in.';
  end if;

  if start_meter_reading is null or start_meter_reading < 0 then
    raise exception 'Starting meter reading is required.';
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
    start_meter = start_meter_reading
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

create or replace function public.perform_checkout_settlement(
  input_booking_id uuid,
  damage_amount numeric default 0,
  damage_reason text default '',
  refund_amount numeric default 0,
  refund_wallet_id uuid default null,
  end_meter_reading numeric default null,
  electricity_rate_per_kwh numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings%rowtype;
  refundable_balance numeric(12,2);
  deposit_wallet_id uuid;
  damage_entry_id uuid;
  damage_line_id uuid;
  refund_entry_id uuid;
  refund_line_id uuid;
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
    raise exception 'Completed bookings cannot be checked out again.';
  end if;

  if target_booking.start_meter is null then
    raise exception 'Starting meter reading is required before checkout.';
  end if;

  if end_meter_reading is null or electricity_rate_per_kwh is null then
    raise exception 'Ending meter reading and rate per kWh are required.';
  end if;

  if end_meter_reading < target_booking.start_meter then
    raise exception 'Ending meter reading cannot be lower than starting meter reading.';
  end if;

  if electricity_rate_per_kwh < 0 then
    raise exception 'Electricity rate cannot be negative.';
  end if;

  damage_amount := coalesce(damage_amount, 0);
  refund_amount := coalesce(refund_amount, 0);

  if damage_amount < 0 then
    raise exception 'Damage/Penalty deduction cannot be negative.';
  end if;

  if refund_amount < 0 then
    raise exception 'Refund amount cannot be negative.';
  end if;

  refundable_balance := target_booking.total_deposit_received - target_booking.total_deposit_refunded;

  if refund_amount > refundable_balance then
    raise exception 'Refund amount cannot exceed refundable deposit balance.';
  end if;

  select ll.wallet_id
  into deposit_wallet_id
  from public.ledger_lines ll
  join public.ledger_entries le on le.id = ll.ledger_entry_id
  where le.booking_id = input_booking_id
    and le.status = 'posted'
    and ll.account_type = 'Security Deposit Liability'
    and ll.amount > 0
  order by le.created_at desc
  limit 1;

  if damage_amount > 0 then
    if deposit_wallet_id is null then
      raise exception 'Damage/Penalty deduction requires a received security deposit.';
    end if;

    insert into public.ledger_entries(booking_id, entry_date, description, status)
    values (
      input_booking_id,
      current_date,
      'Damage/Penalty Charge: ' || coalesce(nullif(trim(damage_reason), ''), 'Checkout settlement'),
      'posted'
    )
    returning id into damage_entry_id;

    insert into public.ledger_lines(ledger_entry_id, wallet_id, account_type, amount)
    values (damage_entry_id, deposit_wallet_id, 'Revenue', damage_amount)
    returning id into damage_line_id;

    insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
    values (
      'ledger_entry',
      damage_entry_id,
      'create',
      jsonb_build_object(
        'booking_id', input_booking_id,
        'ledger_entry_id', damage_entry_id,
        'ledger_line_id', damage_line_id,
        'wallet_id', deposit_wallet_id,
        'account_type', 'Revenue',
        'amount', damage_amount
      ),
      'Damage/Penalty Charge recorded at checkout'
    );
  end if;

  if refund_amount > 0 then
    if refund_wallet_id is null then
      raise exception 'Refund wallet is required when refund amount is greater than zero.';
    end if;

    insert into public.ledger_entries(booking_id, entry_date, description, status)
    values (
      input_booking_id,
      current_date,
      'Security Deposit Refund: ' || coalesce(nullif(trim(damage_reason), ''), 'Checkout settlement'),
      'posted'
    )
    returning id into refund_entry_id;

    insert into public.ledger_lines(ledger_entry_id, wallet_id, account_type, amount)
    values (refund_entry_id, refund_wallet_id, 'Security Deposit Liability', -refund_amount)
    returning id into refund_line_id;

    insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
    values (
      'ledger_entry',
      refund_entry_id,
      'create',
      jsonb_build_object(
        'booking_id', input_booking_id,
        'ledger_entry_id', refund_entry_id,
        'ledger_line_id', refund_line_id,
        'wallet_id', refund_wallet_id,
        'account_type', 'Security Deposit Liability',
        'amount', -refund_amount
      ),
      'Security deposit refund recorded at checkout'
    );
  end if;

  perform set_config('app.checkout_settlement', 'on', true);

  update public.bookings
  set
    status = 'Completed',
    end_meter = end_meter_reading,
    rate_per_kwh = electricity_rate_per_kwh
  where id = input_booking_id;

  insert into public.audit_logs(entity_type, entity_id, action, before_data, after_data, reason)
  values (
    'booking',
    input_booking_id,
    'checkout_settlement',
    to_jsonb(target_booking),
    jsonb_build_object(
      'status', 'Completed',
      'damage_amount', damage_amount,
      'refund_amount', refund_amount,
      'end_meter', end_meter_reading,
      'rate_per_kwh', electricity_rate_per_kwh,
      'reason', coalesce(damage_reason, '')
    ),
    'Checkout settlement confirmed and booking completed'
  );

  return true;
end;
$$;

create or replace function public.correct_booking_electricity(
  input_booking_id uuid,
  manager_code text,
  new_start_meter numeric,
  new_end_meter numeric,
  new_rate_per_kwh numeric
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_booking public.bookings%rowtype;
begin
  select *
  into target_booking
  from public.bookings
  where id = input_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if not public.verify_manager_security_code(manager_code) then
    insert into public.audit_logs(entity_type, entity_id, action, before_data, reason)
    values (
      'booking',
      input_booking_id,
      'electricity_correction_failed',
      to_jsonb(target_booking),
      'manager code rejected'
    );
    return false;
  end if;

  if new_start_meter is not null and new_start_meter < 0 then
    raise exception 'Starting meter reading cannot be negative.';
  end if;

  if new_end_meter is not null and new_end_meter < 0 then
    raise exception 'Ending meter reading cannot be negative.';
  end if;

  if new_rate_per_kwh is not null and new_rate_per_kwh < 0 then
    raise exception 'Electricity rate cannot be negative.';
  end if;

  if new_start_meter is not null and new_end_meter is not null and new_end_meter < new_start_meter then
    raise exception 'Ending meter reading cannot be lower than starting meter reading.';
  end if;

  update public.bookings
  set
    start_meter = new_start_meter,
    end_meter = new_end_meter,
    rate_per_kwh = new_rate_per_kwh
  where id = input_booking_id;

  insert into public.audit_logs(entity_type, entity_id, action, before_data, after_data, reason)
  values (
    'booking',
    input_booking_id,
    'electricity_correction',
    to_jsonb(target_booking),
    jsonb_build_object(
      'start_meter', new_start_meter,
      'end_meter', new_end_meter,
      'rate_per_kwh', new_rate_per_kwh
    ),
    'manager electricity correction'
  );

  return true;
end;
$$;

grant execute on function public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text, numeric) to anon;
grant execute on function public.perform_checkout_settlement(uuid, numeric, text, numeric, uuid, numeric, numeric) to anon;
grant execute on function public.correct_booking_electricity(uuid, text, numeric, numeric, numeric) to anon;

notify pgrst, 'reload schema';
