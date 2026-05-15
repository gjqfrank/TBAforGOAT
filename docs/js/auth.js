/* ═══════════════════════════════════════════════════════════
   auth.js — Email OTP + Request Account auth via Supabase
   GoTrue REST API.  Read-First model: app loads as guest,
   authenticated session restores silently in background.

   Zero dependencies — vanilla fetch against the GoTrue endpoints.
   No @supabase/supabase-js SDK.

   Public API (window.Auth):
     sendOtp(email)                        — send magic-link / OTP code
     verifyOtp(email, code)                — verify OTP, store session
     getSession()                          — current session or null
     getAccessToken()                      — JWT string or null
     getAuthHeader()                       — { Authorization: 'Bearer ...' } or {}
     getUser()                             — user object or null
     isAuthenticated()                     — boolean
     refreshSession()                      — exchange refresh_token for new JWT
     logout()                              — clear session from localStorage
     onAuthChange(cb)                      — register listener for auth state changes
     requestAccount(name,email,role,event) — insert into account_requests via REST
   ═══════════════════════════════════════════════════════════ */

const Auth = (() => {
    'use strict';

    // ── Supabase project config ────────────────────────────
    const SUPABASE_URL  = 'https://qytovurlcjrpvlbmkyip.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dG92dXJsY2pycHZsYm1reWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDUzNDIsImV4cCI6MjA5MDk4MTM0Mn0.-nRiYhXoHtZ4kTZgarq8r-c4HUYj8gmbem5qMxVQ8Ss';

    const AUTH_BASE     = SUPABASE_URL + '/auth/v1';
    const REST_BASE     = SUPABASE_URL + '/rest/v1';
    const LS_KEY        = 'casters_auth_session';

    let _session   = null;   // { access_token, refresh_token, expires_at, user }
    let _listeners = [];

    // ── Internal helpers ───────────────────────────────────
    function _headers() {
        return {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON,
        };
    }

    function _saveSession(session) {
        _session = session;
        try { localStorage.setItem(LS_KEY, JSON.stringify(session)); }
        catch { /* quota — non-fatal */ }
        _notify();
    }

    function _clearSession() {
        _session = null;
        try { localStorage.removeItem(LS_KEY); }
        catch { /* ignore */ }
        _notify();
    }

    function _loadSession() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) _session = JSON.parse(raw);
        } catch { _session = null; }
    }

    function _notify() {
        const user = _session?.user || null;
        for (const cb of _listeners) {
            try { cb(user); } catch (e) { console.error('[Auth] listener error:', e); }
        }
    }

    function _parseJwtExp(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.exp || 0;
        } catch { return 0; }
    }

    function _isExpired() {
        if (!_session?.access_token) return true;
        const exp = _parseJwtExp(_session.access_token);
        return Date.now() / 1000 > exp - 60;
    }

    function _sessionFromResponse(data) {
        return {
            access_token:  data.access_token,
            refresh_token: data.refresh_token,
            expires_at:    data.expires_at || (Date.now() / 1000 + (data.expires_in || 3600)),
            user:          data.user || null,
        };
    }

    async function _fetchUser(accessToken) {
        try {
            const resp = await fetch(AUTH_BASE + '/user', {
                headers: { ..._headers(), 'Authorization': 'Bearer ' + accessToken },
            });
            if (resp.ok) return await resp.json();
        } catch { /* offline */ }
        return null;
    }

    // ── Handle magic-link redirect (tokens in URL hash) ──
    async function handleMagicLinkRedirect() {
        const hash = window.location.hash;
        if (!hash || !hash.includes('access_token=')) return false;

        const params = new URLSearchParams(hash.substring(1));
        const accessToken  = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const expiresIn    = parseInt(params.get('expires_in') || '3600', 10);

        if (!accessToken) return false;

        // Clear tokens from URL
        history.replaceState(null, '', window.location.pathname + window.location.search);

        const user = await _fetchUser(accessToken);
        const session = {
            access_token:  accessToken,
            refresh_token: refreshToken,
            expires_at:    Date.now() / 1000 + expiresIn,
            user,
        };
        _saveSession(session);

        // Backfill display name from account_requests if missing
        _backfillName(session).catch(() => {});

        return true;
    }

    // ── Send OTP ───────────────────────────────────────────
    async function sendOtp(email) {
        try {
            const resp = await fetch(AUTH_BASE + '/otp', {
                method: 'POST',
                headers: _headers(),
                body: JSON.stringify({
                    email,
                    create_user: false,   // only pre-approved users
                }),
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                const raw = body.msg || body.error_description || body.message || `HTTP ${resp.status}`;
                const isRateLimit = resp.status === 429
                    || /rate.limit|too.many/i.test(raw)
                    || body.error_code === 'over_email_send_rate_limit';
                const msg = isRateLimit
                    ? 'Too many sign-in emails sent recently. Please wait a few minutes and try again.'
                    : raw;
                return { error: msg };
            }
            return { error: null };
        } catch (e) {
            return { error: e.message || 'Network error' };
        }
    }

    // ── Verify OTP ─────────────────────────────────────────
    async function verifyOtp(email, code) {
        try {
            const resp = await fetch(AUTH_BASE + '/verify', {
                method: 'POST',
                headers: _headers(),
                body: JSON.stringify({
                    type:  'email',
                    email,
                    token: code,
                }),
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                return { user: null, error: body.msg || body.error_description || `HTTP ${resp.status}` };
            }

            const data = await resp.json();
            const session = _sessionFromResponse(data);
            _saveSession(session);

            // Backfill display name from account_requests if missing
            _backfillName(session).catch(() => {});

            return { user: session.user, error: null };
        } catch (e) {
            return { user: null, error: e.message || 'Network error' };
        }
    }

    // ── Backfill user_metadata.name from account_requests ──
    async function _backfillName(session) {
        const user = session?.user;
        if (!user || user.user_metadata?.name) return;

        // Fetch name from account_requests
        const email = encodeURIComponent(user.email);
        const resp = await fetch(
            REST_BASE + '/account_requests?select=name&email=eq.' + email + '&limit=1',
            { headers: { ..._headers(), 'Authorization': 'Bearer ' + session.access_token } }
        );
        if (!resp.ok) return;
        const rows = await resp.json();
        const name = rows?.[0]?.name;
        if (!name) return;

        // Patch user_metadata via GoTrue
        const patchResp = await fetch(AUTH_BASE + '/user', {
            method: 'PUT',
            headers: { ..._headers(), 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ data: { name } }),
        });
        if (!patchResp.ok) return;
        const updated = await patchResp.json();
        session.user = updated;
        _saveSession(session);
    }

    // ── Refresh session ────────────────────────────────────
    async function refreshSession() {
        if (!_session?.refresh_token) return false;

        try {
            const resp = await fetch(AUTH_BASE + '/token?grant_type=refresh_token', {
                method: 'POST',
                headers: _headers(),
                body: JSON.stringify({ refresh_token: _session.refresh_token }),
            });

            if (!resp.ok) {
                _clearSession();
                return false;
            }

            const data = await resp.json();
            _saveSession(_sessionFromResponse(data));
            return true;
        } catch {
            return false;
        }
    }

    // ── Silent session restore (background) ────────────────
    async function silentRestore() {
        _loadSession();
        if (!_session?.access_token) return false;
        if (_isExpired()) {
            return await refreshSession();
        }
        _notify();
        return true;
    }

    // ── Session accessors ──────────────────────────────────
    function getSession() {
        if (!_session) _loadSession();
        return _session;
    }

    function getAccessToken() {
        const s = getSession();
        if (!s?.access_token) return null;
        if (_isExpired()) {
            refreshSession();
        }
        return s.access_token;
    }

    function getAuthHeader() {
        const token = getAccessToken();
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }

    function getUser() {
        const s = getSession();
        return s?.user || null;
    }

    function isAuthenticated() {
        return !!getAccessToken();
    }

    // ── Logout ─────────────────────────────────────────────
    async function logout() {
        if (_session?.access_token) {
            try {
                await fetch(AUTH_BASE + '/logout', {
                    method: 'POST',
                    headers: {
                        ..._headers(),
                        'Authorization': 'Bearer ' + _session.access_token,
                    },
                });
            } catch { /* offline logout is fine */ }
        }
        _clearSession();
    }

    // ── Request Account (anon insert into account_requests) ─
    async function requestAccount(name, email, role, eventName) {
        const payload = { name, email, role };
        if (role === 'volunteer' && eventName) {
            payload.event_name = eventName;
        }

        try {
            const resp = await fetch(REST_BASE + '/account_requests', {
                method: 'POST',
                headers: {
                    ..._headers(),
                    'Prefer': 'return=minimal',
                },
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                return { error: body.message || `HTTP ${resp.status}` };
            }
            return { error: null };
        } catch (e) {
            return { error: e.message || 'Network error' };
        }
    }

    // ── Auth state change listener ─────────────────────────
    function onAuthChange(cb) {
        _listeners.push(cb);
        return () => { _listeners = _listeners.filter(fn => fn !== cb); };
    }

    // ── Public API ─────────────────────────────────────────
    return {
        sendOtp,
        verifyOtp,
        handleMagicLinkRedirect,
        getSession,
        getAccessToken,
        getAuthHeader,
        getUser,
        isAuthenticated,
        refreshSession,
        silentRestore,
        logout,
        onAuthChange,
        requestAccount,
        /** Called by the passkey flow after backend validates the assertion. */
        _saveSessionFromPasskey(sessionData) {
            const session = _sessionFromResponse(sessionData);
            _saveSession(session);
            _backfillName(session).catch(() => {});
        },
        SUPABASE_URL,
        SUPABASE_ANON,
    };
})();

