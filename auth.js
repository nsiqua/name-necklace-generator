/**
 * auth.js — Supabase Auth module
 *
 * Design principles:
 *  - UI ALWAYS updates immediately — identity/DB fetch never blocks widget
 *  - credits_balance + unlimited_until stored in `appState` singleton
 *  - Every async handler is wrapped in try/catch/finally
 *  - signIn/signUp have an explicit timeout so "Please wait…" can't get stuck
 *  - signOut forces immediate local UI reset, doesn't wait for onAuthStateChange
 *  - onAuthStateChange is registered exactly once (initAuth guard)
 *
 * Exports:
 *   initAuth(onIdentityChange)  — call once on startup
 *   refreshCredits()            — re-fetch identity + credits and update UI
 *   appState                    — { type, userId?, email?, guestId?,
 *                                    credits_balance, unlimited_until }
 *   currentUser                 — Supabase User or null
 *   currentIdentity             — alias for appState (backward compat)
 */

import { supabase } from './supabaseClient.js';
import { getCurrentIdentity, getOrCreateGuestId } from './guestIdentity.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const AUTH_TIMEOUT_MS = 12000;
const IDENTITY_TIMEOUT_MS = 8000;

// ── Global state ──────────────────────────────────────────────────────────────
/**
 * Single source of truth for the current identity + credits.
 * Always reflects the last successful ensure_identity response.
 *
 * Shape:
 *   { type: 'user'|'guest',
 *     userId?: string, email?: string, guestId?: string,
 *     credits_balance: number|null,
 *     unlimited_until: string|null,
 *     error?: string }
 */
export const appState = {
    type: 'guest',
    userId: null,
    email: null,
    guestId: null,
    credits_balance: null,
    unlimited_until: null,
};

export let currentUser = null;
export let currentIdentity = appState; // backward-compat alias

// ── DOM refs ──────────────────────────────────────────────────────────────────
let _accountEmail;
let _creditBadge;
let _sessionStatus;
let _authBtn;
let _signOutBtn;
let _authModal;
let _authModalClose;
let _authTabs;
let _authForm;
let _authEmail;
let _authPassword;
let _authSubmitBtn;
let _authError;
let _googleBtn;
let _activeTab = 'login';

// ── initAuth / refreshCredits callbacks ───────────────────────────────────────
let _onIdentityChange = () => { };

// ── initAuth guard ────────────────────────────────────────────────────────────
let _initialized = false;

// ── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`[auth] ${label} timed out after ${ms}ms`)),
                ms
            )
        ),
    ]);
}

// ── State helpers ─────────────────────────────────────────────────────────────

