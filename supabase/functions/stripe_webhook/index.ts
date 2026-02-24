// supabase/functions/stripe_webhook/index.ts
// Deploy: npx supabase functions deploy stripe_webhook
//
// Handles Stripe webhook events.
// On checkout.session.completed:
//   1. Verify Stripe signature  (STRIPE_WEBHOOK_SECRET)
//   2. Idempotency check        (purchases.stripe_session_id unique index)
//   3. Insert purchases row
//   4. Insert credit_ledger row
//   5. Update credits_balance / unlimited_until on profiles or guest_sessions
//
// Required env vars (Supabase Dashboard → Edge Functions → Manage secrets):
//   STRIPE_SECRET_KEY       sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET   whsec_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@15?target=deno';

// ── Pack definitions ──────────────────────────────────────────────────────────
const PACK_MAP: Record<string, { credits: number; amountCents: number }> = {
    p1: { credits: 5, amountCents: 100 },
    p3: { credits: 20, amountCents: 300 },
    p5: { credits: 50, amountCents: 500 },
    p20: { credits: 0, amountCents: 2000 }, // unlimited — credits = 0
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type, stripe-signature',
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
        apiVersion: '2024-12-18.acacia',
        httpClient: Stripe.createFetchHttpClient(),
    });

    // ── 1. Verify Stripe webhook signature ────────────────────────────────────
    const sig = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
    let event: Stripe.Event;

    try {
        const rawBody = await req.text();
        event = await stripe.webhooks.constructEventAsync(rawBody, sig!, webhookSecret);
    } catch (err) {
        console.error('[stripe_webhook] signature verification failed:', (err as Error).message);
        return json({ error: 'Webhook signature verification failed' }, 400);
    }

    console.log('[stripe_webhook] received:', event.type, event.id);

    // ── Only handle checkout.session.completed ───────────────────────────────
    if (event.type !== 'checkout.session.completed') {
        return json({ received: true, skipped: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // Ignore sessions that haven't been paid yet (e.g. bank transfers pending)
    if (session.payment_status !== 'paid') {
        console.log('[stripe_webhook] not paid yet — skipped:', session.id);
        return json({ received: true, skipped: true });
    }

    const { pack, user_id, guest_id } = session.metadata ?? {};

    if (!pack || !PACK_MAP[pack]) {
        console.error('[stripe_webhook] unknown pack in metadata:', pack, 'session:', session.id);
        return json({ error: `Unknown pack "${pack}"` }, 400);
    }

    if (!user_id && !guest_id) {
        console.error('[stripe_webhook] no identity in metadata for session:', session.id);
        return json({ error: 'No identity in session metadata' }, 400);
    }

    const packDef = PACK_MAP[pack];
    const isUnlimited = pack === 'p20';

    // ── 2. Service-role client (bypasses RLS) ────────────────────────────────
    const db = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false } }
    );

    // ── 3. Idempotency check ─────────────────────────────────────────────────
    //    purchases.stripe_session_id has a UNIQUE index — duplicate insert throws.
    //    We check first so we can return 200 cleanly without a DB error.
    const { data: existing } = await db
        .from('purchases')
        .select('id')
        .eq('stripe_session_id', session.id)
        .maybeSingle();

    if (existing) {
        console.log('[stripe_webhook] already fulfilled — skipping:', session.id);
        return json({ received: true, already_fulfilled: true });
    }

    // ── Compute unlimited_until (p20 only) ───────────────────────────────────
    const unlimitedUntil = isUnlimited
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;

    // ── 4. Insert purchases row ──────────────────────────────────────────────
    const { error: purchaseErr } = await db.from('purchases').insert({
        user_id: user_id || null,
        guest_id: guest_id || null,
        stripe_session_id: session.id,
        amount_cents: packDef.amountCents,
        credits_granted: packDef.credits,
        unlimited_until: unlimitedUntil,
    });

    if (purchaseErr) {
        // Could be a race-condition duplicate — treat as already fulfilled
        if (purchaseErr.code === '23505') {
            console.log('[stripe_webhook] duplicate purchase insert (race) — skipping:', session.id);
            return json({ received: true, already_fulfilled: true });
        }
        console.error('[stripe_webhook] purchases insert failed:', purchaseErr.message);
        return json({ error: 'DB error (purchases)', detail: purchaseErr.message }, 500);
    }

    // ── 5. Insert credit_ledger row ──────────────────────────────────────────
    const ledgerReason = isUnlimited ? 'unlimited_purchase' : 'purchase';

    const { error: ledgerErr } = await db.from('credit_ledger').insert({
        user_id: user_id || null,
        guest_id: guest_id || null,
        delta: packDef.credits,           // 0 for unlimited, positive for credit packs
        reason: ledgerReason,
        metadata: {
            pack,
            stripe_session_id: session.id,
            ...(unlimitedUntil ? { unlimited_until: unlimitedUntil } : {}),
        },
    });

    if (ledgerErr) {
        console.error('[stripe_webhook] credit_ledger insert failed:', ledgerErr.message);
        // Don't block — purchases row is already written (idempotent)
        // Return 500 so Stripe retries; the idempotency check above will guard re-runs
        return json({ error: 'DB error (credit_ledger)', detail: ledgerErr.message }, 500);
    }

    // ── 6. Update balance / unlimited_until ──────────────────────────────────
    if (user_id) {
        const updatePayload: Record<string, unknown> = {};
        if (!isUnlimited) {
            // credits pack: increment credits_balance
            // Supabase JS doesn't support rpc-free increments, so we use rpc or raw SQL.
            // Use a service-role RPC to do `credits_balance + N` atomically:
            const { error: rpcErr } = await db.rpc('add_credits', {
                p_user_id: user_id,
                p_delta: packDef.credits,
            });
            if (rpcErr) {
                console.error('[stripe_webhook] add_credits rpc failed:', rpcErr.message);
                return json({ error: 'DB error (credits update)', detail: rpcErr.message }, 500);
            }
        } else {
            // Unlimited pack: set/extend unlimited_until
            updatePayload.unlimited_until = unlimitedUntil;
            const { error: updateErr } = await db
                .from('profiles')
                .update(updatePayload)
                .eq('user_id', user_id);
            if (updateErr) {
                console.error('[stripe_webhook] profiles update failed:', updateErr.message);
                return json({ error: 'DB error (profiles update)', detail: updateErr.message }, 500);
            }
        }

    } else if (guest_id) {
        if (!isUnlimited) {
            const { error: rpcErr } = await db.rpc('add_credits', {
                p_guest_id: guest_id,
                p_delta: packDef.credits,
            });
            if (rpcErr) {
                console.error('[stripe_webhook] add_credits rpc failed:', rpcErr.message);
                return json({ error: 'DB error (credits update)', detail: rpcErr.message }, 500);
            }
        } else {
            const { error: updateErr } = await db
                .from('guest_sessions')
                .update({ unlimited_until: unlimitedUntil })
                .eq('guest_id', guest_id);
            if (updateErr) {
                console.error('[stripe_webhook] guest_sessions update failed:', updateErr.message);
                return json({ error: 'DB error (guest update)', detail: updateErr.message }, 500);
            }
        }
    }

    console.log('[stripe_webhook] fulfilled:', {
        session_id: session.id, pack, user_id, guest_id,
        credits: packDef.credits, unlimited_until: unlimitedUntil,
    });

    return json({ received: true, fulfilled: true });
});