// ═══════════════════════════════════════════════════════════
// Auth UI wiring — Read-First model
// ═══════════════════════════════════════════════════════════

// Global guest flag — starts true, set false on successful auth
window.isGuest = true;

function _getInitials(user) {
    if (!user) return '';
    // Try user_metadata.name first, then fall back to email
    const name = user.user_metadata?.name || user.email || '';
    if (name.includes('@')) {
        // Email — take first letter of local part
        return name.charAt(0).toUpperCase();
    }
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0]?.[0] || '').toUpperCase();
}

function updateAuthUI() {
    const authed = Auth.isAuthenticated();
    window.isGuest = !authed;

    // Swap gear ↔ user icon on the merged settings button
    const btn = document.getElementById('settings-trigger-btn');
    const gearIcon = document.getElementById('settings-gear-icon');
    const userIcon = document.getElementById('settings-user-icon');
    if (btn) {
        const user = Auth.getUser();
        btn.title = authed ? (user?.email || 'Logged in') : 'Settings';
        btn.classList.toggle('auth-active', authed);

        if (authed && user) {
            if (gearIcon) gearIcon.classList.add('hidden');
            if (userIcon) userIcon.classList.remove('hidden');
            // Show initials badge
            const initials = _getInitials(user);
            let badge = btn.querySelector('.auth-initials');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'auth-initials';
                btn.appendChild(badge);
            }
            badge.textContent = initials;
            badge.classList.remove('hidden');
            if (userIcon) userIcon.classList.add('hidden'); // prefer initials over generic icon
        } else {
            if (gearIcon) gearIcon.classList.remove('hidden');
            if (userIcon) userIcon.classList.add('hidden');
            const badge = btn.querySelector('.auth-initials');
            if (badge) badge.classList.add('hidden');
        }
    }

    // Update settings auth section
    const settingsAuthLabel = document.getElementById('settings-auth-label');
    const settingsAuthSub = document.getElementById('settings-auth-sub');
    const settingsAuthBtn = document.getElementById('settings-auth-btn');
    if (settingsAuthLabel) {
        const user = Auth.getUser();
        if (authed && user) {
            const displayName = user.user_metadata?.name || user.email?.split('@')[0] || 'Caster';
            settingsAuthLabel.textContent = 'Hey, ' + displayName + '!';
            if (settingsAuthSub) settingsAuthSub.textContent = user.email || '';
            if (settingsAuthBtn) {
                settingsAuthBtn.style.cursor = 'default';
                settingsAuthBtn.onclick = null;
            }
        } else {
            settingsAuthLabel.textContent = 'Sign In';
            if (settingsAuthSub) settingsAuthSub.textContent = '';
            if (settingsAuthBtn) {
                settingsAuthBtn.style.cursor = 'pointer';
                settingsAuthBtn.onclick = function() { showLoginModal(); toggleSettings(); };
            }
        }
    }

    // Show/hide sign-out button
    const logoutBtn = document.getElementById('settings-logout-btn');
    if (logoutBtn) logoutBtn.classList.toggle('hidden', !authed);

    // Toggle visibility of auth-only elements
    document.querySelectorAll('[data-auth-only]').forEach(el => {
        el.classList.toggle('hidden', !authed);
    });
    document.querySelectorAll('[data-guest-hide]').forEach(el => {
        el.classList.toggle('hidden', authed);
    });
}

