// supabase/functions/ensure_identity/index.ts
// Deploy: supabase functions deploy ensure_identity
//
// Purpose: Single entry point for identity resolution.
//   • Authenticated users  → ensure profiles row, grant signup_bonus if new
//   • Guests (guest_id)    → ensure guest_sessions row, grant guest_bonus if new
//
// Security: uses SUPABASE_SERVICE_ROLE_KEY (server-only, never sent to client).
//           Validates the caller's JWT via the anon client before any DB work.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// UUID v4 pattern — used to validate guest_id before touching the DB
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
        // ── Service-role client (server-side only, bypasses RLS) ──────────────
        const serviceClient = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            { auth: { persistSession: false } }
        );

        // ── Determine if the caller is an authenticated user ──────────────────
        const authHeader = req.headers.get('Authorization');
        let user: { id: string; email?: string } | null = null;

        if (authHeader?.startsWith('Bearer ')) {
            // Verify the JWT using the anon client — must pass token explicitly in Deno
            // (no session storage exists, so getUser() without a token sends null → 401)
            const token = authHeader.slice(7);
            const anonClient = createClient(
                Deno.env.get('SUPABASE_URL')!,
                Deno.env.get('SUPABASE_ANON_KEY')!,
            );
            const { data: { user: u }, error } = await anonClient.auth.getUser(token);
            if (!error && u) user = u;
            else if (error) console.warn('[ensure_identity] getUser error:', error.message);
        }

        // ── Parse body ────────────────────────────────────────────────────────
        const body: { guest_id?: string } = await req.json().catch(() => ({}));
        const { guest_id } = body;

        // ─────────────────────────────────────────────────────────────────────
        // PATH A: Authenticated user
        // ─────────────────────────────────────────────────────────────────────
        if (user) {
            const userId = user.id;

            // Check for existing profile
            const { data: existing } = await serviceClient
                .from('profiles')
                .select('credits_balance, unlimited_until')
                .eq('user_id', userId)
                .maybeSingle();

            if (!existing) {
                // New user — create profile + signup bonus ledger entry atomically
                const { error: insertErr } = await serviceClient
                    .from('profiles')
                    .insert({ user_id: userId, credits_balance: 10 });

                if (insertErr) throw new Error(`profiles insert: ${insertErr.message}`);

                const { error: ledgerErr } = await serviceClient
                    .from('credit_ledger')
                    .insert({ user_id: userId, delta: 10, reason: 'signup_bonus' });

                if (ledgerErr) throw new Error(`credit_ledger insert: ${ledgerErr.message}`);
            }

            // Re-fetch to get the definitive current state
            const { data: profile, error: fetchErr } = await serviceClient
                .from('profiles')
                .select('credits_balance, unlimited_until')
                .eq('user_id', userId)
                .single();

            if (fetchErr) throw new Error(`profiles fetch: ${fetchErr.message}`);

            return json({
                type: 'user',
                user_id: userId,
                credits_balance: profile.credits_balance,
                unlimited_until: profile.unlimited_until,
                created: !existing,   // true if this call created the row
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // PATH B: Guest (no auth session, guest_id provided)
        // ─────────────────────────────────────────────────────────────────────
        if (guest_id) {
            // Validate format before any DB work
            if (!UUID_RE.test(guest_id)) {
                return json({ error: 'Invalid guest_id — must be a UUID v4' }, 400);
            }

            // Check for existing session
            const { data: existing } = await serviceClient
                .from('guest_sessions')
                .select('credits_balance, unlimited_until')
                .eq('guest_id', guest_id)
                .maybeSingle();

            const now = new Date().toISOString();

            if (!existing) {
                // New guest — create session + bonus ledger entry
                const { error: insertErr } = await serviceClient
                    .from('guest_sessions')
                    .insert({ guest_id, credits_balance: 3, last_seen: now });

                if (insertErr) throw new Error(`guest_sessions insert: ${insertErr.message}`);

                const { error: ledgerErr } = await serviceClient
                    .from('credit_ledger')
                    .insert({ guest_id, delta: 3, reason: 'guest_bonus' });

                if (ledgerErr) throw new Error(`credit_ledger insert: ${ledgerErr.message}`);
            } else {
                // Returning guest — just refresh last_seen (fire-and-forget, no throw)
                await serviceClient
                    .from('guest_sessions')
                    .update({ last_seen: now })
                    .eq('guest_id', guest_id);
            }

            // Re-fetch definitive state
            const { data: session, error: fetchErr } = await serviceClient
                .from('guest_sessions')
                .select('credits_balance, unlimited_until')
                .eq('guest_id', guest_id)
                .single();

            if (fetchErr) throw new Error(`guest_sessions fetch: ${fetchErr.message}`);

            return json({
                type: 'guest',
                guest_id,
                credits_balance: session.credits_balance,
                unlimited_until: session.unlimited_until,
                created: !existing,
            });
        }

        // ─────────────────────────────────────────────────────────────────────
        // No auth, no guest_id — can't resolve identity
        // ─────────────────────────────────────────────────────────────────────
        return json(
            { error: 'Provide Authorization header (logged-in user) or guest_id in body' },
            400
        );

    } catch (err) {
        console.error('[ensure_identity]', err);
        return json({ error: 'Internal server error', detail: (err as Error).message }, 500);
    }
});
