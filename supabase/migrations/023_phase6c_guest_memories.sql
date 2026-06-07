-- Phase 6C.1: Guest Memories table and Supabase Storage bucket

create table if not exists public.guest_memories (
  id               uuid        primary key default gen_random_uuid(),
  booking_id       uuid        not null references public.bookings(id) on delete cascade,
  photo_url        text,
  card_url         text,
  template_version text        not null default 'v1',
  memory_message   text,
  status           text        not null default 'pending'
                   check (status in ('pending', 'generated', 'sent')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (booking_id)
);

alter table public.guest_memories enable row level security;

revoke all on table public.guest_memories from anon;
grant select, insert, update on table public.guest_memories to anon;

drop policy if exists "anon can manage guest memories" on public.guest_memories;
create policy "anon can manage guest memories" on public.guest_memories
  for all to anon using (true) with check (true);

-- Public storage bucket for memory cards (10 MB per file)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'guest-memories',
  'guest-memories',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage RLS policies
drop policy if exists "anon upload guest-memories" on storage.objects;
create policy "anon upload guest-memories" on storage.objects
  for insert to anon
  with check (bucket_id = 'guest-memories');

drop policy if exists "anon read guest-memories" on storage.objects;
create policy "anon read guest-memories" on storage.objects
  for select to anon
  using (bucket_id = 'guest-memories');

drop policy if exists "anon update guest-memories" on storage.objects;
create policy "anon update guest-memories" on storage.objects
  for update to anon
  using (bucket_id = 'guest-memories');

notify pgrst, 'reload schema';
