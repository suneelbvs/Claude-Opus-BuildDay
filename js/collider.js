/* The collider calls the `collider` Edge Function, which holds the Claude
   API key server-side and builds the prompt from the database. */
(function(OBD){
'use strict';
var sb = OBD.sb;

async function call(body, signal){
  if (!sb || !OBD.config.COLLIDER_ENABLED){ var e0 = new Error('off'); e0.code = 'not_granted'; throw e0; }
  await OBD.auth.ensureSession();
  var aborted = new Promise(function(_, reject){
    if (!signal) return;
    signal.addEventListener('abort', function(){ var e = new Error('cancelled'); e.code = 'cancelled'; reject(e); });
  });
  var r = await Promise.race([sb.functions.invoke('collider', { body: body, signal: signal, timeout: 60000 }), aborted]);
  if (r.error){
    var code = 'unknown';
    try { var j = await r.error.context.json(); code = (j && j.error) || code; } catch(e){}
    if (code === 'unknown' && signal && signal.aborted) code = 'cancelled';
    var err = new Error(code); err.code = code; throw err;
  }
  return r.data || {};
}

OBD.collider = {
  enabled: function(){ return !!(sb && OBD.config.COLLIDER_ENABLED); },
  /* Two builder ids in, one weird project idea out. */
  collide: function(a, b, signal){ return call({ mode: 'collide', a: a, b: b }, signal); },
  /* Matchmaking for the signed-in builder. */
  find: function(signal){ return call({ mode: 'find' }, signal); }
};
})(window.OBD = window.OBD || {});
