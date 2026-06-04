create table if not exists public.electricity_monthly_baselines (
  id uuid primary key default gen_random_uuid(),
  billing_period_month date not null unique,
  start_meter numeric(12,2) not null check (start_meter > 0),
  rate_per_kwh numeric(12,2) not null check (rate_per_kwh > 0),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.electricity_readings (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references public.electricity_monthly_baselines(id) on delete restrict,
  reading_date date not null default current_date,
  current_meter numeric(12,2) not null check (current_meter > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_electricity_readings_baseline_date
on public.electricity_readings(baseline_id, reading_date desc, created_at desc);

alter table public.electricity_monthly_baselines enable row level security;
alter table public.electricity_readings enable row level security;

revoke all on table public.electricity_monthly_baselines from anon;
revoke all on table public.electricity_readings from anon;

grant select, insert on table public.electricity_monthly_baselines to anon;
grant select, insert on table public.electricity_readings to anon;

drop policy if exists "anon can read electricity baselines" on public.electricity_monthly_baselines;
create policy "anon can read electricity baselines" on public.electricity_monthly_baselines
for select to anon using (true);

drop policy if exists "anon can create electricity baselines" on public.electricity_monthly_baselines;
create policy "anon can create electricity baselines" on public.electricity_monthly_baselines
for insert to anon with check (
  start_meter > 0
  and rate_per_kwh > 0
);

drop policy if exists "anon can read electricity readings" on public.electricity_readings;
create policy "anon can read electricity readings" on public.electricity_readings
for select to anon using (true);

drop policy if exists "anon can create electricity readings" on public.electricity_readings;
create policy "anon can create electricity readings" on public.electricity_readings
for insert to anon with check (
  current_meter > 0
);

notify pgrst, 'reload schema';
