-- =============================================================================
-- SQL function: public.consume_download_credit
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor before deploying the Edge Function.
--
-- Why a SQL function instead of application-level logic?
--   The SELECT ... FOR UPDATE + UPDATE + INSERT happen inside a single implicit
--   transaction. If two requests arrive simultaneously for the same identity,
--   the second is queued behind the row lock — no double-spend is possible.
-- =============================================================================

create or replace function public.consume_download_credit(
  p_user_id     uuid    default null,
  p_guest_id    text    default null,
  p_format      text    default 'svg',
  p_design_hash text    default null
)
returns jsonb
language plpgsql
security definer                  -- runs as postgres, bypasses RLS
set search_path = public
as $$
declare
  v_credits     int;
  v_unlimited   timestamptz;
  v_new_credits int;
begin
  -- ── Validate: exactly one identity must be supplied ──────────────────────
  if (p_user_id is null) = (p_guest_id is null) then
    return jsonb_build_object(
      'ok',      false,
      'code',    'INVALID_INPUT',
      'message', 'Provide exactly one of p_user_id or p_guest_id'
    );
  end if;

  -- ── Lock the identity row (SELECT … FOR UPDATE) ──────────────────────────
  --    Concurrent calls for the same identity queue here — no double-spend.
  if p_user_id is not null then
    select credits_balance, unlimited_until
      into v_credits, v_unlimited
      from public.profiles
     where user_id = p_user_id
       for update;

    if not found then
      return jsonb_build_object(
        'ok',      false,
        'code',    'NOT_FOUND',
        'message', 'Profile not found — call ensure_identity first'
      );
    end if;

  else
    select credits_balance, unlimited_until
      into v_credits, v_unlimited
      from public.guest_sessions
     where guest_id = p_guest_id
       for update;

    if not found then
      return jsonb_build_object(
        'ok',      false,
        'code',    'NOT_FOUND',
        'message', 'Guest session not found — call ensure_identity first'
      );
    end if;
  end if;

  -- ── Check unlimited pass ─────────────────────────────────────────────────
  if v_unlimited is not null and v_unlimited > now() then
    return jsonb_build_object(
      'ok',             true,
      'consumed',       false,
      'reason',         'unlimited_active',
      'credits_balance', v_credits
    );
  end if;

  -- ── Check balance ─────────────────────────────────────────────────────────
  if v_credits < 1 then
    return jsonb_build_object(
      'ok',             false,
      'code',           'NO_CREDITS',
      'credits_balance', 0
    );
  end if;

  -- ── Decrement balance + insert ledger entry (same transaction) ────────────
  v_new_credits := v_credits - 1;

  if p_user_id is not null then
    update public.profiles
       set credits_balance = v_new_credits
     where user_id = p_user_id;

    insert into public.credit_ledger (user_id, delta, reason, metadata)
    values (
      p_user_id, -1, 'download',
      jsonb_build_object('format', p_format, 'design_hash', p_design_hash)
    );

  else
    update public.guest_sessions
       set credits_balance = v_new_credits
     where guest_id = p_guest_id;

    insert into public.credit_ledger (guest_id, delta, reason, metadata)
    values (
      p_guest_id, -1, 'download',
      jsonb_build_object('format', p_format, 'design_hash', p_design_hash)
    );
  end if;

  -- ── Return new balance ────────────────────────────────────────────────────
  return jsonb_build_object(
    'ok',             true,
    'consumed',       true,
    'credits_balance', v_new_credits
  );

end;
$$;

-- Grant execute to the service role only (Edge Functions use service role key)
-- The anon / authenticated roles should NOT call this directly.
revoke execute on function public.consume_download_credit from public, anon, authenticated;
grant  execute on function public.consume_download_credit to service_role;

comment on function public.consume_download_credit is
  'Atomic credit consumption. Must be called from a trusted Edge Function (service role).';