// ── Modal state management ─────────────────────────────────
function showLoginModal() {
    if (Auth.isAuthenticated()) return;
    showLoginState();
    // Show the discover-passkey button only when the platform supports WebAuthn
    const discoverBtn = document.getElementById('passkey-discover-btn');
    const discoverDivider = document.getElementById('passkey-discover-divider');
    const available = _isWebAuthnAvailable();
    if (discoverBtn) discoverBtn.classList.toggle('hidden', !available);
    if (discoverDivider) discoverDivider.classList.toggle('hidden', !available);
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email')?.focus();
}

function handleLogout() {
    document.getElementById('settings-menu')?.classList.add('hidden');
    Auth.logout().then(() => { updateAuthUI(); });
}

function hideLoginModal() {
    document.getElementById('login-overlay').classList.add('hidden');
    // Clear forms and reset to email step
    document.getElementById('login-form')?.reset();
    document.getElementById('request-form')?.reset();
    _hideEl('login-error');
    _hideEl('request-error');
    // Reset OTP state
    const otpGroup = document.getElementById('otp-group');
    const emailInput = document.getElementById('login-email');
    const submitBtn = document.getElementById('login-submit-btn');
    if (otpGroup) otpGroup.classList.add('hidden');
    if (emailInput) emailInput.readOnly = false;
    if (submitBtn) {
        submitBtn.dataset.step = 'email';
        submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Send Code';
    }
    // Reset passkey UI
    const passkeyBtn = document.getElementById('passkey-signin-btn');
    const passkeyDivider = document.getElementById('passkey-divider');
    if (passkeyBtn) passkeyBtn.classList.add('hidden');
    if (passkeyDivider) passkeyDivider.classList.add('hidden');
    _hideEl('passkey-signin-error');
    _hideEl('passkey-offer-error');
    _passkeyEmailCache = {};
}

