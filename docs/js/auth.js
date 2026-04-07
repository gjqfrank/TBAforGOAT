/* ═══════════════════════════════════════════════════════════
   auth.js — Email/Password + Request Account auth via Supabase
   GoTrue REST API.  Read-First model: app loads as guest,
   authenticated session restores silently in background.

   Zero dependencies — vanilla fetch against the GoTrue endpoints.
   No @supabase/supabase-js SDK.

   Public API (window.Auth):
     login(email, password)     — email/password sign-in
     getSession()               — current session or null
     getAccessToken()           — JWT string or null
     getAuthHeader()            — { Authorization: 'Bearer ...' } or {}
     getUser()                  — user object or null
     isAuthenticated()          — boolean
     refreshSession()           — exchange refresh_token for new JWT
     logout()                   — clear session from localStorage
     onAuthChange(cb)           — register listener for auth state changes
     requestAccount(name,email) — insert into account_requests via REST
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

    // ── Email/Password login ───────────────────────────────
    async function login(email, password) {
        try {
            const resp = await fetch(AUTH_BASE + '/token?grant_type=password', {
                method: 'POST',
                headers: _headers(),
                body: JSON.stringify({ email, password }),
            });

            if (!resp.ok) {
                const body = await resp.json().catch(() => ({}));
                return { user: null, error: body.error_description || body.msg || `HTTP ${resp.status}` };
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
    async function requestAccount(name, email) {
        try {
            const resp = await fetch(REST_BASE + '/account_requests', {
                method: 'POST',
                headers: {
                    ..._headers(),
                    'Prefer': 'return=minimal',
                },
                body: JSON.stringify({ name, email }),
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
        login,
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

function updateAuthUI() {
    const authed = Auth.isAuthenticated();
    window.isGuest = !authed;

    const btn = document.getElementById('auth-trigger-btn');
    const icon = document.getElementById('auth-trigger-icon');
    if (btn) {
        btn.title = authed ? 'Logged in' : 'Admin Login';
        btn.classList.toggle('auth-active', authed);
    }
    // Swap lock icon to unlocked when authenticated
    if (icon) {
        icon.innerHTML = authed
            ? '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'
            : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
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
        // Already logged in — show a quick logout prompt instead
        if (confirm('You are logged in. Log out?')) {
            Auth.logout().then(() => { updateAuthUI(); });
        }
        return;
    }
    showLoginState();
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('login-email')?.focus();
}

function hideLoginModal() {
    document.getElementById('login-overlay').classList.add('hidden');
    // Clear forms
    document.getElementById('login-form')?.reset();
    document.getElementById('request-form')?.reset();
    _hideEl('login-error');
    _hideEl('request-error');
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

// ── Form handlers ──────────────────────────────────────────
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) return false;

    const btn = document.getElementById('login-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    _hideEl('login-error');

    const { user, error } = await Auth.login(email, password);

    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In';

    if (error) {
        _showError('login-error', error);
        return false;
    }

    hideLoginModal();
    updateAuthUI();
    return false;
}

async function handleAccountRequest(e) {
    e.preventDefault();
    const name  = document.getElementById('request-name').value.trim();
    const email = document.getElementById('request-email').value.trim();
    if (!name || !email) return false;

    const btn = document.getElementById('request-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    _hideEl('request-error');

    const { error } = await Auth.requestAccount(name, email);

    btn.disabled = false;
    btn.textContent = 'Submit Request';

    if (error) {
        _showError('request-error', error);
        return false;
    }

    showRequestSuccess();
    return false;
}

// ── Silent restore on load ─────────────────────────────────
// App already loads as guest — this upgrades silently if session exists
Auth.silentRestore().then(restored => {
    if (restored) {
        console.info('[Auth] Session restored silently');
    }
    updateAuthUI();
});

// Listen for future auth changes
Auth.onAuthChange(() => updateAuthUI());
