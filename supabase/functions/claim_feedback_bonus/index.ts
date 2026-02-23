// supabase/functions/claim_feedback_bonus/index.ts
// Deploy: npx supabase functions deploy claim_feedback_bonus
//
// Awards +5 credits for feedback. Server-enforced: 1 per identity per 30 days.
//
// Input:  { guest_id?: string }  (user detected via Authorization JWT)
// Output:
//   { ok:true,  credits_balance }
//   { ok:false, code:'ALREADY_GRANTED' }
//   { ok:false, code:'NOT_FOUND'|'INVALID_INPUT'|'DB_ERROR' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        // ── Service-role client ───────────────────────────────────────────────
        const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            { auth: { persistSession: false } }
        );

        // ── Verify JWT (if present) ───────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        let user: { id: string } | null = null;

        if (authHeader?.startsWith('Bearer ')) {
            const anonClient = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_ANON_KEY')!,
                { global: { headers: { Authorization: authHeader } } }
            );
            const { data: { user: u }, error } = await anonClient.auth.getUser();
            if (!error && u) user = u;
        }

        // ── Parse body ────────────────────────────────────────────────────────
        const body: { guest_id?: string } = await req.json().catch(() => ({}));
        const guest_id = body.guest_id ?? null;

        // ── Resolve identity ──────────────────────────────────────────────────
        let userId: string | null = null;

        if (user) {
            userId = user.id;
        } else if (guest_id) {
            if (!UUID_RE.test(guest_id)) {
                return json({
                    ok: false, code: 'INVALID_GUEST_ID',
                    message: 'guest_id must be a UUID v4'
                }, 400);
            }
        } else {
            return json({
                ok: false, code: 'UNAUTHENTICATED',
                message: 'Provide Authorization header or guest_id'
            }, 401);
        }

        // ── Call atomic SQL function ──────────────────────────────────────────
        const { data, error } = await serviceClient.rpc('claim_feedback_bonus', {
            p_user_id: userId,
            p_guest_id: userId ? null : guest_id,
        });

        if (error) {
            console.error('[claim_feedback_bonus] rpc error:', error.message);
            return json({ ok: false, code: 'DB_ERROR', message: error.message }, 500);
        }

        const result = data as {
            ok: boolean;
            credits_balance?: number;
            code?: string;
            message?: string;
        };

        console.log('[claim_feedback_bonus]', user?.id ?? guest_id, '→', result);
        return json(result);

    } catch (err) {
        console.error('[claim_feedback_bonus] error:', err);
        return json({
            ok: false, code: 'INTERNAL_ERROR',
            message: (err as Error).message
        }, 500);
    }
});
