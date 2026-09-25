/* Teams = rows in `teams` + `team_members`. */
(function(OBD){
'use strict';
var sb = OBD.sb;

function toTeam(row){
  var members = (row.team_members || []).slice().sort(function(a, b){ return Date.parse(a.joined_at) - Date.parse(b.joined_at); }).map(function(m){ return m.user_id; });
  return {
    id: row.id, name: row.name, idea: row.idea || '', needs: row.needs || [],
    members: members, by: row.owner_id, ts: Date.parse(row.created_at) || 0
  };
}

OBD.teams = {
  load: async function(){
    var r = await sb.from('teams')
      .select('id, name, idea, needs, owner_id, created_at, team_members(user_id, joined_at)')
      .order('created_at', { ascending: true })
      .limit(500);
    if (r.error) throw OBD.fail(r.error);
    return r.data.map(toTeam);
  },

  /* Starts the team and adds the creator as its first member. */
  create: async function(t){
    await OBD.auth.ensureSession();
    var r = await sb.rpc('create_team', { p_name: t.name, p_idea: t.idea, p_needs: t.needs });
    if (r.error) throw OBD.fail(r.error);
    return r.data;
  },

  join: async function(teamId){
    var u = await OBD.auth.ensureSession();
    var r = await sb.from('team_members').insert({ team_id: teamId, user_id: u.id });
    if (r.error && r.error.code !== '23505') throw OBD.fail(r.error); // already a member is fine
  },

  leave: async function(teamId){
    var u = await OBD.auth.ensureSession();
    var r = await sb.from('team_members').delete().eq('team_id', teamId).eq('user_id', u.id);
    if (r.error) throw OBD.fail(r.error);
  },

  remove: async function(id){
    var r = await sb.from('teams').delete().eq('id', id).select('id');
    if (r.error) throw OBD.fail(r.error);
    if (!r.data.length){ var e = new Error('Not allowed'); e.code = 'forbidden'; throw e; }
  }
};
})(window.OBD = window.OBD || {});
