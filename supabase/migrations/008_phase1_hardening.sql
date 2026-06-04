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

  return new;
end;
$$;

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
  set status = 'Checked In'
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
  refund_wallet_id uuid default null
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
  set status = 'Completed'
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
      'reason', coalesce(damage_reason, '')
    ),
    'Checkout settlement confirmed and booking completed'
  );

  return true;
end;
$$;

create or replace function public.delete_test_booking(input_booking_id uuid, manager_code text)
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
  where id = input_booking_id;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if not public.verify_manager_security_code(manager_code) then
    insert into public.audit_logs(entity_type, entity_id, action, before_data, reason)
    values (
      'booking',
      input_booking_id,
      'delete_failed',
      to_jsonb(target_booking),
      'testing deletion manager code rejected'
    );
    return false;
  end if;

  if exists (
    select 1
    from public.ledger_entries le
    where le.booking_id = input_booking_id
  ) then
    insert into public.audit_logs(entity_type, entity_id, action, before_data, reason)
    values (
      'booking',
      input_booking_id,
      'delete_blocked',
      to_jsonb(target_booking),
      'testing deletion blocked because booking contains financial records'
    );
    return false;
  end if;

  delete from public.security_deposits
  where booking_id = input_booking_id;

  if to_regclass('public.booking_status_history') is not null then
    execute 'delete from public.booking_status_history where booking_id = $1'
    using input_booking_id;
  end if;

  insert into public.audit_logs(entity_type, entity_id, action, before_data, after_data, reason)
  values (
    'booking',
    input_booking_id,
    'delete',
    to_jsonb(target_booking),
    jsonb_build_object('booking_code', target_booking.booking_code, 'deleted', true),
    'testing deletion'
  );

  delete from public.bookings
  where id = input_booking_id;

  return true;
end;
$$;

grant execute on function public.perform_checkin_payment(uuid, numeric, uuid, numeric, uuid, text) to anon;
grant execute on function public.perform_checkout_settlement(uuid, numeric, text, numeric, uuid) to anon;
grant execute on function public.delete_test_booking(uuid, text) to anon;

notify pgrst, 'reload schema';