/** Merge a partial identity into appState and keep currentIdentity in sync. */
function applyIdentity(identity) {
    Object.assign(appState, {
        type: identity.type,
        userId: identity.user_id ?? identity.userId ?? null,
        email: identity.email ?? null,
        guestId: identity.guest_id ?? identity.guestId ?? null,
        credits_balance: identity.credits_balance ?? null,
        unlimited_until: identity.unlimited_until ?? null,
        error: identity.error ?? null,
    });
    // Keep the exported alias pointing at the same object
    currentIdentity = appState;
    console.log('[auth] appState updated:', { ...appState });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Update the account widget, credit badge, and session-status line.
 * Called immediately on every auth/identity event — never blocked by DB calls.
 */
function updateWidget(user, identity) {
    if (!_accountEmail) return;

    const credits = identity?.credits_balance;
    const unlimited = identity?.unlimited_until
        ? new Date(identity.unlimited_until) > new Date()
        : false;

    // ── Name / email display
    if (user) {
        _accountEmail.textContent = user.email;
        _authBtn.style.display = 'none';
        _signOutBtn.style.display = '';
    } else {
        const suffix = (identity?.guestId ?? identity?.guest_id ?? '').slice(-6) || '……';
        _accountEmail.textContent = `Guest ·${suffix}`;
        _authBtn.style.display = '';
        _signOutBtn.style.display = 'none';
    }

    // ── Credit badge
    if (_creditBadge) {
        if (unlimited) {
            _creditBadge.textContent = '∞';
            _creditBadge.title = 'Unlimited downloads active';
            _creditBadge.style.display = '';
        } else if (credits !== null && credits !== undefined) {
            _creditBadge.textContent = `${credits} cr`;
            _creditBadge.title = `${credits} download credit${credits !== 1 ? 's' : ''} remaining`;
            _creditBadge.style.display = '';
        } else {
            _creditBadge.style.display = 'none';
        }
    }

    // ── Session-status line
    if (_sessionStatus) {
        if (identity?.error) {
            _sessionStatus.textContent = 'Session: error (see console)';
            _sessionStatus.style.color = '#c62828';
        } else if (user) {
            const credStr = unlimited ? '∞' : credits !== null ? ` · ${credits} cr` : '';
            _sessionStatus.textContent = `Session: ${user.email}${credStr}`;
            _sessionStatus.style.color = '#2e7d32';
        } else {
            const s = (identity?.guestId ?? identity?.guest_id ?? '').slice(-6) || '……';
            const credStr = unlimited ? ' · ∞' : credits !== null ? ` · ${credits} cr` : '';
            _sessionStatus.textContent = `Session: Guest ·${s}${credStr}`;
            _sessionStatus.style.color = '#888';
        }
    }
}

function showModal() {
    _authModal.style.display = 'flex';
    _authEmail.focus();
}

function hideModal() {
    _authModal.style.display = 'none';
    _authError.textContent = '';
    _authForm.reset();
}

function setTab(tab) {
    _activeTab = tab;
    _authTabs.querySelectorAll('.auth-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    _authSubmitBtn.textContent = tab === 'login' ? 'Login' : 'Sign up';
    _authPassword.autocomplete = tab === 'login' ? 'current-password' : 'new-password';
    _authError.textContent = '';
}

function showError(msg) { _authError.textContent = msg; }

function setLoading(loading) {
    _authSubmitBtn.disabled = loading;
    _googleBtn.disabled = loading;
    _authSubmitBtn.textContent = loading
        ? 'Please wait…'
        : _activeTab === 'login' ? 'Login' : 'Sign up';
}

// ── Identity fetch ────────────────────────────────────────────────────────────

/**
 * Call the ensure_identity Edge Function with a hard timeout.
 * Always returns a usable identity object — never throws.
 *
 * @param {object|null} user  — Supabase auth user (or null for guests)
 * @returns {Promise<object>}
 */
async function fetchIdentitySafe(user) {
    try {
        // Always call the Edge Function — it returns credits_balance for both paths
        const identity = await withTimeout(
            getCurrentIdentity(),
            IDENTITY_TIMEOUT_MS,
            'getCurrentIdentity'
        );
        return identity;
    } catch (err) {
        console.warn('[auth] identity fetch failed, using local fallback:', err.message);
        if (user) {
            return {
                type: 'user', user_id: user.id, email: user.email,
                credits_balance: null, unlimited_until: null, error: err.message
            };
        }
        const guestId = getOrCreateGuestId();
        return {
            type: 'guest', guest_id: guestId,
            credits_balance: null, unlimited_until: null, error: err.message
        };
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) console.log('[auth] ✅ signIn ok:', data.user?.email);
    return error;
}

export async function signUp(email, password) {
    const { error } = await supabase.auth.signUp({ email, password });
    return error;
}

export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
    });
    return error;
}

/**
 * Re-fetch identity + credits from ensure_identity and update appState + UI.
 * Call this after a download consumes a credit to keep the badge current.
 * @returns {Promise<object>} the updated appState
 */
