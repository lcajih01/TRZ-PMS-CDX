alter type public.ledger_account_type add value if not exists 'Expense';

alter table public.ledger_entries
  alter column booking_id drop not null,
  add column if not exists reference_number text,
  add column if not exists proof_note text,
  add column if not exists reversed_entry_id uuid references public.ledger_entries(id),
  add column if not exists reversal_reason text,
  add column if not exists reversed_at timestamptz;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  vendor_payee text,
  amount numeric(12,2) not null check (amount > 0),
  wallet_id uuid not null references public.wallets(id),
  booking_id uuid references public.bookings(id),
  notes text,
  ledger_entry_id uuid references public.ledger_entries(id),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null,
  wallet_id uuid not null references public.wallets(id),
  expected_balance numeric(12,2) not null,
  actual_counted_amount numeric(12,2) not null,
  difference numeric(12,2) not null,
  notes text,
  closed_by text not null default 'Manager',
  created_at timestamptz not null default now(),
  unique (closing_date, wallet_id)
);

alter table public.expenses enable row level security;
alter table public.daily_closings enable row level security;

revoke all on table public.expenses from anon;
revoke all on table public.daily_closings from anon;

grant select, insert on table public.expenses to anon;
grant select, insert on table public.daily_closings to anon;
grant update on table public.ledger_entries to anon;

drop policy if exists "anon can read expenses" on public.expenses;
create policy "anon can read expenses" on public.expenses
for select to anon using (true);

drop policy if exists "anon can create expenses" on public.expenses;
create policy "anon can create expenses" on public.expenses
for insert to anon with check (
  amount > 0
  and length(trim(category)) > 0
  and length(trim(description)) > 0
);

drop policy if exists "anon can read daily closings" on public.daily_closings;
create policy "anon can read daily closings" on public.daily_closings
for select to anon using (true);

drop policy if exists "anon can create daily closings" on public.daily_closings;
create policy "anon can create daily closings" on public.daily_closings
for insert to anon with check (
  closed_by = 'Manager'
);

drop policy if exists "anon can mark ledger entries reversed" on public.ledger_entries;
create policy "anon can mark ledger entries reversed" on public.ledger_entries
for update to anon using (true) with check (
  status in ('posted', 'void')
);

drop policy if exists "anon can create ledger lines" on public.ledger_lines;
create policy "anon can create ledger lines" on public.ledger_lines
for insert to anon with check (
  amount <> 0
);

notify pgrst, 'reload schema';
