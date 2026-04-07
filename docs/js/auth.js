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
        _saveSession({
            access_token:  accessToken,
            refresh_token: refreshToken,
            expires_at:    Date.now() / 1000 + expiresIn,
            user,
        });
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
                return { error: body.msg || body.error_description || `HTTP ${resp.status}` };
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
            return { user: session.user, error: null };
        } catch (e) {
            return { user: null, error: e.message || 'Network error' };
        }
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

    const btn = document.getElementById('auth-trigger-btn');
    const icon = document.getElementById('auth-trigger-icon');
    if (btn) {
        const user = Auth.getUser();
        btn.title = authed ? (user?.email || 'Logged in') : "Caster's Login";
        btn.classList.toggle('auth-active', authed);

        if (authed && user) {
            const initials = _getInitials(user);
            if (icon) icon.classList.add('hidden');
            let badge = btn.querySelector('.auth-initials');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'auth-initials';
                btn.appendChild(badge);
            }
            badge.textContent = initials;
            badge.classList.remove('hidden');
        } else {
            if (icon) icon.classList.remove('hidden');
            const badge = btn.querySelector('.auth-initials');
            if (badge) badge.classList.add('hidden');
        }
    }

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
    if (Auth.isAuthenticated()) {
        toggleAuthPopover();
        return;
    }
    showLoginState();
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email')?.focus();
}

function toggleAuthPopover() {
    const pop = document.getElementById('auth-popover');
    if (!pop) return;
    const showing = !pop.classList.contains('hidden');
    if (showing) {
        pop.classList.add('hidden');
        return;
    }
    // Populate user info
    const user = Auth.getUser();
    const name = user?.user_metadata?.name || '';
    const email = user?.email || '';
    const initials = _getInitials(user);
    const nameEl = document.getElementById('auth-popover-name');
    const emailEl = document.getElementById('auth-popover-email');
    const avatarEl = document.getElementById('auth-popover-initials');
    if (nameEl) nameEl.textContent = name || email.split('@')[0];
    if (emailEl) emailEl.textContent = email;
    if (avatarEl) avatarEl.textContent = initials;
    pop.classList.remove('hidden');

    // Close on outside click
    function closeOnOutside(e) {
        if (!pop.contains(e.target) && !e.target.closest('#auth-trigger-btn')) {
            pop.classList.add('hidden');
            document.removeEventListener('click', closeOnOutside, true);
        }
    }
    setTimeout(() => document.addEventListener('click', closeOnOutside, true), 0);
}

function handleLogout() {
    document.getElementById('auth-popover')?.classList.add('hidden');
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
    ['login-state', 'request-state', 'request-success-state'].forEach(id => {
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

        hideLoginModal();
        updateAuthUI();
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