function showLoginState() {
    _showState('login-state');
}

function showRequestState() {
    _showState('request-state');
    document.getElementById('request-name')?.focus();
}

function showRequestSuccess() {
    _showState('request-success-state');
}

function _showState(activeId) {
    ['login-state', 'request-state', 'request-success-state', 'passkey-offer-state'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== activeId);
    });
}

function _hideEl(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
}

function _showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

// ── OTP two-step login handler ─────────────────────────────
async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-submit-btn');
    const step = btn.dataset.step || 'email';

    if (step === 'email') {
        // Step 1: send OTP
        const email = document.getElementById('login-email').value.trim();
        if (!email) return false;

        btn.disabled = true;
        btn.textContent = 'Sending…';
        _hideEl('login-error');

        const { error } = await Auth.sendOtp(email);

        btn.disabled = false;

        if (error) {
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Send Code';
            _showError('login-error', error);
            return false;
        }

        // Transition to OTP step
        document.getElementById('login-email').readOnly = true;
        document.getElementById('otp-group').classList.remove('hidden');
        document.getElementById('login-otp').focus();
        btn.dataset.step = 'otp';
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Verify &amp; Sign In';

    } else {
        // Step 2: verify OTP
        const email = document.getElementById('login-email').value.trim();
        const code  = document.getElementById('login-otp').value.trim();
        if (!email || !code) return false;

        btn.disabled = true;
        btn.textContent = 'Verifying…';
        _hideEl('login-error');

        const { user, error } = await Auth.verifyOtp(email, code);

        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Verify &amp; Sign In';

        if (error) {
            _showError('login-error', error);
            return false;
        }

        updateAuthUI();
        // Offer passkey registration if WebAuthn is supported and no passkey yet
        await _maybeOfferPasskey();
    }
    return false;
}

