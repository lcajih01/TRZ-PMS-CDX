do $$
declare
  existing_function regprocedure;
begin
  for existing_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'perform_checkout_settlement'
  loop
    execute format('drop function if exists %s', existing_function);
  end loop;
end $$;

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

  if target_booking.status in ('Cancelled', 'Refunded', 'Archived') then
    raise exception 'Booking cannot be checked out from its current status.';
  end if;

  damage_amount := coalesce(damage_amount, 0);
  refund_amount := coalesce(refund_amount, 0);

  if damage_amount < 0 then
    raise exception 'Damage/Penalty deduction cannot be negative.';
  end if;

  if refund_amount < 0 then
    raise exception 'Refund amount cannot be negative.';
  end if;

  if end_meter_reading is not null and end_meter_reading < 0 then
    raise exception 'Ending meter reading cannot be negative.';
  end if;

  if electricity_rate_per_kwh is not null and electricity_rate_per_kwh < 0 then
    raise exception 'Electricity rate cannot be negative.';
  end if;

  if (end_meter_reading is null) <> (electricity_rate_per_kwh is null) then
    raise exception 'Ending meter reading and rate per kWh must be provided together.';
  end if;

  if end_meter_reading is not null
     and target_booking.start_meter is not null
     and end_meter_reading < target_booking.start_meter then
    raise exception 'Ending meter reading cannot be lower than starting meter reading.';
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
    end_meter = coalesce(end_meter_reading, end_meter),
    rate_per_kwh = coalesce(electricity_rate_per_kwh, rate_per_kwh)
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

grant execute on function public.perform_checkout_settlement(uuid, numeric, text, numeric, uuid, numeric, numeric) to anon;

notify pgrst, 'reload schema';
