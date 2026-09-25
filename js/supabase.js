/* Supabase client. Exposes OBD.sb (or null when not configured). */
(function(OBD){
'use strict';
var cfg = window.APP_CONFIG || {};
var url = String(cfg.SUPABASE_URL || '').trim();
var key = String(cfg.SUPABASE_KEY || '').trim();

OBD.config = cfg;
OBD.sb = null;
OBD.configured = false;

if (!url || !key){
  console.info('[obd] Supabase is not configured in js/config.js; running in read-only demo mode.');
} else if (!window.supabase || typeof window.supabase.createClient !== 'function'){
  console.error('[obd] supabase-js failed to load; running in read-only demo mode.');
} else if (/service_role|sb_secret_/i.test(key)){
  console.error('[obd] js/config.js holds a SECRET key. Refusing to use it. Put the publishable key there instead.');
} else {
  OBD.sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'obd-auth' },
    realtime: { params: { eventsPerSecond: 10 } }
  });
  OBD.configured = true;
}

/* Turn a Supabase/PostgREST/Auth error into a short code the UI can explain. */
OBD.errCode = function(e){
  if (!e) return 'unknown';
  if (e.code === 'anonymous_provider_disabled') return 'anon_disabled';
  if (/^over_.*rate_limit$/.test(e.code || '')) return 'rate_limited';
  if (e.code && /^[a-z_]+$/.test(e.code)) return e.code; // our own codes and Auth codes
  var m = String(e.message || '') + ' ' + String(e.hint || '') + ' ' + String(e.details || '');
  if (/team_full/.test(m)) return 'team_full';
  if (/not_signed_in|JWT|session/i.test(m)) return 'session_expired';
  if (e.code === '42501' || /row-level security|permission denied/i.test(m)) return 'forbidden';
  if (e.code === '23503') return 'needs_block';
  if (e.code === '23505') return 'duplicate';
  if (e.code === '23514' || e.code === '22023' || e.code === '22001') return 'invalid';
  if (e.status === 429 || /rate limit/i.test(m)) return 'rate_limited';
  if (/anonymous sign-ins are disabled/i.test(m)) return 'anon_disabled';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'offline';
  return 'unknown';
};
OBD.fail = function(e){
  var err = new Error((e && e.message) || 'Request failed');
  err.code = OBD.errCode(e); err.cause = e;
  return err;
};
})(window.OBD = window.OBD || {});
