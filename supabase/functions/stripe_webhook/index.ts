// supabase/functions/stripe_webhook/index.ts
// Deploy: npx supabase functions deploy stripe_webhook
//
// Handles Stripe webhook events. Fulfills credit orders on payment success.
//
// Required env vars:
//   STRIPE_SECRET_KEY        sk_live_... or sk_test_...
//   STRIPE_WEBHOOK_SECRET    whsec_... (from Stripe Dashboard → Webhooks)
//
// Register this URL in Stripe Dashboard → Developers → Webhooks:
//   https://<project-ref>.supabase.co/functions/v1/stripe_webhook
// Events to send: checkout.session.completed

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@15?target=deno';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
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

    // ── Verify Stripe signature ───────────────────────────────────────────────
    const sig = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

    let event: Stripe.Event;
    try {
        const body = await req.text();
        event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
    } catch (err) {
        console.error('[stripe_webhook] signature verification failed:', (err as Error).message);
        return json({ error: 'Webhook signature verification failed' }, 400);
    }

    console.log('[stripe_webhook] event:', event.type, event.id);

    // ── Handle checkout.session.completed ────────────────────────────────────
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        // Only fulfill paid sessions
        if (session.payment_status !== 'paid') {
            console.log('[stripe_webhook] session not paid yet — skipping:', session.id);
            return json({ received: true });
        }

        const { pack, user_id, guest_id } = session.metadata ?? {};

        if (!pack) {
            console.error('[stripe_webhook] missing pack in metadata for session:', session.id);
            return json({ error: 'Missing pack in metadata' }, 400);
        }

        const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            { auth: { persistSession: false } }
        );

        const { data, error } = await serviceClient.rpc('fulfill_order', {
            p_user_id: user_id || null,
            p_guest_id: guest_id || null,
            p_pack: pack,
            p_stripe_payment_id: session.id,
        });

        if (error) {
            console.error('[stripe_webhook] fulfill_order error:', error.message);
            // Return 500 so Stripe retries
            return json({ error: 'DB fulfillment failed', detail: error.message }, 500);
        }

        console.log('[stripe_webhook] fulfilled:', session.id, data);
    }

    return json({ received: true });
});
