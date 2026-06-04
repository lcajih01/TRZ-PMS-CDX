create extension if not exists pgcrypto;

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value_hash text not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

revoke all on table settings from anon, authenticated;

insert into settings(key, value_hash)
values
  ('pms_access_code_hash', crypt('202608', gen_salt('bf'))),
  ('manager_security_code_hash', crypt('329831', gen_salt('bf')))
on conflict (key) do nothing;

create or replace function verify_pms_access_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_hash text;
begin
  select value_hash into stored_hash
  from settings
  where key = 'pms_access_code_hash';

  if stored_hash is null or input_code is null then
    return false;
  end if;

  return stored_hash = crypt(input_code, stored_hash);
end;
$$;

create or replace function verify_manager_security_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_hash text;
begin
  select value_hash into stored_hash
  from settings
  where key = 'manager_security_code_hash';

  if stored_hash is null or input_code is null then
    return false;
  end if;

  return stored_hash = crypt(input_code, stored_hash);
end;
$$;

create or replace function change_pms_access_code(manager_code text, new_pms_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(coalesce(new_pms_code, '')) < 4 then
    raise exception 'New PMS Access Code must be at least 4 characters.';
  end if;

  if not verify_manager_security_code(manager_code) then
    return false;
  end if;

  update settings
  set value_hash = crypt(new_pms_code, gen_salt('bf')),
      updated_at = now()
  where key = 'pms_access_code_hash';

  return true;
end;
$$;

create or replace function change_manager_security_code(current_manager_code text, new_manager_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(coalesce(new_manager_code, '')) < 4 then
    raise exception 'New Manager Security Code must be at least 4 characters.';
  end if;

  if not verify_manager_security_code(current_manager_code) then
    return false;
  end if;

  update settings
  set value_hash = crypt(new_manager_code, gen_salt('bf')),
      updated_at = now()
  where key = 'manager_security_code_hash';

  return true;
end;
$$;

grant execute on function verify_pms_access_code(text) to anon;
grant execute on function verify_manager_security_code(text) to anon;
grant execute on function change_pms_access_code(text, text) to anon;
grant execute on function change_manager_security_code(text, text) to anon;

alter table packages enable row level security;
alter table package_versions enable row level security;
alter table guests enable row level security;
alter table bookings enable row level security;
alter table wallets enable row level security;
alter table ledger_entries enable row level security;
alter table ledger_lines enable row level security;
alter table security_deposits enable row level security;
alter table audit_logs enable row level security;

revoke all on table packages from anon;
revoke all on table package_versions from anon;
revoke all on table guests from anon;
revoke all on table bookings from anon;
revoke all on table wallets from anon;
revoke all on table ledger_entries from anon;
revoke all on table ledger_lines from anon;
revoke all on table security_deposits from anon;
revoke all on table audit_logs from anon;

grant select on table packages to anon;
grant select, insert on table package_versions to anon;
grant select, insert, update on table guests to anon;
grant select, insert, update on table bookings to anon;
grant select, insert on table wallets to anon;
grant select, insert on table ledger_entries to anon;
grant select, insert on table ledger_lines to anon;
grant select on table security_deposits to anon;
grant select, insert on table audit_logs to anon;

drop policy if exists "active users can read packages" on packages;
drop policy if exists "package managers can write packages" on packages;
drop policy if exists "active users can read package versions" on package_versions;
drop policy if exists "package managers can write package versions" on package_versions;
drop policy if exists "guest managers can manage guests" on guests;
drop policy if exists "booking and accounting users can read guests" on guests;
drop policy if exists "guest managers can write guests" on guests;
drop policy if exists "guest managers can update guests" on guests;
drop policy if exists "booking managers can manage bookings" on bookings;
drop policy if exists "booking and accounting users can read bookings" on bookings;
drop policy if exists "booking managers can write bookings" on bookings;
drop policy if exists "booking managers can update bookings" on bookings;
drop policy if exists "wallet users can read wallets" on wallets;
drop policy if exists "wallet managers can write wallets" on wallets;
drop policy if exists "ledger users can read ledger entries" on ledger_entries;
drop policy if exists "ledger users can write ledger entries" on ledger_entries;
drop policy if exists "ledger users can read ledger lines" on ledger_lines;
drop policy if exists "ledger users can write ledger lines" on ledger_lines;
drop policy if exists "deposit users can read deposit helpers" on security_deposits;
drop policy if exists "audit viewers can read audit logs" on audit_logs;
drop policy if exists "active users can insert audit logs" on audit_logs;

drop policy if exists "anon can read packages" on packages;
create policy "anon can read packages" on packages
for select to anon using (true);

drop policy if exists "anon can read package versions" on package_versions;
create policy "anon can read package versions" on package_versions
for select to anon using (true);

drop policy if exists "anon can create package versions" on package_versions;
create policy "anon can create package versions" on package_versions
for insert to anon with check (
  price >= 0
  and included_pax > 0
  and included_rooms >= 0
);

drop policy if exists "anon can read guests" on guests;
create policy "anon can read guests" on guests
for select to anon using (true);

drop policy if exists "anon can create guests" on guests;
create policy "anon can create guests" on guests
for insert to anon with check (
  length(trim(full_name)) > 0
  and length(trim(phone)) > 0
);

drop policy if exists "anon can update guests" on guests;
create policy "anon can update guests" on guests
for update to anon using (true) with check (
  length(trim(full_name)) > 0
  and length(trim(phone)) > 0
);

drop policy if exists "anon can read bookings" on bookings;
create policy "anon can read bookings" on bookings
for select to anon using (true);

drop policy if exists "anon can create bookings" on bookings;
create policy "anon can create bookings" on bookings
for insert to anon with check (
  end_at > start_at
  and pax_count > 0
  and base_price >= 0
  and security_deposit_amount >= 0
);

drop policy if exists "anon can update bookings" on bookings;
create policy "anon can update bookings" on bookings
for update to anon using (true) with check (
  end_at > start_at
  and pax_count > 0
  and base_price >= 0
  and security_deposit_amount >= 0
);

drop policy if exists "anon can read wallets" on wallets;
create policy "anon can read wallets" on wallets
for select to anon using (true);

drop policy if exists "anon can create wallets" on wallets;
create policy "anon can create wallets" on wallets
for insert to anon with check (
  length(trim(name)) > 0
  and sort_order >= 0
);

drop policy if exists "anon can read ledger entries" on ledger_entries;
create policy "anon can read ledger entries" on ledger_entries
for select to anon using (true);

drop policy if exists "anon can create ledger entries" on ledger_entries;
create policy "anon can create ledger entries" on ledger_entries
for insert to anon with check (
  length(trim(description)) > 0
  and status = 'posted'
);

drop policy if exists "anon can read ledger lines" on ledger_lines;
create policy "anon can read ledger lines" on ledger_lines
for select to anon using (true);

drop policy if exists "anon can create ledger lines" on ledger_lines;
create policy "anon can create ledger lines" on ledger_lines
for insert to anon with check (
  amount <> 0
  and account_type <> 'Transfer'
);

drop policy if exists "anon can read security deposits" on security_deposits;
create policy "anon can read security deposits" on security_deposits
for select to anon using (true);

drop policy if exists "anon can read audit logs" on audit_logs;
create policy "anon can read audit logs" on audit_logs
for select to anon using (true);

drop policy if exists "anon can create audit logs" on audit_logs;
create policy "anon can create audit logs" on audit_logs
for insert to anon with check (
  length(trim(entity_type)) > 0
  and length(trim(action)) > 0
);
