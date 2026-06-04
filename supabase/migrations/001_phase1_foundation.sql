create extension if not exists pgcrypto;

do $$ begin
  create type booking_status as enum (
    'Inquiry',
    'Tentative',
    'Deposit Requested',
    'Deposit Received',
    'Confirmed',
    'Checked In',
    'Checked Out',
    'Completed',
    'Cancelled',
    'Refunded',
    'Archived'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ledger_status as enum ('posted', 'void');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ledger_account_type as enum (
    'Revenue',
    'Security Deposit Liability',
    'Refund',
    'Adjustment',
    'Transfer'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type security_deposit_status as enum (
    'Not Requested',
    'Requested',
    'Partially Received',
    'Received',
    'Partially Refunded',
    'Refunded'
  );
exception when duplicate_object then null;
end $$;

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null,
  unique (role_id, permission_key)
);

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role_id uuid not null references roles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id),
  version_number integer not null,
  price numeric(12,2) not null check (price >= 0),
  included_pax integer not null check (included_pax > 0),
  included_rooms integer not null check (included_rooms >= 0),
  has_breakfast boolean not null default false,
  start_time time not null,
  end_time time not null,
  is_overnight boolean not null default false,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references user_profiles(id),
  unique (package_id, version_number)
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  alternate_contact_number text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references user_profiles(id)
);

create table if not exists booking_counters (
  year integer primary key,
  last_number integer not null default 0
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique,
  guest_id uuid not null references guests(id),
  package_version_id uuid not null references package_versions(id),
  status booking_status not null default 'Inquiry',
  start_at timestamptz not null,
  end_at timestamptz not null,
  pax_count integer not null check (pax_count > 0),
  base_price numeric(12,2) not null check (base_price >= 0),
  security_deposit_amount numeric(12,2) not null default 5000 check (security_deposit_amount >= 0),
  total_revenue numeric(12,2) not null default 0,
  total_deposit_received numeric(12,2) not null default 0,
  total_deposit_refunded numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references user_profiles(id),
  check (end_at > start_at)
);

alter table bookings
  drop constraint if exists bookings_no_active_overlap;

alter table bookings
  add constraint bookings_no_active_overlap
  exclude using gist (tstzrange(start_at, end_at, '[)') with &&)
  where (status in ('Tentative', 'Deposit Requested', 'Deposit Received', 'Confirmed', 'Checked In'));

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  entry_date date not null default current_date,
  description text not null,
  status ledger_status not null default 'posted',
  created_at timestamptz not null default now(),
  created_by uuid references user_profiles(id)
);

create table if not exists ledger_lines (
  id uuid primary key default gen_random_uuid(),
  ledger_entry_id uuid not null references ledger_entries(id) on delete restrict,
  wallet_id uuid not null references wallets(id),
  account_type ledger_account_type not null,
  amount numeric(12,2) not null check (amount <> 0)
);

