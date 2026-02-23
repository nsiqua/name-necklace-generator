/**
 * guestIdentity.js — Persistent guest tracking via Edge Function
 *
 * All identity resolution is now delegated to the `ensure_identity`
 * Edge Function, which runs under the service role key (server-side only).
 * The browser never needs the service role key.
 *
 * Cookie: ng_guest_id (UUID v4, 1-year SameSite=Lax)
 *   - Created locally on first visit
 *   - Sent to the Edge Function as the stable guest identifier
 *   - Survives localStorage clears
 *
 * Exports:
 *   getOrCreateGuestId()  — reads/mints the browser cookie
 *   getCurrentIdentity()  — calls ensure_identity, returns full identity
 */

import { supabase } from './supabaseClient.js';

const COOKIE_NAME = 'ng_guest_id';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;   // 1 year
const EDGE_FN_TIMEOUT = 8000;                  // ms before we give up
const EDGE_FN_NAME = 'ensure_identity';

// ── Cookie helpers ────────────────────────────────────────────────────────────

function readCookie(name) {
    const match = document.cookie
        .split('; ')
        .find(row => row.startsWith(name + '='));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function writeCookie(name, value, maxAge) {
    document.cookie =
        `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the existing guest_id cookie, or create a UUID v4 and persist it.
 * Refreshes cookie expiry on every call.
 * @returns {string}
 */
export function getOrCreateGuestId() {
    let guestId = readCookie(COOKIE_NAME);
    if (!guestId) {
        guestId = crypto.randomUUID();
        writeCookie(COOKIE_NAME, guestId, COOKIE_MAX_AGE);
        console.log('[guest] 🆕 New guest_id:', guestId);
    } else {
        writeCookie(COOKIE_NAME, guestId, COOKIE_MAX_AGE); // refresh expiry
        console.log('[guest] ✅ Existing guest_id:', guestId);
    }
    return guestId;
}

/**
 * Call the ensure_identity Edge Function and return the full identity.
 *
 * For authenticated users: passes the JWT via Authorization header.
 * For guests:              passes the guest_id UUID in the request body.
 *
 * Falls back to a local-only guest identity if the Edge Function is
 * unreachable (network error, timeout, cold-start timeout).
 *
 * Return shapes:
 *   { type: 'user',  user_id, credits_balance, unlimited_until, created }
 *   { type: 'guest', guest_id, credits_balance, unlimited_until, created }
 *   { type: 'guest', guest_id, credits_balance: null, error }   ← fallback
 *
 * @returns {Promise<object>}
 */
export async function getCurrentIdentity() {
    try {
        // Get the Supabase project URL from the client (e.g. https://xyz.supabase.co)
        // supabase.functions.invoke handles the URL + anon key automatically
        const { data: { session } } = await supabase.auth.getSession();

        let result;

        if (session) {
            // ── Authenticated path ── pass JWT, no body needed
            console.log('[identity] calling ensure_identity as user:', session.user.email);
            const { data, error } = await invokeWithTimeout(
                EDGE_FN_NAME,
                { body: {} },
                EDGE_FN_TIMEOUT
            );
            if (error) throw error;
            result = data;
        } else {
            // ── Guest path ── pass guest_id in body
            const guestId = getOrCreateGuestId();
            console.log('[identity] calling ensure_identity as guest:', guestId);
            const { data, error } = await invokeWithTimeout(
                EDGE_FN_NAME,
                { body: { guest_id: guestId } },
                EDGE_FN_TIMEOUT
            );
            if (error) throw error;
            result = data;
        }

        console.log('[identity] ✅ ensure_identity returned:', result);
        return result;

    } catch (err) {
        // Edge Function unreachable or timed out — return a local fallback
        console.warn('[identity] ⚠️ ensure_identity failed, using local fallback:', err.message);
        const guestId = getOrCreateGuestId();
        return {
            type: 'guest',
            guest_id: guestId,
            credits_balance: null,   // unknown — don't assume any value
            unlimited_until: null,
            error: err.message,
        };
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Call supabase.functions.invoke with an AbortController timeout.
 * @param {string} name
 * @param {object} opts     passed to invoke()
 * @param {number} timeoutMs
 */
async function invokeWithTimeout(name, opts, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const result = await supabase.functions.invoke(name, {
            ...opts,
            signal: controller.signal,
        });
        return result;
    } finally {
        clearTimeout(timer);
    }
}
