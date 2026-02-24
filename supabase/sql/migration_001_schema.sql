-- =============================================================================
-- Migration 001 — Core schema for Name Necklace Generator
-- =============================================================================
-- How to apply:
--   1. Open Supabase Dashboard → SQL Editor → New Query
--   2. Paste this entire file and click Run (Ctrl+Enter)
--   3. Check the output for errors — all statements are idempotent (safe to re-run)
--
-- NOTE: If you previously ran supabase/sql/guest_sessions.sql, the
--       guest_sessions table may already exist with a different schema.
--       If so, DROP TABLE guest_sessions CASCADE before running this script,
--       or run only the ALTER TABLE statements needed to add missing columns.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES
--    One row per authenticated user. Credits live here.
--    Credits are managed exclusively by Edge Functions (service role).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id         uuid        primary key references auth.users (id) on delete cascade,
  is_guest        boolean     not null default false,
  credits_balance int         not null default 0,
  unlimited_until timestamptz null,
  created_at      timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. credits_balance is managed only by Edge Functions.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GUEST SESSIONS
--    One row per anonymous visitor (identified by cookie UUID).
--    Upserted by the frontend; credits managed by Edge Functions.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.guest_sessions (
  guest_id        text        primary key,
  credits_balance int         not null default 3,
  unlimited_until timestamptz null,
  created_at      timestamptz not null default now()
);

-- Add last_seen if this table already existed (migration-safe)
alter table public.guest_sessions
  add column if not exists last_seen timestamptz not null default now();

comment on table public.guest_sessions is
  'One row per anonymous visitor. guest_id is a UUID stored in a browser cookie.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CREDIT LEDGER
--    Append-only audit log of every credit change.
--    Exactly one of user_id / guest_id must be non-null.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id         bigserial   primary key,
  user_id    uuid        null references auth.users (id),
  guest_id   text        null references public.guest_sessions (guest_id),
  delta      int         not null,           -- positive = credit added, negative = consumed
  reason     text        not null,           -- e.g. 'download', 'purchase', 'signup_bonus'
  metadata   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- Enforce exactly one of user_id or guest_id
  constraint credit_ledger_one_owner check (
    (user_id is not null and guest_id is null) or
    (user_id is null     and guest_id is not null)
  )
);

create index if not exists credit_ledger_user_id_idx  on public.credit_ledger (user_id);
create index if not exists credit_ledger_guest_id_idx on public.credit_ledger (guest_id);

comment on table public.credit_ledger is
  'Append-only ledger. Never modified after insert. Written only by Edge Functions.';
comment on column public.credit_ledger.delta is
  'Positive = credits added. Negative = credits consumed.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FEEDBACK
--    Optional; accepts rows from both users and guests.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id         bigserial   primary key,
  user_id    uuid        null references auth.users (id),
  guest_id   text        null,
  message    text        not null,
  created_at timestamptz not null default now()
);

comment on table public.feedback is
  'User/guest submitted feedback. Authenticated users insert via RLS; guests via Edge Function.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PURCHASES
--    Written exclusively by Edge Functions after Stripe webhook confirmation.
--    Clients have no RLS access.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.purchases (
  id               bigserial   primary key,
  user_id          uuid        null references auth.users (id),
  guest_id         text        null,
  stripe_session_id text       not null,
  amount_cents     int         not null,
  credits_granted  int         not null default 0,
  unlimited_until  timestamptz null,
  created_at       timestamptz not null default now()
);

create unique index if not exists purchases_stripe_session_id_idx
  on public.purchases (stripe_session_id);

comment on table public.purchases is
  'Written by Edge Function on Stripe webhook. Clients have read-only access to own rows.';


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Design principle:
--   • Authenticated users (auth.uid()) can READ their own rows.
--   • No authenticated user can directly write credits_balance or ledger rows.
--   • Guests have NO direct table access — all guest writes go through
--     Edge Functions that use the service-role key (bypasses RLS).
--   • anon role gets only the minimum needed for frontend upserts.
-- =============================================================================

-- ─── profiles ────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Allow a user to read their own profile
drop policy if exists "profiles: user can select own row" on public.profiles;
create policy "profiles: user can select own row"
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy → users cannot change credits_balance directly.
-- An Edge Function (service role) is the only writer.

-- Auto-create a profile row on sign-up via a trigger (see below).


-- ─── guest_sessions ──────────────────────────────────────────────────────────
alter table public.guest_sessions enable row level security;

-- Anon role: insert own row (new guest) and update last_seen
drop policy if exists "guest_sessions: anon insert" on public.guest_sessions;
create policy "guest_sessions: anon insert"
  on public.guest_sessions
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "guest_sessions: anon update last_seen" on public.guest_sessions;
create policy "guest_sessions: anon update last_seen"
  on public.guest_sessions
  for update
  to anon, authenticated
  using  (true)
  with check (true);

-- Allow SELECT for debugging (restrict or remove in production)
drop policy if exists "guest_sessions: anon select own" on public.guest_sessions;
create policy "guest_sessions: anon select own"
  on public.guest_sessions
  for select
  to anon, authenticated
  using (true);


-- ─── credit_ledger ───────────────────────────────────────────────────────────
alter table public.credit_ledger enable row level security;

-- Users can read their own ledger rows
drop policy if exists "credit_ledger: user can select own rows" on public.credit_ledger;
create policy "credit_ledger: user can select own rows"
  on public.credit_ledger
  for select
  to authenticated
  using (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy for authenticated or anon.
-- Only the service-role (Edge Functions) can write to this table.


-- ─── feedback ────────────────────────────────────────────────────────────────
alter table public.feedback enable row level security;

-- Authenticated users can insert feedback for themselves only
drop policy if exists "feedback: user can insert own row" on public.feedback;
create policy "feedback: user can insert own row"
  on public.feedback
  for insert
  to authenticated
  with check (
    user_id  = auth.uid() and
    guest_id is null
  );

-- Authenticated users can read their own feedback
drop policy if exists "feedback: user can select own rows" on public.feedback;
create policy "feedback: user can select own rows"
  on public.feedback
  for select
  to authenticated
  using (user_id = auth.uid());

-- anon has NO access — guest feedback goes through an Edge Function.


-- ─── purchases ───────────────────────────────────────────────────────────────
alter table public.purchases enable row level security;

-- Users can read their own purchase history
drop policy if exists "purchases: user can select own rows" on public.purchases;
create policy "purchases: user can select own rows"
  on public.purchases
  for select
  to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE for anyone — only service role (Edge Functions).



-- =============================================================================
-- TRIGGER: auto-create profile on user sign-up
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Drop and re-create the trigger so this script is safe to re-run
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

comment on function public.handle_new_user() is
  'Auto-creates a profiles row with default credits when a user signs up.';
