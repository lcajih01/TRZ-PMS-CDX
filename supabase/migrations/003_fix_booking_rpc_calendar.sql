create extension if not exists pgcrypto with schema extensions;

create or replace function public.assign_booking_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_year integer;
  next_number integer;
begin
  if new.booking_code is not null and new.booking_code <> '' then
    return new;
  end if;

  booking_year := extract(year from new.start_at)::integer;

  insert into public.booking_counters(year, last_number)
  values (booking_year, 1)
  on conflict (year)
  do update set last_number = public.booking_counters.last_number + 1
  returning last_number into next_number;

  new.booking_code := 'TRZ-' || booking_year || '-' || lpad(next_number::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_booking_code on public.bookings;
create trigger trg_assign_booking_code
before insert on public.bookings
for each row execute function public.assign_booking_code();

create or replace function public.verify_pms_access_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  select value_hash into stored_hash
  from public.settings
  where key = 'pms_access_code_hash';

  if stored_hash is null or input_code is null then
    return false;
  end if;

  return stored_hash = extensions.crypt(input_code, stored_hash);
end;
$$;

create or replace function public.verify_manager_security_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  select value_hash into stored_hash
  from public.settings
  where key = 'manager_security_code_hash';

  if stored_hash is null or input_code is null then
    return false;
  end if;

  return stored_hash = extensions.crypt(input_code, stored_hash);
end;
$$;

create or replace function public.change_pms_access_code(manager_code text, new_pms_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(new_pms_code, '')) < 4 then
    raise exception 'New PMS Access Code must be at least 4 characters.';
  end if;

  if not public.verify_manager_security_code(manager_code) then
    return false;
  end if;

  update public.settings
  set value_hash = extensions.crypt(new_pms_code, extensions.gen_salt('bf')),
      updated_at = now()
  where key = 'pms_access_code_hash';

  return true;
end;
$$;

create or replace function public.change_manager_security_code(current_manager_code text, new_manager_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(new_manager_code, '')) < 4 then
    raise exception 'New Manager Security Code must be at least 4 characters.';
  end if;

  if not public.verify_manager_security_code(current_manager_code) then
    return false;
  end if;

  update public.settings
  set value_hash = extensions.crypt(new_manager_code, extensions.gen_salt('bf')),
      updated_at = now()
  where key = 'manager_security_code_hash';

  return true;
end;
$$;

grant execute on function public.verify_pms_access_code(text) to anon;
grant execute on function public.verify_manager_security_code(text) to anon;
grant execute on function public.change_pms_access_code(text, text) to anon;
grant execute on function public.change_manager_security_code(text, text) to anon;

insert into public.package_versions (
  package_id,
  version_number,
  price,
  included_pax,
  included_rooms,
  has_breakfast,
  start_time,
  end_time,
  is_overnight
)
select
  p.id,
  coalesce(max(pv.version_number), 0) + 1,
  case p.name when 'Lite Package' then 15000 when 'Standard Package' then 20000 end,
  case p.name when 'Lite Package' then 15 when 'Standard Package' then 25 end,
  case p.name when 'Lite Package' then 6 when 'Standard Package' then 9 end,
  true,
  time '15:00',
  time '12:00',
  true
from public.packages p
left join public.package_versions pv on pv.package_id = p.id
where p.name in ('Lite Package', 'Standard Package')
group by p.id, p.name
having not exists (
  select 1
  from public.package_versions existing
  where existing.package_id = p.id
    and existing.is_overnight = true
    and existing.start_time = time '15:00'
    and existing.end_time = time '12:00'
);

notify pgrst, 'reload schema';
