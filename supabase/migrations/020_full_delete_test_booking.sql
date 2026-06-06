do $$
declare
  p oid;
begin
  for p in
    select p.oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'delete_test_booking'
  loop
    execute format('drop function if exists %s', p::regprocedure);
  end loop;
end $$;

create or replace function public.delete_test_booking(
  input_booking_id uuid,
  manager_code text,
  confirmation_text text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_booking public.bookings%rowtype;
  expected_confirmation text;
  target_guest_id uuid;
  target_ledger_entry_ids uuid[];
  target_expense_ids uuid[];
  target_drink_sale_ids uuid[];
  target_drink_movement_ids uuid[];
  target_deposit_ids uuid[];
  target_automation_ids uuid[];
begin
  select *
  into target_booking
  from public.bookings
  where id = input_booking_id;

  if not found then
    raise exception 'Booking not found.';
  end if;

  if nullif(trim(coalesce(manager_code, '')), '') is null
     or not public.verify_manager_security_code(manager_code) then
    raise exception 'Wrong Manager Security Code.';
  end if;

  expected_confirmation := 'DELETE ' || target_booking.booking_code;
  if trim(coalesce(confirmation_text, '')) <> expected_confirmation then
    raise exception 'Confirmation text must exactly match %.', expected_confirmation;
  end if;

  target_guest_id := target_booking.guest_id;

  select coalesce(array_agg(e.id), array[]::uuid[])
  into target_expense_ids
  from public.expenses e
  where e.booking_id = input_booking_id;

  select coalesce(array_agg(ds.id), array[]::uuid[])
  into target_drink_sale_ids
  from public.drink_sales ds
  where ds.booking_id = input_booking_id;

  select coalesce(array_agg(dim.id), array[]::uuid[])
  into target_drink_movement_ids
  from public.drink_inventory_movements dim
  where dim.booking_id = input_booking_id;

  select coalesce(array_agg(distinct id), array[]::uuid[])
  into target_ledger_entry_ids
  from (
    select le.id
    from public.ledger_entries le
    where le.booking_id = input_booking_id
    union
    select e.ledger_entry_id
    from public.expenses e
    where e.id = any(target_expense_ids)
      and e.ledger_entry_id is not null
    union
    select ds.ledger_entry_id
    from public.drink_sales ds
    where ds.id = any(target_drink_sale_ids)
      and ds.ledger_entry_id is not null
    union
    select dim.ledger_entry_id
    from public.drink_inventory_movements dim
    where dim.id = any(target_drink_movement_ids)
      and dim.ledger_entry_id is not null
  ) ledger_targets
  where id is not null;

  select coalesce(array_agg(distinct id), array[]::uuid[])
  into target_ledger_entry_ids
  from (
    select unnest(target_ledger_entry_ids) as id
    union
    select le.id
    from public.ledger_entries le
    where le.reversed_entry_id = any(target_ledger_entry_ids)
    union
    select le.reversed_entry_id
    from public.ledger_entries le
    where le.id = any(target_ledger_entry_ids)
      and le.reversed_entry_id is not null
  ) reversal_pairs
  where id is not null;

  select coalesce(array_agg(sd.id), array[]::uuid[])
  into target_deposit_ids
  from public.security_deposits sd
  where sd.booking_id = input_booking_id;

  select coalesce(array_agg(aq.id), array[]::uuid[])
  into target_automation_ids
  from public.automation_queue aq
  where aq.booking_id = input_booking_id;

  delete from public.automation_queue
  where id = any(target_automation_ids);

  delete from public.security_deposits
  where id = any(target_deposit_ids);

  if to_regclass('public.booking_status_history') is not null then
    execute 'delete from public.booking_status_history where booking_id = $1'
    using input_booking_id;
  end if;

  delete from public.drink_inventory_movements
  where id = any(target_drink_movement_ids)
     or ledger_entry_id = any(target_ledger_entry_ids);

  delete from public.drink_sales
  where id = any(target_drink_sale_ids);

  delete from public.expenses
  where id = any(target_expense_ids);

  delete from public.ledger_lines
  where ledger_entry_id = any(target_ledger_entry_ids);

  delete from public.ledger_entries
  where id = any(target_ledger_entry_ids);

  delete from public.bookings
  where id = input_booking_id;

  delete from public.guests g
  where g.id = target_guest_id
    and not exists (
      select 1
      from public.bookings b
      where b.guest_id = g.id
    );

  return true;
end;
$$;

grant execute on function public.delete_test_booking(uuid, text, text) to anon;

notify pgrst, 'reload schema';
