-- =============================================================================
-- SQL function: public.fulfill_order
-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor BEFORE deploying stripe_webhook EF.
--
-- Called by the stripe_webhook Edge Function after payment is confirmed.
-- Credits or unlimited pass — determined by the 'pack' parameter.
--
-- Packs:
--   p1  → +5  credits
--   p3  → +20 credits
--   p5  → +50 credits
--   p20 → unlimited_until = now() + 30 days
--
-- Idempotent: stripe_payment_id is stored in credit_ledger; duplicate
--             webhook calls for the same payment are silently ignored.
-- =============================================================================

create or replace function public.fulfill_order(
  p_user_id          uuid   default null,
  p_guest_id         text   default null,
  p_pack             text   default null,      -- 'p1'|'p3'|'p5'|'p20'
  p_stripe_payment_id text  default null       -- Stripe checkout session ID (idempotency key)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits_delta int;
  v_unlimited     bool := false;
  v_new_credits   int;
  v_until         timestamptz;
  v_existing      int;
begin
  -- ── Validate identity ─────────────────────────────────────────────────────
  if (p_user_id is null) = (p_guest_id is null) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT',
      'message', 'Provide exactly one of p_user_id or p_guest_id');
  end if;

  -- ── Validate pack ─────────────────────────────────────────────────────────
  case p_pack
    when 'p1'  then v_credits_delta := 5;
    when 'p3'  then v_credits_delta := 20;
    when 'p5'  then v_credits_delta := 50;
    when 'p20' then v_unlimited := true; v_credits_delta := 0;
    else
      return jsonb_build_object('ok', false, 'code', 'INVALID_PACK',
        'message', 'Unknown pack: ' || coalesce(p_pack, 'null'));
  end case;

  -- ── Idempotency check: skip if already fulfilled for this payment ──────────
  if p_stripe_payment_id is not null then
    select count(*) into v_existing
      from public.credit_ledger
     where metadata->>'stripe_payment_id' = p_stripe_payment_id;

    if v_existing > 0 then
      return jsonb_build_object('ok', true, 'code', 'ALREADY_FULFILLED',
        'message', 'Order already fulfilled for this payment ID');
    end if;
  end if;

  -- ── Apply order ───────────────────────────────────────────────────────────
  if p_user_id is not null then

    if v_unlimited then
      -- Set unlimited_until to now + 30 days (extend if already active)
      update public.profiles
         set unlimited_until = greatest(coalesce(unlimited_until, now()), now()) + interval '30 days'
       where user_id = p_user_id
      returning credits_balance into v_new_credits;

      select unlimited_until into v_until from public.profiles where user_id = p_user_id;

      insert into public.credit_ledger (user_id, delta, reason, metadata)
      values (p_user_id, 0, 'purchase_unlimited',
              jsonb_build_object('pack', p_pack, 'stripe_payment_id', p_stripe_payment_id,
                                 'unlimited_until', v_until));
    else
      update public.profiles
         set credits_balance = credits_balance + v_credits_delta
       where user_id = p_user_id
      returning credits_balance into v_new_credits;

      insert into public.credit_ledger (user_id, delta, reason, metadata)
      values (p_user_id, v_credits_delta, 'purchase',
              jsonb_build_object('pack', p_pack, 'stripe_payment_id', p_stripe_payment_id));
    end if;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND',
        'message', 'Profile not found');
    end if;

  else -- guest

    if v_unlimited then
      update public.guest_sessions
         set unlimited_until = greatest(coalesce(unlimited_until, now()), now()) + interval '30 days'
       where guest_id = p_guest_id
      returning credits_balance into v_new_credits;

      select unlimited_until into v_until from public.guest_sessions where guest_id = p_guest_id;

      insert into public.credit_ledger (guest_id, delta, reason, metadata)
      values (p_guest_id, 0, 'purchase_unlimited',
              jsonb_build_object('pack', p_pack, 'stripe_payment_id', p_stripe_payment_id,
                                 'unlimited_until', v_until));
    else
      update public.guest_sessions
         set credits_balance = credits_balance + v_credits_delta
       where guest_id = p_guest_id
      returning credits_balance into v_new_credits;

      insert into public.credit_ledger (guest_id, delta, reason, metadata)
      values (p_guest_id, v_credits_delta, 'purchase',
              jsonb_build_object('pack', p_pack, 'stripe_payment_id', p_stripe_payment_id));
    end if;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND',
        'message', 'Guest session not found');
    end if;

  end if;

  return jsonb_build_object(
    'ok',              true,
    'credits_balance', coalesce(v_new_credits, 0),
    'unlimited_until', v_until
  );
end;
$$;

revoke execute on function public.fulfill_order from public, anon, authenticated;
grant  execute on function public.fulfill_order to service_role;

comment on function public.fulfill_order is
  'Fulfill a paid credit pack. Idempotent via stripe_payment_id. Service role only.';
