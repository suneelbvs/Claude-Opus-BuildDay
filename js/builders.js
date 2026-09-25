/* Builders = rows in `profiles` (+ user_skills, user_interests). */
(function(OBD){
'use strict';
var sb = OBD.sb;

function toBuilder(row){
  var skills = (row.user_skills || []).slice().sort(function(a, b){ return a.id - b.id; }).map(function(s){ return s.skill; });
  var looking = (row.user_interests || []).slice().sort(function(a, b){ return a.id - b.id; }).map(function(s){ return s.interest; });
  return {
    id: row.id, name: row.name, role: row.role || '', building: row.building || '',
    skills: skills, looking: looking, where: row.linkedin || '',
    shape: row.shape, tone: row.tone, by: row.id,
    ts: Date.parse(row.created_at) || 0
  };
}

OBD.builders = {
  /* Oldest first, matching the order the page expects. */
  load: async function(){
    var r = await sb.from('profiles')
      .select('id, name, role, building, linkedin, shape, tone, created_at, user_skills(id, skill), user_interests(id, interest)')
      .order('created_at', { ascending: true })
      .limit(1000);
    if (r.error) throw OBD.fail(r.error);
    return r.data.map(toBuilder);
  },

  /* Create or update the signed-in user's block. */
  save: async function(card){
    await OBD.auth.ensureSession();
    var r = await sb.rpc('save_profile', {
      p_name: card.name, p_role: card.role, p_building: card.building, p_linkedin: card.where,
      p_shape: card.shape, p_tone: card.tone, p_skills: card.skills, p_interests: card.looking
    });
    if (r.error) throw OBD.fail(r.error);
    return OBD.auth.userId();
  },

  /* Own block, or anyone's if you're a host (RLS decides). */
  remove: async function(id){
    var r = await sb.from('profiles').delete().eq('id', id).select('id');
    if (r.error) throw OBD.fail(r.error);
    if (!r.data.length){ var e = new Error('Not allowed'); e.code = 'forbidden'; throw e; }
  }
};
})(window.OBD = window.OBD || {});
