create table if not exists public.drink_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Beer',
  cost_per_case numeric(12,2) not null check (cost_per_case >= 0),
  selling_price_per_case numeric(12,2) not null check (selling_price_per_case >= 0),
  commission_per_case numeric(12,2) not null default 0 check (commission_per_case >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.drink_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date date not null default current_date,
  product_id uuid not null references public.drink_products(id),
  movement_type text not null check (movement_type in ('purchase_add_stock', 'sale', 'damage_spoilage', 'adjustment')),
  quantity_cases numeric(12,2) not null check (
    quantity_cases <> 0
    and (movement_type = 'adjustment' or quantity_cases > 0)
  ),
  wallet_id uuid references public.wallets(id),
  booking_id uuid references public.bookings(id),
  notes text,
  ledger_entry_id uuid references public.ledger_entries(id),
  created_at timestamptz not null default now()
);

create table if not exists public.drink_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null default current_date,
  product_id uuid not null references public.drink_products(id),
  booking_id uuid references public.bookings(id),
  quantity_cases numeric(12,2) not null check (quantity_cases > 0),
  wallet_id uuid not null references public.wallets(id),
  sales_amount numeric(12,2) not null check (sales_amount >= 0),
  cost_amount numeric(12,2) not null check (cost_amount >= 0),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  net_profit numeric(12,2) not null,
  notes text,
  ledger_entry_id uuid references public.ledger_entries(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_drink_movements_product_date
on public.drink_inventory_movements(product_id, movement_date);

create index if not exists idx_drink_sales_product_date
on public.drink_sales(product_id, sale_date);

alter table public.drink_products enable row level security;
alter table public.drink_inventory_movements enable row level security;
alter table public.drink_sales enable row level security;

revoke all on table public.drink_products from anon;
revoke all on table public.drink_inventory_movements from anon;
revoke all on table public.drink_sales from anon;

grant select, insert, update on table public.drink_products to anon;
grant select, insert on table public.drink_inventory_movements to anon;
grant select, insert on table public.drink_sales to anon;

drop policy if exists "anon can read drink products" on public.drink_products;
create policy "anon can read drink products" on public.drink_products
for select to anon using (true);

drop policy if exists "anon can create drink products" on public.drink_products;
create policy "anon can create drink products" on public.drink_products
for insert to anon with check (
  length(trim(name)) > 0
  and length(trim(category)) > 0
  and cost_per_case >= 0
  and selling_price_per_case >= 0
  and commission_per_case >= 0
);

drop policy if exists "anon can update drink product status" on public.drink_products;
create policy "anon can update drink product status" on public.drink_products
for update to anon using (true) with check (
  length(trim(name)) > 0
  and length(trim(category)) > 0
  and cost_per_case >= 0
  and selling_price_per_case >= 0
  and commission_per_case >= 0
);

drop policy if exists "anon can read drink movements" on public.drink_inventory_movements;
create policy "anon can read drink movements" on public.drink_inventory_movements
for select to anon using (true);

drop policy if exists "anon can create drink movements" on public.drink_inventory_movements;
create policy "anon can create drink movements" on public.drink_inventory_movements
for insert to anon with check (
  movement_type in ('purchase_add_stock', 'sale', 'damage_spoilage', 'adjustment')
  and quantity_cases <> 0
  and (movement_type = 'adjustment' or quantity_cases > 0)
);

drop policy if exists "anon can read drink sales" on public.drink_sales;
create policy "anon can read drink sales" on public.drink_sales
for select to anon using (true);

drop policy if exists "anon can create drink sales" on public.drink_sales;
create policy "anon can create drink sales" on public.drink_sales
for insert to anon with check (
  quantity_cases > 0
  and sales_amount >= 0
  and cost_amount >= 0
  and commission_amount >= 0
);

insert into public.drink_products(name, category, cost_per_case, selling_price_per_case, commission_per_case, is_active)
values
  ('Red Horse 500ml', 'Beer', 620, 1600, 100, true),
  ('San Mig Pale Pilsen', 'Beer', 880, 1600, 100, true),
  ('San Mig Light', 'Beer', 1050, 1650, 100, true)
on conflict (name) do update
set
  category = excluded.category,
  cost_per_case = excluded.cost_per_case,
  selling_price_per_case = excluded.selling_price_per_case,
  commission_per_case = excluded.commission_per_case;

notify pgrst, 'reload schema';