create table if not exists security_deposits (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  required_amount numeric(12,2) not null default 5000 check (required_amount >= 0),
  received_amount numeric(12,2) not null default 0 check (received_amount >= 0),
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  status security_deposit_status not null default 'Not Requested',
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create or replace function assign_booking_code()
returns trigger
language plpgsql
as $$
declare
  booking_year integer;
  next_number integer;
begin
  if new.booking_code is not null and new.booking_code <> '' then
    return new;
  end if;

  booking_year := extract(year from new.start_at)::integer;

  insert into booking_counters(year, last_number)
  values (booking_year, 1)
  on conflict (year)
  do update set last_number = booking_counters.last_number + 1
  returning last_number into next_number;

  new.booking_code := 'TRZ-' || booking_year || '-' || lpad(next_number::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_booking_code on bookings;
create trigger trg_assign_booking_code
before insert on bookings
for each row execute function assign_booking_code();

create or replace function create_security_deposit_helper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into security_deposits(booking_id, required_amount)
  values (new.id, new.security_deposit_amount)
  on conflict (booking_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_create_security_deposit_helper on bookings;
create trigger trg_create_security_deposit_helper
after insert on bookings
for each row execute function create_security_deposit_helper();

create or replace function recompute_booking_financials(target_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  revenue_total numeric(12,2);
  deposit_received numeric(12,2);
  deposit_refunded numeric(12,2);
  required_deposit numeric(12,2);
  helper_status security_deposit_status;
begin
  select coalesce(sum(ll.amount), 0)
  into revenue_total
  from ledger_lines ll
  join ledger_entries le on le.id = ll.ledger_entry_id
  where le.booking_id = target_booking_id
    and le.status = 'posted'
    and ll.account_type = 'Revenue';

  select coalesce(sum(ll.amount), 0)
  into deposit_received
  from ledger_lines ll
  join ledger_entries le on le.id = ll.ledger_entry_id
  where le.booking_id = target_booking_id
    and le.status = 'posted'
    and ll.account_type = 'Security Deposit Liability'
    and ll.amount > 0;

  select abs(coalesce(sum(ll.amount), 0))
  into deposit_refunded
  from ledger_lines ll
  join ledger_entries le on le.id = ll.ledger_entry_id
  where le.booking_id = target_booking_id
    and le.status = 'posted'
    and ll.account_type = 'Security Deposit Liability'
    and ll.amount < 0;

  update bookings
  set total_revenue = revenue_total,
      total_deposit_received = deposit_received,
      total_deposit_refunded = deposit_refunded
  where id = target_booking_id
  returning security_deposit_amount into required_deposit;

  helper_status :=
    case
      when deposit_refunded >= deposit_received and deposit_received > 0 then 'Refunded'::security_deposit_status
      when deposit_refunded > 0 then 'Partially Refunded'::security_deposit_status
      when deposit_received >= required_deposit then 'Received'::security_deposit_status
      when deposit_received > 0 then 'Partially Received'::security_deposit_status
      else 'Not Requested'::security_deposit_status
    end;

  update security_deposits
  set required_amount = required_deposit,
      received_amount = deposit_received,
      refunded_amount = deposit_refunded,
      status = helper_status
  where booking_id = target_booking_id;
end;
$$;

create or replace function recompute_from_ledger_line()
returns trigger
language plpgsql
as $$
declare
  target_booking_id uuid;
begin
  select booking_id into target_booking_id
  from ledger_entries
  where id = coalesce(new.ledger_entry_id, old.ledger_entry_id);

  perform recompute_booking_financials(target_booking_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_from_ledger_line on ledger_lines;
create trigger trg_recompute_from_ledger_line
after insert or update or delete on ledger_lines
for each row execute function recompute_from_ledger_line();

create or replace function recompute_from_ledger_entry()
returns trigger
language plpgsql
as $$
begin
  perform recompute_booking_financials(coalesce(new.booking_id, old.booking_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_from_ledger_entry on ledger_entries;
create trigger trg_recompute_from_ledger_entry
after update of status, booking_id on ledger_entries
for each row execute function recompute_from_ledger_entry();

create or replace function prevent_audit_log_changes()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit logs are append-only.';
end;
$$;

drop trigger if exists trg_prevent_audit_log_update on audit_logs;
create trigger trg_prevent_audit_log_update
before update or delete on audit_logs
for each row execute function prevent_audit_log_changes();

insert into roles(name)
values ('Manager'), ('Receptionist'), ('Accounting')
on conflict (name) do nothing;

insert into role_permissions(role_id, permission_key)
select r.id, p.permission_key
from roles r
join (
  values
    ('Manager', 'manage_users'),
    ('Manager', 'manage_packages'),
    ('Manager', 'manage_guests'),
    ('Manager', 'manage_bookings'),
    ('Manager', 'manage_wallets'),
    ('Manager', 'manage_ledger'),
    ('Manager', 'manage_deposits'),
    ('Manager', 'view_audit_logs'),
    ('Receptionist', 'manage_guests'),
    ('Receptionist', 'manage_bookings'),
    ('Accounting', 'manage_wallets'),
    ('Accounting', 'manage_ledger'),
    ('Accounting', 'manage_deposits'),
    ('Accounting', 'view_audit_logs')
) as p(role_name, permission_key) on p.role_name = r.name
on conflict (role_id, permission_key) do nothing;

insert into wallets(name, sort_order)
values ('Cash', 10), ('GCash', 20), ('Maya', 30), ('Bank', 40)
on conflict (name) do nothing;

insert into packages(name)
values ('Day Use'), ('Lite Package'), ('Standard Package')
on conflict (name) do nothing;

insert into package_versions(package_id, version_number, price, included_pax, included_rooms, has_breakfast, start_time, end_time, is_overnight)
select p.id, 1, 10000, 15, 3, false, time '15:00', time '23:00', false
from packages p where p.name = 'Day Use'
on conflict (package_id, version_number) do nothing;

insert into package_versions(package_id, version_number, price, included_pax, included_rooms, has_breakfast, start_time, end_time, is_overnight)
select p.id, 1, 15000, 15, 6, true, time '15:00', time '11:00', true
from packages p where p.name = 'Lite Package'
on conflict (package_id, version_number) do nothing;

insert into package_versions(package_id, version_number, price, included_pax, included_rooms, has_breakfast, start_time, end_time, is_overnight)
select p.id, 1, 20000, 25, 9, true, time '15:00', time '11:00', true
from packages p where p.name = 'Standard Package'
on conflict (package_id, version_number) do nothing;

create or replace function current_profile_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from user_profiles
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function has_permission(required_permission text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_profiles up
    join role_permissions rp on rp.role_id = up.role_id
    where up.auth_user_id = auth.uid()
      and up.is_active = true
      and rp.permission_key = required_permission
  );
$$;

alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table user_profiles enable row level security;
alter table packages enable row level security;
alter table package_versions enable row level security;
alter table guests enable row level security;
alter table bookings enable row level security;
alter table wallets enable row level security;
alter table ledger_entries enable row level security;
alter table ledger_lines enable row level security;
alter table security_deposits enable row level security;
alter table audit_logs enable row level security;

drop policy if exists "active users can read roles" on roles;
create policy "active users can read roles" on roles
for select to authenticated using (current_profile_id() is not null);

drop policy if exists "managers can write roles" on roles;
create policy "managers can write roles" on roles
for all to authenticated using (has_permission('manage_users')) with check (has_permission('manage_users'));

drop policy if exists "active users can read role permissions" on role_permissions;
create policy "active users can read role permissions" on role_permissions
for select to authenticated using (current_profile_id() is not null);

drop policy if exists "managers can write role permissions" on role_permissions;
create policy "managers can write role permissions" on role_permissions
for all to authenticated using (has_permission('manage_users')) with check (has_permission('manage_users'));

drop policy if exists "users can read own profile or managers can read all" on user_profiles;
create policy "users can read own profile or managers can read all" on user_profiles
for select to authenticated using (auth_user_id = auth.uid() or has_permission('manage_users'));

drop policy if exists "managers can write user profiles" on user_profiles;
create policy "managers can write user profiles" on user_profiles
for all to authenticated using (has_permission('manage_users')) with check (has_permission('manage_users'));

drop policy if exists "active users can read packages" on packages;
create policy "active users can read packages" on packages
for select to authenticated using (current_profile_id() is not null);

drop policy if exists "package managers can write packages" on packages;
create policy "package managers can write packages" on packages
for all to authenticated using (has_permission('manage_packages')) with check (has_permission('manage_packages'));

drop policy if exists "active users can read package versions" on package_versions;
create policy "active users can read package versions" on package_versions
for select to authenticated using (current_profile_id() is not null);

drop policy if exists "package managers can write package versions" on package_versions;
create policy "package managers can write package versions" on package_versions
for all to authenticated using (has_permission('manage_packages')) with check (has_permission('manage_packages'));

drop policy if exists "guest managers can manage guests" on guests;
drop policy if exists "booking and accounting users can read guests" on guests;
create policy "booking and accounting users can read guests" on guests
for select to authenticated using (
  has_permission('manage_guests')
  or has_permission('manage_bookings')
  or has_permission('manage_ledger')
  or has_permission('manage_deposits')
);

drop policy if exists "guest managers can write guests" on guests;
create policy "guest managers can write guests" on guests
for insert to authenticated with check (has_permission('manage_guests') or has_permission('manage_bookings'));

drop policy if exists "guest managers can update guests" on guests;
create policy "guest managers can update guests" on guests
for update to authenticated using (has_permission('manage_guests') or has_permission('manage_bookings')) with check (has_permission('manage_guests') or has_permission('manage_bookings'));

drop policy if exists "booking managers can manage bookings" on bookings;
drop policy if exists "booking and accounting users can read bookings" on bookings;
create policy "booking and accounting users can read bookings" on bookings
for select to authenticated using (
  has_permission('manage_bookings')
  or has_permission('manage_ledger')
  or has_permission('manage_deposits')
);

drop policy if exists "booking managers can write bookings" on bookings;
create policy "booking managers can write bookings" on bookings
for insert to authenticated with check (has_permission('manage_bookings'));

drop policy if exists "booking managers can update bookings" on bookings;
create policy "booking managers can update bookings" on bookings
for update to authenticated using (has_permission('manage_bookings')) with check (has_permission('manage_bookings'));

drop policy if exists "wallet users can read wallets" on wallets;
create policy "wallet users can read wallets" on wallets
for select to authenticated using (current_profile_id() is not null);

drop policy if exists "wallet managers can write wallets" on wallets;
create policy "wallet managers can write wallets" on wallets
for all to authenticated using (has_permission('manage_wallets')) with check (has_permission('manage_wallets'));

drop policy if exists "ledger users can read ledger entries" on ledger_entries;
create policy "ledger users can read ledger entries" on ledger_entries
for select to authenticated using (has_permission('manage_ledger') or has_permission('manage_deposits'));

drop policy if exists "ledger users can write ledger entries" on ledger_entries;
create policy "ledger users can write ledger entries" on ledger_entries
for insert to authenticated with check (has_permission('manage_ledger') or has_permission('manage_deposits'));

drop policy if exists "ledger users can read ledger lines" on ledger_lines;
create policy "ledger users can read ledger lines" on ledger_lines
for select to authenticated using (has_permission('manage_ledger') or has_permission('manage_deposits'));

drop policy if exists "ledger users can write ledger lines" on ledger_lines;
create policy "ledger users can write ledger lines" on ledger_lines
for insert to authenticated with check (has_permission('manage_ledger') or has_permission('manage_deposits'));

drop policy if exists "deposit users can read deposit helpers" on security_deposits;
create policy "deposit users can read deposit helpers" on security_deposits
for select to authenticated using (has_permission('manage_deposits') or has_permission('manage_bookings'));

drop policy if exists "audit viewers can read audit logs" on audit_logs;
create policy "audit viewers can read audit logs" on audit_logs
for select to authenticated using (has_permission('view_audit_logs'));

drop policy if exists "active users can insert audit logs" on audit_logs;
create policy "active users can insert audit logs" on audit_logs
for insert to authenticated with check (current_profile_id() is not null);
