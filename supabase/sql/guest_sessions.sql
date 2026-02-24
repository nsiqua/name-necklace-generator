-- =============================================================
-- Guest Sessions table for Name Necklace Generator
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================

create table if not exists public.guest_sessions (
  guest_id         text        primary key,
  credits_balance  integer     not null default 3,
  unlimited_until  timestamptz null,
  last_seen        timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.guest_sessions enable row level security;

-- Allow anonymous and authenticated users to INSERT their own row
create policy "anon can insert guest_sessions"
  on public.guest_sessions
  for insert
  to anon, authenticated
  with check (true);

-- Allow anonymous and authenticated users to UPDATE any row
-- (tighten this later: with check (guest_id = current_setting('request.cookie.ng_guest_id', true)))
create policy "anon can update guest_sessions"
  on public.guest_sessions
  for update
  to anon, authenticated
  using  (true)
  with check (true);

-- Allow SELECT for debugging (remove or restrict in production)
create policy "anon can select guest_sessions"
  on public.guest_sessions
  for select
  to anon, authenticated
  using (true);
