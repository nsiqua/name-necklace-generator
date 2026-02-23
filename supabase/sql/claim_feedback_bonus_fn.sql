-- =============================================================================
-- SQL function: public.claim_feedback_bonus
-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor before deploying the Edge Function.
--
-- Concurrency-safe: SELECT FOR UPDATE on the balance row prevents races.
-- One bonus per identity per 30 days, enforced via credit_ledger.
-- =============================================================================

create or replace function public.claim_feedback_bonus(
  p_user_id   uuid  default null,
  p_guest_id  text  default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits     int;
  v_new_credits int;
  v_already     int;
begin
  -- ── Validate: exactly one identity ───────────────────────────────────────
  if (p_user_id is null) = (p_guest_id is null) then
    return jsonb_build_object(
      'ok',      false,
      'code',    'INVALID_INPUT',
      'message', 'Provide exactly one of p_user_id or p_guest_id'
    );
  end if;

  -- ── Check 30-day ledger for existing feedback_bonus ───────────────────────
  if p_user_id is not null then
    select count(*) into v_already
      from public.credit_ledger
     where user_id = p_user_id
       and reason  = 'feedback_bonus'
       and created_at > now() - interval '30 days';
  else
    select count(*) into v_already
      from public.credit_ledger
     where guest_id = p_guest_id
       and reason   = 'feedback_bonus'
       and created_at > now() - interval '30 days';
  end if;

  if v_already > 0 then
    return jsonb_build_object(
      'ok',   false,
      'code', 'ALREADY_GRANTED'
    );
  end if;

  -- ── Lock balance row and credit +5 ───────────────────────────────────────
  if p_user_id is not null then
    select credits_balance into v_credits
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

    v_new_credits := v_credits + 5;

    update public.profiles
       set credits_balance = v_new_credits
     where user_id = p_user_id;

    insert into public.credit_ledger (user_id, delta, reason, metadata)
    values (p_user_id, 5, 'feedback_bonus', '{}'::jsonb);

  else
    select credits_balance into v_credits
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

    v_new_credits := v_credits + 5;

    update public.guest_sessions
       set credits_balance = v_new_credits
     where guest_id = p_guest_id;

    insert into public.credit_ledger (guest_id, delta, reason, metadata)
    values (p_guest_id, 5, 'feedback_bonus', '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'ok',             true,
    'credits_balance', v_new_credits
  );
end;
$$;

-- Only service_role can call this (via Edge Function)
revoke execute on function public.claim_feedback_bonus from public, anon, authenticated;
grant  execute on function public.claim_feedback_bonus to service_role;

comment on function public.claim_feedback_bonus is
  'Award +5 credits for feedback. One per identity within 30 days. Service role only.';
