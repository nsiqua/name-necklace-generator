// supabase/functions/consume_download_credit/index.ts
// Deploy: npx supabase functions deploy consume_download_credit
//
// Purpose: Atomically consume one download credit for a user or guest.
//          All credit logic lives in the SQL function consume_download_credit()
//          which uses SELECT FOR UPDATE to prevent concurrent double-spend.
//
// Input:  { format: 'svg'|'png'|'pdf'|'dxf', design_hash?: string, guest_id?: string }
// Output:
//   { ok:true,  consumed:false, credits_balance }   — unlimited pass active
//   { ok:true,  consumed:true,  credits_balance }   — credit consumed
//   { ok:false, code:'NO_CREDITS', credits_balance:0 }
//   { ok:false, code:'NOT_FOUND'|'INVALID_INPUT'|... }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_FORMATS = new Set(['svg', 'png', 'pdf', 'dxf']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req) => {
    // ── CORS preflight ────────────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    try {
        // ── Service-role client (server-only, bypasses RLS) ───────────────────
        const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            { auth: { persistSession: false } }
        );

        // ── Verify caller JWT (if present) ────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        let user: { id: string; email?: string } | null = null;

        if (authHeader?.startsWith('Bearer ')) {
            const anonClient = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_ANON_KEY')!,
                { global: { headers: { Authorization: authHeader } } }
            );
            const { data: { user: u }, error } = await anonClient.auth.getUser();
            if (!error && u) user = u;
        }

        // ── Parse and validate request body ───────────────────────────────────
        const body: { format?: string; design_hash?: string; guest_id?: string } =
            await req.json().catch(() => ({}));

        const format = (body.format ?? 'svg').toLowerCase();
        const design_hash = body.design_hash ?? null;
        const guest_id = body.guest_id ?? null;

        if (!VALID_FORMATS.has(format)) {
            return json({
                ok: false,
                code: 'INVALID_FORMAT',
                message: `format must be one of: ${[...VALID_FORMATS].join(', ')}`,
            }, 400);
        }

        // ── Resolve identity ──────────────────────────────────────────────────
        let userId: string | null = null;

        if (user) {
            // Authenticated — use their verified user_id
            userId = user.id;
        } else if (guest_id) {
            // Guest — validate the UUID before touching the DB
            if (!UUID_RE.test(guest_id)) {
                return json({
                    ok: false,
                    code: 'INVALID_GUEST_ID',
                    message: 'guest_id must be a UUID v4',
                }, 400);
            }
        } else {
            // Neither auth nor guest_id — reject
            return json({
                ok: false,
                code: 'UNAUTHENTICATED',
                message: 'Provide an Authorization header (logged-in user) or guest_id in body',
            }, 401);
        }

        // ── Call the atomic SQL function ──────────────────────────────────────
        //    consume_download_credit does:
        //      1. SELECT … FOR UPDATE (row lock)
        //      2. Check unlimited_until > now()
        //      3. Check credits_balance >= 1
        //      4. UPDATE balance - 1
        //      5. INSERT credit_ledger entry
        //    All in one implicit transaction — concurrent calls are serialised.
        const { data, error } = await serviceClient.rpc('consume_download_credit', {
            p_user_id: userId,
            p_guest_id: userId ? null : guest_id,
            p_format: format,
            p_design_hash: design_hash,
        });

        if (error) {
            console.error('[consume_download_credit] rpc error:', error.message);
            return json({ ok: false, code: 'DB_ERROR', message: error.message }, 500);
        }

        // data is the jsonb returned by the SQL function
        const result = data as {
            ok: boolean;
            consumed?: boolean;
            credits_balance?: number;
            code?: string;
            message?: string;
            reason?: string;
        };

        console.log('[consume_download_credit]', user?.email ?? guest_id, '→', result);
        return json(result, result.ok ? 200 : 402);

    } catch (err) {
        console.error('[consume_download_credit] unhandled error:', err);
        return json({
            ok: false,
            code: 'INTERNAL_ERROR',
            message: (err as Error).message,
        }, 500);
    }
});
