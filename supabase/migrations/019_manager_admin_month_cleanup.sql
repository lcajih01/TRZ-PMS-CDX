create or replace function public.admin_delete_data_by_month(
  input_year integer,
  input_month integer,
  manager_code text,
  confirmation_text text,
  dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  period_start timestamptz;
  period_end timestamptz;
  month_label text;
  expected_confirmation text;
  target_booking_ids uuid[];
  target_guest_ids uuid[];
  target_ledger_entry_ids uuid[];
  target_expense_ids uuid[];
  target_drink_sale_ids uuid[];
  target_drink_movement_ids uuid[];
  target_automation_ids uuid[];
  target_deposit_ids uuid[];
  target_audit_ids uuid[];
  removable_guest_ids uuid[];
  preview jsonb;
  result jsonb;
begin
  if input_month < 1 or input_month > 12 then
    raise exception 'Month must be between 1 and 12.';
  end if;

  if input_year < 2020 or input_year > 2100 then
    raise exception 'Year is outside the allowed cleanup range.';
  end if;

  if nullif(trim(coalesce(manager_code, '')), '') is null
     or not public.verify_manager_security_code(manager_code) then
    raise exception 'Wrong Manager Security Code.';
  end if;

  period_start := make_timestamptz(input_year, input_month, 1, 0, 0, 0, 'Asia/Manila');
  period_end := period_start + interval '1 month';
  month_label := to_char(period_start at time zone 'Asia/Manila', 'FMMonth YYYY');
  expected_confirmation := 'DELETE ' || upper(month_label);

  select coalesce(array_agg(b.id), array[]::uuid[])
  into target_booking_ids
  from public.bookings b
  where b.start_at >= period_start
    and b.start_at < period_end;

  select coalesce(array_agg(distinct b.guest_id), array[]::uuid[])
  into target_guest_ids
  from public.bookings b
  where b.id = any(target_booking_ids);

  select coalesce(array_agg(e.id), array[]::uuid[])
  into target_expense_ids
  from public.expenses e
  where e.booking_id = any(target_booking_ids);

  select coalesce(array_agg(ds.id), array[]::uuid[])
  into target_drink_sale_ids
  from public.drink_sales ds
  where ds.booking_id = any(target_booking_ids);

  select coalesce(array_agg(dim.id), array[]::uuid[])
  into target_drink_movement_ids
  from public.drink_inventory_movements dim
  where dim.booking_id = any(target_booking_ids);

  select coalesce(array_agg(distinct id), array[]::uuid[])
  into target_ledger_entry_ids
  from (
    select le.id
    from public.ledger_entries le
    where le.booking_id = any(target_booking_ids)
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

  select coalesce(array_agg(aq.id), array[]::uuid[])
  into target_automation_ids
  from public.automation_queue aq
  where aq.booking_id = any(target_booking_ids);

  select coalesce(array_agg(sd.id), array[]::uuid[])
  into target_deposit_ids
  from public.security_deposits sd
  where sd.booking_id = any(target_booking_ids);

  select coalesce(array_agg(al.id), array[]::uuid[])
  into target_audit_ids
  from public.audit_logs al
  where (al.entity_type = 'booking' and al.entity_id = any(target_booking_ids))
     or (al.entity_type in ('ledger_entry', 'ledger') and al.entity_id = any(target_ledger_entry_ids))
     or (al.entity_type = 'security_deposit' and al.entity_id = any(target_deposit_ids))
     or (al.entity_type = 'expense' and al.entity_id = any(target_expense_ids))
     or (al.entity_type = 'drink_sale' and al.entity_id = any(target_drink_sale_ids))
     or (al.entity_type = 'drink_inventory_movement' and al.entity_id = any(target_drink_movement_ids));

  select coalesce(array_agg(g.id), array[]::uuid[])
  into removable_guest_ids
  from public.guests g
  where g.id = any(target_guest_ids)
    and not exists (
      select 1
      from public.bookings remaining
      where remaining.guest_id = g.id
        and remaining.id <> all(target_booking_ids)
    );

  preview := jsonb_build_object(
    'month_label', month_label,
    'expected_confirmation', expected_confirmation,
    'bookings_found', cardinality(target_booking_ids),
    'guests_affected', cardinality(target_guest_ids),
    'guests_to_delete', cardinality(removable_guest_ids),
    'ledger_entries_affected', cardinality(target_ledger_entry_ids),
    'deposits_affected', cardinality(target_deposit_ids),
    'automation_records_affected', cardinality(target_automation_ids),
    'expenses_affected', cardinality(target_expense_ids),
    'drink_sales_affected', cardinality(target_drink_sale_ids),
    'drink_movements_affected', cardinality(target_drink_movement_ids),
    'audit_logs_affected', cardinality(target_audit_ids),
    'dry_run', dry_run
  );

  if dry_run then
    return preview;
  end if;

  if trim(coalesce(confirmation_text, '')) <> expected_confirmation then
    raise exception 'Confirmation text must exactly match %.', expected_confirmation;
  end if;

  insert into public.audit_logs(entity_type, entity_id, action, before_data, reason)
  values ('admin_tools', gen_random_uuid(), 'month_cleanup_started', preview, 'Manager month cleanup');

  delete from public.audit_logs
  where id = any(target_audit_ids);

  delete from public.automation_queue
  where id = any(target_automation_ids);

  delete from public.security_deposits
  where id = any(target_deposit_ids);

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
  where id = any(target_booking_ids);

  delete from public.guests
  where id = any(removable_guest_ids);

  result := preview || jsonb_build_object(
    'dry_run', false,
    'deleted_at', now(),
    'deleted_bookings', cardinality(target_booking_ids),
    'deleted_guests', cardinality(removable_guest_ids)
  );

  insert into public.audit_logs(entity_type, entity_id, action, after_data, reason)
  values ('admin_tools', gen_random_uuid(), 'month_cleanup_completed', result, 'Manager month cleanup');

  return result;
end;
$$;

grant execute on function public.admin_delete_data_by_month(integer, integer, text, text, boolean) to anon;

notify pgrst, 'reload schema';