export async function refreshCredits() {
    console.log('[auth] refreshCredits()');
    try {
        const identity = await withTimeout(
            getCurrentIdentity(),
            IDENTITY_TIMEOUT_MS,
            'refreshCredits'
        );
        applyIdentity(identity);
        updateWidget(currentUser, appState);
        _onIdentityChange(appState);
    } catch (err) {
        console.warn('[auth] refreshCredits failed:', err.message);
    }
    return appState;
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wire up auth UI and subscribe to auth state changes.
 * Guarded — safe to call multiple times but only runs setup once.
 *
 * @param {function(identity: object): void} onIdentityChange
 */
export function initAuth(onIdentityChange = () => { }) {
    if (_initialized) {
        console.warn('[auth] initAuth called more than once — skipping duplicate setup');
        return;
    }
    _initialized = true;
    _onIdentityChange = onIdentityChange;

    // ── Grab DOM refs
    _accountEmail = document.getElementById('accountEmail');
    _creditBadge = document.getElementById('creditBadge');
    _sessionStatus = document.getElementById('sessionStatus');
    _authBtn = document.getElementById('authBtn');
    _signOutBtn = document.getElementById('signOutBtn');
    _authModal = document.getElementById('authModal');
    _authModalClose = document.getElementById('authModalClose');
    _authTabs = document.getElementById('authTabs');
    _authForm = document.getElementById('authForm');
    _authEmail = document.getElementById('authEmail');
    _authPassword = document.getElementById('authPassword');
    _authSubmitBtn = document.getElementById('authSubmitBtn');
    _authError = document.getElementById('authError');
    _googleBtn = document.getElementById('googleBtn');

    // ── Modal open / close
    _authBtn.addEventListener('click', showModal);
    _authModalClose.addEventListener('click', hideModal);
    _authModal.addEventListener('click', e => {
        if (e.target === _authModal) hideModal();
    });

    // ── Tab switching
    _authTabs.querySelectorAll('.auth-tab').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    // ── Email / password submit — with timeout + try/catch/finally
    _authForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = _authEmail.value.trim();
        const password = _authPassword.value;

        setLoading(true);
        showError('');

        try {
            const authCall = _activeTab === 'login'
                ? signIn(email, password)
                : signUp(email, password);

            const error = await withTimeout(authCall, AUTH_TIMEOUT_MS, 'signIn/signUp');

            if (error) {
                showError(error.message);
            } else if (_activeTab === 'signup') {
                showError('✓ Check your email to confirm your account.');
            } else {
                hideModal(); // onAuthStateChange will update widget with credits
            }
        } catch (err) {
            console.error('[auth] submit error:', err.message);
            showError(err.message.includes('timeout')
                ? 'Request timed out. Check your connection and try again.'
                : `Error: ${err.message}`
            );
        } finally {
            setLoading(false);
        }
    });

    // ── Google OAuth
    _googleBtn.addEventListener('click', async () => {
        setLoading(true);
        try {
            const error = await signInWithGoogle();
            if (error) {
                showError(error.message);
                setLoading(false);
            }
        } catch (err) {
            console.error('[auth] Google OAuth error:', err.message);
            showError(`Error: ${err.message}`);
            setLoading(false);
        }
    });

    // ── Sign out — immediate UI reset, no waiting for onAuthStateChange
    _signOutBtn.addEventListener('click', async () => {
        try {
            // 1. Immediately flip to guest state (no network needed)
            currentUser = null;
            const guestId = getOrCreateGuestId();
            applyIdentity({
                type: 'guest', guest_id: guestId,
                credits_balance: null, unlimited_until: null
            });
            updateWidget(null, appState);
            _onIdentityChange(appState);

            // 2. Tell Supabase (fire-and-forget — UI already updated)
            const { error } = await supabase.auth.signOut();
            if (error) {
                console.warn('[auth] signOut error (UI already reset):', error.message);
            } else {
                console.log('[auth] ✅ signOut ok');
                // Re-fetch guest identity with fresh credits from edge function
                refreshCredits();
            }
        } catch (err) {
            console.error('[auth] signOut threw:', err.message);
        }
    });

    // ── Auth state listener — registered exactly once
    supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('[auth] onAuthStateChange', event, !!session);

        try {
            currentUser = session?.user ?? null;

            // Phase 1 — update widget immediately with session data (no DB)
            const immediateIdentity = currentUser
                ? {
                    type: 'user', user_id: currentUser.id, email: currentUser.email,
                    credits_balance: null, unlimited_until: null
                }
                : {
                    type: 'guest', guest_id: getOrCreateGuestId(),
                    credits_balance: null, unlimited_until: null
                };

            applyIdentity(immediateIdentity);
            updateWidget(currentUser, appState);
            _onIdentityChange(appState);

            // Phase 2 — call ensure_identity in background to get real credits
            fetchIdentitySafe(currentUser).then(richIdentity => {
                applyIdentity(richIdentity);
                updateWidget(currentUser, appState);
                _onIdentityChange(appState);
            }).catch(err => {
                console.warn('[auth] background identity fetch failed:', err.message);
            });

        } catch (err) {
            console.error('[auth] onAuthStateChange handler error:', err.message);
        }
    });

    console.log('[auth] initAuth complete');
}
