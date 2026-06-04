create or replace function public.verify_booking_delete_code(input_booking_id uuid, manager_code text)
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
    raise exception 'This booking contains financial records. Use Cancel/Archive instead.';
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

grant execute on function public.verify_booking_delete_code(uuid, text) to anon;
grant execute on function public.delete_test_booking(uuid, text) to anon;

notify pgrst, 'reload schema';