// ── Request account handler (with role + event_name) ───────
async function handleAccountRequest(e) {
    e.preventDefault();
    const name  = document.getElementById('request-name').value.trim();
    const email = document.getElementById('request-email').value.trim();
    const agree = document.getElementById('request-agree')?.checked;

    // Role
    const roleEl = document.querySelector('input[name="request-role"]:checked');
    const role = roleEl ? roleEl.value : '';

    // Event name (only for volunteer)
    const eventName = document.getElementById('request-event')?.value.trim() || '';

    if (!name || !email || !role) return false;
    if (role === 'volunteer' && !eventName) {
        _showError('request-error', 'Please enter the event you are volunteering at.');
        return false;
    }
    if (!agree) {
        _showError('request-error', 'You must agree to the usage terms.');
        return false;
    }

    const btn = document.getElementById('request-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    _hideEl('request-error');

    const { error } = await Auth.requestAccount(name, email, role, eventName);

    btn.disabled = false;
    btn.textContent = 'Submit Request';

    if (error) {
        _showError('request-error', error);
        return false;
    }

    showRequestSuccess();
    return false;
}

// ── Toggle volunteer event field visibility ────────────────
function handleRoleChange() {
    const volunteerChecked = document.getElementById('role-volunteer')?.checked;
    const eventGroup = document.getElementById('request-event-group');
    if (eventGroup) {
        eventGroup.classList.toggle('hidden', !volunteerChecked);
    }
}

// ── Boot: magic-link redirect → silent restore ────────────
Auth.handleMagicLinkRedirect().then(handled => {
    if (handled) {
        console.info('[Auth] Magic-link sign-in completed');
        updateAuthUI();
        return;
    }
    Auth.silentRestore().then(restored => {
        if (restored) {
            console.info('[Auth] Session restored silently');
        }
        updateAuthUI();
    });
});

Auth.onAuthChange(() => updateAuthUI());

// ═══════════════════════════════════════════════════════════
// Passkey (WebAuthn) — registration + authentication
// ═══════════════════════════════════════════════════════════

const PASSKEY_API = '/auth/passkey';

// Simple per-session cache: email → {has_passkey, fetched_at}
let _passkeyEmailCache = {};
let _emailCheckTimer = null;

/** Check (with debounce) whether a passkey exists for the typed email. */
function onLoginEmailInput() {
    clearTimeout(_emailCheckTimer);
    const email = document.getElementById('login-email')?.value.trim() || '';

    // Hide immediately when field is cleared
    if (!email || !email.includes('@')) {
        _setPasskeyButtonVisible(false);
        return;
    }

    _emailCheckTimer = setTimeout(() => _checkPasskeyForEmail(email), 600);
}

async function _checkPasskeyForEmail(email) {
    if (!_isWebAuthnAvailable()) return;

    // Use cache to avoid hammering the backend
    const cached = _passkeyEmailCache[email];
    if (cached && Date.now() - cached.fetched_at < 60_000) {
        _setPasskeyButtonVisible(cached.has_passkey);
        return;
    }

    try {
        const resp = await fetch(
            `${PASSKEY_API}/has-credential?email=${encodeURIComponent(email)}`
        );
        if (!resp.ok) return;
        const { has_passkey } = await resp.json();
        _passkeyEmailCache[email] = { has_passkey, fetched_at: Date.now() };
        _setPasskeyButtonVisible(has_passkey);
    } catch { /* non-fatal — passkey button stays hidden */ }
}

function _setPasskeyButtonVisible(show) {
    const btn = document.getElementById('passkey-signin-btn');
    const div = document.getElementById('passkey-divider');
    if (btn) btn.classList.toggle('hidden', !show);
    if (div) div.classList.toggle('hidden', !show);
}

/** Called by the top-level "Sign in with Passkey" button — no email required (discoverable credentials). */
async function handlePasskeyDiscover(e) {
    e.preventDefault();
    const btn = document.getElementById('passkey-discover-btn');
    _hideEl('passkey-discover-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for device…'; }

    try {
        // 1. Get discoverable-credential options (no email needed)
        const optResp = await fetch(`${PASSKEY_API}/discover-options`, { method: 'POST' });
        if (!optResp.ok) {
            _showError('passkey-discover-error', 'Could not start passkey sign-in. Please try again.');
            return;
        }
        const opts = await optResp.json();

        // 2. Prompt the platform authenticator — browser shows the passkey picker
        const credential = await navigator.credentials.get({
            publicKey: _parseAuthOptions(opts),
        });

        // 3. Send assertion to backend → receive Supabase session
        const authResp = await fetch(`${PASSKEY_API}/discover-authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: _credentialToJSON(credential) }),
        });
        const sessionData = await authResp.json();

        if (!authResp.ok) {
            _showError('passkey-discover-error', sessionData.detail || 'Passkey verification failed.');
            return;
        }

        Auth._saveSessionFromPasskey(sessionData);
        hideLoginModal();
        updateAuthUI();

    } catch (err) {
        if (err?.name === 'NotAllowedError') {
            // User cancelled — silent
        } else {
            _showError('passkey-discover-error', err.message || 'Passkey sign-in failed.');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="19" cy="19" r="3"/><line x1="19" y1="16" x2="19" y2="13"/><line x1="22" y1="19" x2="19" y2="19"/></svg> Sign in with Passkey`;
        }
    }
}

/** Called by the "Sign in with Passkey" button in the login form. */
async function handlePasskeySignIn(e) {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value.trim();
    if (!email) return;

    const btn = document.getElementById('passkey-signin-btn');
    _hideEl('passkey-signin-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Waiting for device…'; }

    try {
        // 1. Get authentication options from backend
        const optResp = await fetch(`${PASSKEY_API}/authenticate-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const opts = await optResp.json();

        if (!optResp.ok || !opts.has_passkey) {
            _showError('passkey-signin-error', 'No passkey found for this email. Use the code method below.');
            return;
        }

        // 2. Prompt the platform authenticator
        const credential = await navigator.credentials.get({
            publicKey: _parseAuthOptions(opts),
        });

        // 3. Send assertion to backend → receive Supabase session
        const authResp = await fetch(`${PASSKEY_API}/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, credential: _credentialToJSON(credential) }),
        });
        const sessionData = await authResp.json();

        if (!authResp.ok) {
            _showError('passkey-signin-error', sessionData.detail || 'Passkey verification failed.');
            return;
        }

        // 4. Store the session just like OTP auth does
        Auth._saveSessionFromPasskey(sessionData);
        hideLoginModal();
        updateAuthUI();

    } catch (err) {
        if (err?.name === 'NotAllowedError') {
            // User cancelled — don't show error
        } else {
            _showError('passkey-signin-error', err.message || 'Passkey sign-in failed.');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="19" cy="19" r="3"/><line x1="19" y1="16" x2="19" y2="13"/><line x1="22" y1="19" x2="19" y2="19"/></svg> Sign in with Passkey`;
        }
    }
}

/** Offer passkey registration after a successful OTP sign-in. */
async function _maybeOfferPasskey() {
    // Require WebAuthn support
    if (!_isWebAuthnAvailable()) {
        hideLoginModal();
        return;
    }
    // Require an authenticated session
    const token = Auth.getAccessToken();
    const user  = Auth.getUser();
    if (!token || !user?.email) {
        hideLoginModal();
        return;
    }
    // Check if they already have a passkey (skip offer if so)
    try {
        const resp = await fetch(
            `${PASSKEY_API}/has-credential?email=${encodeURIComponent(user.email)}`
        );
        const { has_passkey } = await resp.json();
        if (has_passkey) { hideLoginModal(); return; }
    } catch { hideLoginModal(); return; }

    // Show the offer
    _showState('passkey-offer-state');
}

/** Called by "Set Up Passkey" button. */
async function handlePasskeyRegister() {
    const token = Auth.getAccessToken();
    const user  = Auth.getUser();
    if (!token || !user?.email) return;

    const btn = document.getElementById('passkey-register-btn');
    _hideEl('passkey-offer-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Setting up…'; }

    try {
        // 1. Fetch registration options
        const optResp = await fetch(`${PASSKEY_API}/register-options`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ email: user.email }),
        });
        if (!optResp.ok) {
            const d = await optResp.json().catch(() => ({}));
            _showError('passkey-offer-error', d.detail || 'Failed to start registration.');
            return;
        }
        const opts = await optResp.json();

        // 2. Prompt the authenticator
        const credential = await navigator.credentials.create({
            publicKey: _parseCreationOptions(opts),
        });

        // 3. Verify and store on backend
        const regResp = await fetch(`${PASSKEY_API}/register`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                email:      user.email,
                credential: _credentialToJSON(credential),
            }),
        });
        const result = await regResp.json();
        if (!regResp.ok) {
            _showError('passkey-offer-error', result.detail || 'Registration failed.');
            return;
        }

        // Success — dismiss the offer
        hideLoginModal();

    } catch (err) {
        if (err?.name === 'NotAllowedError') {
            // User cancelled — treat as "not now"
            hideLoginModal();
        } else {
            _showError('passkey-offer-error', err.message || 'Passkey setup failed.');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Set Up Passkey`;
        }
    }
}

