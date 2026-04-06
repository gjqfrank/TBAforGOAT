/* ═══════════════════════════════════════════════════════════
   auth.js — Passwordless OTP auth via Supabase GoTrue REST API

   Zero dependencies — vanilla fetch against the GoTrue endpoints.
   No @supabase/supabase-js SDK.

   Public API (window.Auth):
     sendOtp(email)             — request a 6-digit OTP code
     verifyOtp(email, code)     — verify OTP, store session
     getSession()               — current session or null
     getAccessToken()           — JWT string or null
     getAuthHeader()            — { Authorization: 'Bearer ...' } or {}
     getUser()                  — user object or null
     isAuthenticated()          — boolean
     refreshSession()           — exchange refresh_token for new JWT
     logout()                   — clear session from localStorage
     onAuthChange(cb)           — register listener for auth state changes
   ═══════════════════════════════════════════════════════════ */

const Auth = (() => {
    'use strict';

    // ── Supabase project config ────────────────────────────
    const SUPABASE_URL  = 'https://qytovurlcjrpvlbmkyip.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dG92dXJsY2pycHZsYm1reWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDUzNDIsImV4cCI6MjA5MDk4MTM0Mn0.-nRiYhXoHtZ4kTZgarq8r-c4HUYj8gmbem5qMxVQ8Ss';

    const AUTH_BASE     = SUPABASE_URL + '/auth/v1';
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
        // Treat as expired 60s early to allow proactive refresh
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
                    type:  'magiclink',
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

    // ── Session accessors ──────────────────────────────────
    function getSession() {
        if (!_session) _loadSession();
        return _session;
    }

    function getAccessToken() {
        const s = getSession();
        if (!s?.access_token) return null;
        if (_isExpired()) {
            // Trigger async refresh but return current token
            // (caller should await refreshSession() for guaranteed fresh token)
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
        // Best-effort server-side logout
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

    // ── Auth state change listener ─────────────────────────
    function onAuthChange(cb) {
        _listeners.push(cb);
        return () => { _listeners = _listeners.filter(fn => fn !== cb); };
    }

    // ── Init: restore session from localStorage on load ────
    _loadSession();

    // ── Public API ─────────────────────────────────────────
    return {
        sendOtp,
        verifyOtp,
        getSession,
        getAccessToken,
        getAuthHeader,
        getUser,
        isAuthenticated,
        refreshSession,
        logout,
        onAuthChange,
    };
})();
