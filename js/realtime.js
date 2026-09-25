/* Realtime: database change feeds + a live "room" for presence and sparks. */
(function(OBD){
'use strict';
var sb = OBD.sb;

// Which slice of page state each table feeds.
var TABLES = {
  profiles: 'builders', user_skills: 'builders', user_interests: 'builders',
  teams: 'teams', team_members: 'teams',
  wall_posts: 'wall',
  announcements: 'announcements'
};

OBD.realtime = {
  /* onChange(dataset, payload) is called for every insert/update/delete. */
  watch: function(onChange, onStatus){
    if (!sb) return null;
    var ch = sb.channel('db-changes');
    Object.keys(TABLES).forEach(function(table){
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: table }, function(payload){
        onChange(TABLES[table], payload);
      });
    });
    ch.subscribe(function(status){ if (onStatus) onStatus(status); });
    return ch;
  },

  /* A shared room: who's on the page right now, and sparks thrown at the pile. */
  room: function(){
    if (!sb) return null;
    var key = 'v-' + Math.random().toString(36).slice(2, 10);
    var peersCb = null, sparkCb = null, mine = { shape: 'circle', tone: 'cream' }, joined = false;
    var ch = sb.channel('room', { config: { presence: { key: key }, broadcast: { self: false } } });
    function peers(){
      var st = ch.presenceState(), out = [];
      Object.keys(st).forEach(function(k){ var p = st[k][0] || {}; out.push({ kind: 'viewer', key: k, presence: p }); });
      return out;
    }
    ch.on('presence', { event: 'sync' }, function(){ if (peersCb) peersCb({ peers: peers() }); });
    ch.on('broadcast', { event: 'spark' }, function(msg){ if (sparkCb) sparkCb({ data: msg.payload || {} }); });
    ch.subscribe(function(status){
      if (status === 'SUBSCRIBED'){ joined = true; ch.track(mine); }
    });
    return {
      presence: function(p){ mine = p || mine; return joined ? ch.track(mine) : Promise.resolve(); },
      onPeers: function(fn){ peersCb = fn; },
      on: function(evt, fn){ if (evt === 'spark') sparkCb = fn; },
      emit: function(evt, data){ return ch.send({ type: 'broadcast', event: evt, payload: data }); }
    };
  }
};
})(window.OBD = window.OBD || {});
