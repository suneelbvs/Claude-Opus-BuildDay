/* Host announcements ("Lunch moved to 1:15 PM"). Only hosts can write (RLS). */
(function(OBD){
'use strict';
var sb = OBD.sb;

OBD.announcements = {
  /* Active ones for everyone; hosts also get inactive ones back. Newest first. */
  load: async function(){
    var r = await sb.from('announcements')
      .select('id, message, active, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (r.error) throw OBD.fail(r.error);
    return r.data.map(function(a){ return { id: a.id, message: a.message, active: a.active, ts: Date.parse(a.created_at) || 0 }; });
  },

  publish: async function(message){
    var r = await sb.from('announcements').insert({ message: message });
    if (r.error) throw OBD.fail(r.error);
  },

  setActive: async function(id, active){
    var r = await sb.from('announcements').update({ active: active }).eq('id', id);
    if (r.error) throw OBD.fail(r.error);
  }
};
})(window.OBD = window.OBD || {});
