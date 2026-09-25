/* The wall = rows in `wall_posts`. */
(function(OBD){
'use strict';
var sb = OBD.sb;

function toPost(row){
  return { id: row.id, kind: row.kind, text: row.message, author: row.user_id, name: '', by: row.user_id, ts: Date.parse(row.created_at) || 0 };
}

OBD.wall = {
  /* The latest 300 notes, oldest first. */
  load: async function(){
    var r = await sb.from('wall_posts')
      .select('id, user_id, kind, message, created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (r.error) throw OBD.fail(r.error);
    return r.data.reverse().map(toPost);
  },

  post: async function(kind, message){
    await OBD.auth.ensureSession();
    var r = await sb.from('wall_posts').insert({ kind: kind, message: message }).select('id, user_id, kind, message, created_at').single();
    if (r.error) throw OBD.fail(r.error);
    return toPost(r.data);
  },

  remove: async function(id){
    var r = await sb.from('wall_posts').delete().eq('id', id).select('id');
    if (r.error) throw OBD.fail(r.error);
    if (!r.data.length){ var e = new Error('Not allowed'); e.code = 'forbidden'; throw e; }
  }
};
})(window.OBD = window.OBD || {});
