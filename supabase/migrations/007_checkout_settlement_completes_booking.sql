create or replace function public.enforce_booking_status_flow()
returns trigger
language plpgsql
as $$
begin
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
  refund_entry_id uuid;
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
    values (damage_entry_id, deposit_wallet_id, 'Revenue', damage_amount);
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
    values (refund_entry_id, refund_wallet_id, 'Security Deposit Liability', -refund_amount);
  end if;

  perform set_config('app.checkout_settlement', 'on', true);

  update public.bookings
  set status = 'Completed'
  where id = input_booking_id;

  return true;
end;
$$;

grant execute on function public.perform_checkout_settlement(uuid, numeric, text, numeric, uuid) to anon;

insert into public.audit_logs(entity_type, entity_id, action, before_data, after_data, reason)
select
  'booking',
  b.id,
  'status_change',
  to_jsonb(b),
  jsonb_build_object('status', 'Completed', 'previous_status', 'Checked Out'),
  'Legacy Checked Out booking completed by checkout workflow migration'
from public.bookings b
where b.status = 'Checked Out';

update public.bookings
set status = 'Completed'
where status = 'Checked Out';

notify pgrst, 'reload schema';
