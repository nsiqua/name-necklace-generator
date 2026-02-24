-- =============================================================================
-- SQL function: public.add_credits
-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor BEFORE deploying stripe_webhook EF.
--
-- Called by the stripe_webhook Edge Function to atomically increment
-- credits_balance on profiles or guest_sessions.
--
-- Uses UPDATE ... SET credits_balance = credits_balance + p_delta
-- which is atomic at the database level (no SELECT FOR UPDATE needed
-- because we're not reading-then-writing separately).
-- =============================================================================

create or replace function public.add_credits(
  p_user_id   uuid  default null,
  p_guest_id  text  default null,
  p_delta     int   default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_credits int;
begin
  -- ── Validate identity ─────────────────────────────────────────────────────
  if (p_user_id is null) = (p_guest_id is null) then
    return jsonb_build_object(
      'ok',      false,
      'code',    'INVALID_INPUT',
      'message', 'Provide exactly one of p_user_id or p_guest_id'
    );
  end if;

  if p_delta < 0 then
    return jsonb_build_object(
      'ok',      false,
      'code',    'INVALID_DELTA',
      'message', 'p_delta must be >= 0 for add_credits'
    );
  end if;

  -- ── Apply increment ───────────────────────────────────────────────────────
  if p_user_id is not null then
    update public.profiles
       set credits_balance = credits_balance + p_delta
     where user_id = p_user_id
    returning credits_balance into v_new_credits;

    if not found then
      return jsonb_build_object(
        'ok',      false,
        'code',    'NOT_FOUND',
        'message', 'Profile not found'
      );
    end if;

  else
    update public.guest_sessions
       set credits_balance = credits_balance + p_delta
     where guest_id = p_guest_id
    returning credits_balance into v_new_credits;

    if not found then
      return jsonb_build_object(
        'ok',      false,
        'code',    'NOT_FOUND',
        'message', 'Guest session not found'
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok',              true,
    'credits_balance', v_new_credits
  );
end;
$$;

revoke execute on function public.add_credits from public, anon, authenticated;
grant  execute on function public.add_credits to service_role;

comment on function public.add_credits is
  'Atomically adds credits to a user or guest session. Service role only.';
