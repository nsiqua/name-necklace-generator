// supabase/functions/create_checkout_session/index.ts
// Deploy: npx supabase functions deploy create_checkout_session
//
// Creates a Stripe Checkout Session for a credit pack purchase.
// Stripe redirects to FRONTEND_SUCCESS_URL?session_id={CHECKOUT_SESSION_ID}
// or FRONTEND_CANCEL_URL on cancel.
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY       sk_live_... or sk_test_...
//   FRONTEND_SUCCESS_URL    https://yourapp.com/?payment=success
//   FRONTEND_CANCEL_URL     https://yourapp.com/?payment=cancelled

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@15?target=deno';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Pack definitions — price in cents, credits awarded (or 'unlimited' flag)
const PACKS: Record<string, { name: string; price_cents: number; credits: number | null }> = {
    p1: { name: '5 Download Credits', price_cents: 100, credits: 5 },
    p3: { name: '20 Download Credits', price_cents: 300, credits: 20 },
    p5: { name: '50 Download Credits', price_cents: 500, credits: 50 },
    p20: { name: 'Unlimited Downloads (30 days)', price_cents: 2000, credits: null },
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

    try {
        const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
            apiVersion: '2024-12-18.acacia',
            httpClient: Stripe.createFetchHttpClient(),
        });

        // ── Resolve identity ──────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        let userId: string | null = null;

        if (authHeader?.startsWith('Bearer ')) {
            // In Deno there is no session storage, so we MUST pass the raw token
            // explicitly. auth.getUser() without a token sends null → 401.
            const token = authHeader.slice(7); // strip 'Bearer '
            const anonClient = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_ANON_KEY')!,
            );
            const { data: { user }, error } = await anonClient.auth.getUser(token);
            if (!error && user) userId = user.id;
            else if (error) console.warn('[create_checkout_session] getUser error:', error.message);
        }

        const body: { pack?: string; guest_id?: string } = await req.json().catch(() => ({}));
        const { pack, guest_id } = body;

        // Validate pack
        if (!pack || !PACKS[pack]) {
            return json({
                ok: false, code: 'INVALID_PACK',
                message: `Unknown pack "${pack}". Valid: ${Object.keys(PACKS).join(', ')}`
            }, 200);
        }

        // Validate identity
        if (!userId && !guest_id) {
            return json({
                ok: false, code: 'UNAUTHENTICATED',
                message: 'Provide Authorization header or guest_id'
            }, 200);
        }
        if (!userId && guest_id && !UUID_RE.test(guest_id)) {
            return json({
                ok: false, code: 'INVALID_GUEST_ID',
                message: 'guest_id must be a UUID v4'
            }, 200);
        }

        const packDef = PACKS[pack];

        // Validate required env vars before calling Stripe
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
        const successUrl = Deno.env.get('FRONTEND_SUCCESS_URL');
        const cancelUrl = Deno.env.get('FRONTEND_CANCEL_URL');

        if (!stripeKey) {
            console.error('[create_checkout_session] STRIPE_SECRET_KEY not set');
            return json({ ok: false, code: 'CONFIG_ERROR', message: 'STRIPE_SECRET_KEY not configured' }, 200);
        }
        if (!successUrl || !cancelUrl) {
            console.error('[create_checkout_session] FRONTEND_SUCCESS_URL or FRONTEND_CANCEL_URL not set');
            return json({ ok: false, code: 'CONFIG_ERROR', message: 'Frontend URL env vars not configured' }, 200);
        }

        // ── Create Stripe Checkout Session ────────────────────────────────────────
        console.log('[create_checkout_session] creating session', { pack, userId, guest_id });
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    unit_amount: packDef.price_cents,
                    product_data: {
                        name: packDef.name,
                        description: packDef.credits
                            ? `${packDef.credits} credits for name necklace downloads`
                            : 'Unlimited downloads for 30 days',
                    },
                },
                quantity: 1,
            }],
            metadata: {
                pack,
                ...(userId ? { user_id: userId } : {}),
                ...(guest_id ? { guest_id: guest_id } : {}),
            },
            success_url: `${successUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
        });

        console.log('[create_checkout_session] ✅', { pack, userId, guest_id, sessionId: session.id });
        return json({ ok: true, url: session.url });

    } catch (err) {
        console.error('[create_checkout_session] error:', err);
        return json({
            ok: false, code: 'INTERNAL_ERROR',
            message: (err as Error).message
        }, 200);
    }
});