function dismissPasskeyOffer() {
    hideLoginModal();
}

// ── WebAuthn helpers ─────────────────────────────────────────────────────

function _isWebAuthnAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials?.get);
}

/** Convert base64url strings in server options to ArrayBuffers for the browser API. */
function _parseCreationOptions(opts) {
    return {
        ...opts,
        challenge: _b64ToBuffer(opts.challenge),
        user: {
            ...opts.user,
            id: _b64ToBuffer(opts.user.id),
        },
        excludeCredentials: (opts.excludeCredentials || []).map(c => ({
            ...c,
            id: _b64ToBuffer(c.id),
        })),
    };
}

function _parseAuthOptions(opts) {
    return {
        ...opts,
        challenge: _b64ToBuffer(opts.challenge),
        allowCredentials: (opts.allowCredentials || []).map(c => ({
            ...c,
            id: _b64ToBuffer(c.id),
        })),
    };
}

function _b64ToBuffer(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

function _bufferToB64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Serialize a PublicKeyCredential to a plain JSON-safe object. */
function _credentialToJSON(cred) {
    const json = { id: cred.id, rawId: _bufferToB64Url(cred.rawId), type: cred.type };
    const resp = cred.response;
    if (resp instanceof AuthenticatorAttestationResponse) {
        json.response = {
            clientDataJSON:    _bufferToB64Url(resp.clientDataJSON),
            attestationObject: _bufferToB64Url(resp.attestationObject),
        };
    } else {
        json.response = {
            clientDataJSON:    _bufferToB64Url(resp.clientDataJSON),
            authenticatorData: _bufferToB64Url(resp.authenticatorData),
            signature:         _bufferToB64Url(resp.signature),
            userHandle:        resp.userHandle ? _bufferToB64Url(resp.userHandle) : null,
        };
    }
    return json;
}

