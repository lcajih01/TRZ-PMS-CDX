alter type public.ledger_account_type add value if not exists 'Owner Harvest';

create table if not exists public.owner_harvests (
  id uuid primary key default gen_random_uuid(),
  harvest_date date not null default current_date,
  source_wallet_id uuid not null references public.wallets(id),
  amount numeric(12,2) not null check (amount > 0),
  harvest_type text not null check (harvest_type in ('Owner Draw', 'Business Reserve', 'Debt Payment', 'Personal Expense', 'Bank Deposit', 'Other')),
  reason_notes text not null check (length(trim(reason_notes)) > 0),
  destination text,
  ledger_entry_id uuid references public.ledger_entries(id),
  created_at timestamptz not null default now()
);

alter table public.owner_harvests enable row level security;

revoke all on table public.owner_harvests from anon;

grant select, insert on table public.owner_harvests to anon;

drop policy if exists "anon can read owner harvests" on public.owner_harvests;
create policy "anon can read owner harvests" on public.owner_harvests
for select to anon using (true);

drop policy if exists "anon can create owner harvests" on public.owner_harvests;
create policy "anon can create owner harvests" on public.owner_harvests
for insert to anon with check (
  amount > 0
  and harvest_type in ('Owner Draw', 'Business Reserve', 'Debt Payment', 'Personal Expense', 'Bank Deposit', 'Other')
  and length(trim(reason_notes)) > 0
);

drop policy if exists "anon can create ledger lines" on public.ledger_lines;
create policy "anon can create ledger lines" on public.ledger_lines
for insert to anon with check (
  amount <> 0
);

notify pgrst, 'reload schema';
