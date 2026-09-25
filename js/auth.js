/* Authentication: guest (anonymous) sessions plus optional magic-link email. */
(function(OBD){
'use strict';
var sb = OBD.sb;
var current = null;          // Supabase user or null
var listeners = [];
var ready = null;

function redirectUrl(){ return location.origin + location.pathname; }
function set(user){
  var prev = current && current.id;
  current = user || null;
  if ((current && current.id) !== prev) listeners.forEach(function(fn){ try { fn(current); } catch(e){ console.error(e); } });
}

OBD.auth = {
  mode: (OBD.config.AUTH_MODE === 'email') ? 'email' : 'anonymous',

  /* Resolve the stored session (and any magic-link tokens in the URL). */
  init: function(){
    if (!sb) return Promise.resolve(null);
    if (ready) return ready;
    ready = sb.auth.getSession().then(function(r){
      set(r.data && r.data.session ? r.data.session.user : null);
      sb.auth.onAuthStateChange(function(_evt, session){ set(session ? session.user : null); });
      // Tidy a magic-link fragment out of the address bar.
      if (/access_token=|error_description=/.test(location.hash)){
        try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
      }
      return current;
    }, function(){ return null; });
    return ready;
  },

  user: function(){ return current; },
  userId: function(){ return current ? current.id : null; },
  isGuest: function(){ return !!(current && current.is_anonymous); },
  email: function(){ return current && !current.is_anonymous ? (current.email || current.new_email || '') : ''; },
  onChange: function(fn){ listeners.push(fn); },

  /* Make sure there is a session before a write. In anonymous mode a guest
     account is created on the spot; in email mode the caller must ask the
     person to sign in (error code 'need_login'). */
  ensureSession: async function(){
    if (!sb){ var e0 = new Error('Backend not configured'); e0.code = 'not_configured'; throw e0; }
    await OBD.auth.init();
    if (current) return current;
    if (OBD.auth.mode !== 'anonymous'){ var e1 = new Error('Sign in first'); e1.code = 'need_login'; throw e1; }
    var r = await sb.auth.signInAnonymously();
    if (r.error) throw OBD.fail(r.error);
    set(r.data.user);
    return current;
  },

  /* Attach an email to a guest account so the block survives a new device.
     Supabase sends a confirmation link; the account id stays the same. */
  linkEmail: async function(email){
    var r = await sb.auth.updateUser({ email: email }, { emailRedirectTo: redirectUrl() });
    if (r.error) throw OBD.fail(r.error);
    return true;
  },

  /* Send a magic sign-in link. */
  sendMagicLink: async function(email, allowCreate){
    var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: !!allowCreate } });
    if (r.error) throw OBD.fail(r.error);
    return true;
  },

  signOut: async function(){
    if (!sb) return;
    await sb.auth.signOut();
    set(null);
  },

  /* Host flag lives in the database; the browser can read but never set it. */
  isHost: async function(){
    if (!sb || !current) return false;
    var r = await sb.rpc('is_host');
    return !r.error && r.data === true;
  }
};
})(window.OBD = window.OBD || {});
