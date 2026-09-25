/* Opus Build Day, Bangalore: the pile.
   UI + physics (unchanged from the single-file page). Data now lives in
   Supabase; see js/builders.js, js/teams.js, js/wall.js, js/realtime.js. */
(function(OBD){
'use strict';

/* ---------- constants ---------- */
var EVENT_START = new Date('2026-09-26T09:00:00+05:30');
var EVENT_END = new Date('2026-09-26T21:00:00+05:30');
var SKILLS = ['Agents','LLM apps','Frontend','Backend','Design','Data & ML','Mobile','Hardware','Infra & DevOps','Product','Science & bio','Growth & content'];
var LOOKING = ['Teammates','A team to join','Friends to build with','Feedback on an idea','A mentor','A ride to the venue'];
var SHAPES = ['square','triangle','circle','arch'];
var TONES = ['cream','ink','clay'];
var KINDS = ['Question','Idea','Looking for','Logistics','Hot take'];
var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- tiny helpers ---------- */
function h(tag, props){
  var el = document.createElement(tag);
  if (props) for (var k in props){
    var v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0,2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function add(el, c){
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(function(x){ add(el, x); }); return; }
  el.append(c instanceof Node ? c : document.createTextNode(String(c)));
}
function $(id){ return document.getElementById(id); }
function str(v, n){ return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').slice(0, n) : ''; }
function arr(v){ return Array.isArray(v) ? v : []; }
function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){} }
function initials(name){
  var p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  var s = (p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length-1].charAt(0) : '');
  return s.toUpperCase();
}
function ago(ts){
  var d = (Date.now() - ts) / 1000;
  if (!ts || ts < 1e12 || d < 0) return '';
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d/60) + ' min ago';
  if (d < 86400) return Math.floor(d/3600) + ' h ago';
  return Math.floor(d/86400) + ' d ago';
}
function safeUrl(s){
  try { var u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; } catch(e){ return null; }
}

/* ---------- state ---------- */
function cleanBuilder(b){
  if (!b || typeof b !== 'object') return null;
  var o = {
    id: str(b.id, 40), name: str(b.name, 40).trim(), role: str(b.role, 80).trim(),
    building: str(b.building, 200).trim(),
    skills: arr(b.skills).map(function(s){ return str(s, 28).trim(); }).filter(Boolean).slice(0, 6),
    looking: arr(b.looking).map(function(s){ return str(s, 40).trim(); }).filter(Boolean).slice(0, 4),
    where: str(b.where, 100).trim(),
    shape: SHAPES.indexOf(b.shape) >= 0 ? b.shape : 'square',
    tone: TONES.indexOf(b.tone) >= 0 ? b.tone : 'cream',
    by: str(b.by, 80) || null, ts: +b.ts || 0
  };
  return (o.id && o.name) ? o : null;
}
function cleanTeam(t){
  if (!t || typeof t !== 'object') return null;
  var o = {
    id: str(t.id, 40), name: str(t.name, 50).trim(), idea: str(t.idea, 240).trim(),
    needs: arr(t.needs).map(function(s){ return str(s, 28); }).filter(Boolean).slice(0, 4),
    members: arr(t.members).map(function(s){ return str(s, 40); }).filter(Boolean).slice(0, 8),
    by: str(t.by, 80) || null, ts: +t.ts || 0
  };
  return (o.id && o.name) ? o : null;
}
function cleanPost(p){
  if (!p || typeof p !== 'object') return null;
  var o = {
    id: str(p.id, 40), kind: KINDS.indexOf(p.kind) >= 0 ? p.kind : 'Idea',
    text: str(p.text, 280).trim(), author: str(p.author, 40), name: str(p.name, 40).trim() || 'A curious builder',
    by: str(p.by, 80) || null, ts: +p.ts || 0
  };
  return (o.id && o.text) ? o : null;
}
function cleanState(raw){
  raw = raw || {};
  return {
    builders: arr(raw.builders).map(cleanBuilder).filter(Boolean),
    teams: arr(raw.teams).map(cleanTeam).filter(Boolean),
    wall: arr(raw.wall).map(cleanPost).filter(Boolean)
  };
}
var LIVE = !!OBD.configured;
var S = cleanState({});
if (!LIVE){ try { S = cleanState(JSON.parse($('state').textContent || '{}')); } catch(e){} }
var ANN = [];   // host announcements, newest first

/* ---------- capabilities ---------- */
var SAMPLE_STATE = (LIVE && OBD.collider.enabled()) ? 'ok' : 'none';
var ROOM = null, ME = null, IS_OWNER = false, READONLY = !LIVE, PEERS = [];

/* identity: a builder's id is their Supabase user id */
function allBuilders(){ return S.builders; }
function myBuilder(){ return ME ? (S.builders.find(function(b){ return b.id === ME; }) || null) : null; }
function isMine(rec){
  if (!rec || !ME) return false;
  return rec.by === ME || rec.id === ME || rec.author === ME;
}
function builderById(id){ return allBuilders().find(function(b){ return b.id === id; }); }

/* ---------- data (Supabase is the record) ---------- */
async function loadSlice(which){
  if (!LIVE) return;
  if (which === 'builders') S.builders = arr(await OBD.builders.load()).map(cleanBuilder).filter(Boolean);
  else if (which === 'teams') S.teams = arr(await OBD.teams.load()).map(cleanTeam).filter(Boolean);
  else if (which === 'wall') S.wall = arr(await OBD.wall.load()).map(cleanPost).filter(Boolean);
  else if (which === 'announcements'){ ANN = arr(await OBD.announcements.load()); annLoaded = true; }
}
async function reload(list){
  var r = await Promise.allSettled(list.map(loadSlice));
  afterData(list);
  var bad = r.filter(function(x){ return x.status === 'rejected'; });
  if (bad.length) console.error('[obd] load failed', bad.map(function(x){ return x.reason; }));
  return !bad.length;
}
function afterData(list){
  if (list.indexOf('builders') >= 0){ Pile.sync(); renderJoinButtons(); renderBuilders(); renderTeams(); renderWall(); renderCollider(); }
  else {
    if (list.indexOf('teams') >= 0) renderTeams();
    if (list.indexOf('wall') >= 0) renderWall();
  }
  if (list.indexOf('announcements') >= 0){ renderAnnouncements(); renderHost(); }
}
// Realtime changes arrive in bursts (a profile save touches three tables); batch them.
var dirty = {}, dirtyTimer = null;
function refresh(which){
  dirty[which] = true;
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(function(){ var list = Object.keys(dirty); dirty = {}; reload(list); }, 250);
}

/* Every write goes through here: one at a time, with a friendly toast either way. */
var busy = false;
async function run(fn, okMsg){
  if (READONLY){ toast('This copy of the page isn’t connected to the live pile yet, so changes can’t be saved.'); return false; }
  if (busy) return false;
  busy = true; toast('Saving…', 0);
  try {
    await fn();
    busy = false;
    if (okMsg) toast(okMsg); else hideToast();
    return true;
  } catch(e){
    busy = false;
    handleErr(e);
    return false;
  }
}
function handleErr(e){
  var c = e && e.code;
  if (c === 'need_login'){ hideToast(); openSignIn('Sign in with your email first. We’ll send you a link; tap it and you’re in.'); return; }
  if (c === 'cancelled') return;
  console.error('[obd]', e);
  toast({
    team_full: 'That team just filled up. Eight blocks max.',
    forbidden: 'You can only change your own things.',
    needs_block: 'Add your block first. Teams are made of blocks.',
    duplicate: 'That’s already there.',
    rate_limited: 'Too many changes in a row. Give it a minute, then try again.',
    over_email_send_rate_limit: 'Too many emails went out just now. Try again in a few minutes.',
    anon_disabled: 'Guest sign-in is switched off for this event. Ask the host.',
    session_expired: 'Your session expired. Refresh the page and try again.',
    offline: 'You look offline. Check your connection and try again.',
    invalid: 'Something in there is too long or not allowed. Shorten it and try again.',
    email_address_invalid: 'That email doesn’t look right.',
    otp_disabled: 'We couldn’t find a block with that email. Add your block first, then link your email.',
    not_configured: 'This copy of the page isn’t connected to the live pile yet.'
  }[c] || 'That didn’t save. Try again.');
}

/* ---------- toast ---------- */
var toastEl, toastTimer;
function toast(msg, ms){
  if (!toastEl) return;
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer);
  if (ms !== 0) toastTimer = setTimeout(hideToast, ms || 4200);
}
function hideToast(){ if (toastEl) toastEl.hidden = true; }

/* ---------- glyphs ---------- */
var SVGNS = 'http://www.w3.org/2000/svg';
var SHAPE_PATHS = {
  square: '<rect x="5" y="5" width="30" height="30" rx="2"/>',
  triangle: '<path d="M20 4 L37 35 L3 35 Z"/>',
  circle: '<circle cx="20" cy="20" r="16"/>',
  arch: '<path d="M4 36 V12 Q4 4 12 4 H28 Q36 4 36 12 V36 H27 V26 A7 7 0 0 0 13 26 V36 Z"/>'
};
function glyph(shape, tone, size){
  var s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 40 40'); s.setAttribute('width', size || 28); s.setAttribute('height', size || 28);
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'glyph t-' + (TONES.indexOf(tone) >= 0 ? tone : 'cream'));
  s.innerHTML = SHAPE_PATHS[shape] || SHAPE_PATHS.square;
  return s;
}
function doodle(d, w, hgt){
  var s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 ' + w + ' ' + hgt); s.setAttribute('width', w); s.setAttribute('height', hgt); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

/* ---------- the pile (physics) ---------- */
var Pile = (function(){
  var M = null, engine, canvas, ctx, host, W = 0, H = 0, dpr = 1, S_ = 48, gen = 0;
  var visible = true, drag = null, colors = {}, highlight = null, hlUntil = 0, sparks = [], started = false, pending = {};
  function readColors(){
    var cs = getComputedStyle(document.documentElement);
    function g(n){ return cs.getPropertyValue(n).trim(); }
    colors = { cream: g('--blk-cream'), ink: g('--blk-ink'), clay: g('--blk-clay'), line: g('--blk-line'), hill: g('--hill'), fg: g('--fg') };
    colors.label = { cream: colors.ink === '#0E0A08' ? '#1B1511' : colors.ink, ink: colors.cream, clay: colors.cream };
  }
  function sig(b){ return b.shape + '|' + b.tone + '|' + initials(b.name); }
  function blockItem(b){ return { shape: b.shape, tone: b.tone, label: initials(b.name), bid: b.id, sig: sig(b), local: !!b.local }; }
  function items(){
    var list = allBuilders().slice(-60).map(function(b){
      return blockItem(b);
    });
    if (highlight){
      var i = list.findIndex(function(x){ return x.bid === highlight; });
      if (i >= 0) list.push(list.splice(i, 1)[0]);
    }
    var fill = Math.max(0, 16 - list.length);
    var fillers = [];
    for (var k = 0; k < fill; k++) fillers.push({ shape: SHAPES[k % 4], tone: TONES[(k * 5) % 3], label: '', filler: true, doodle: k % 3 });
    return fillers.concat(list);
  }
  function size(n){ return Math.max(24, Math.min(64, Math.sqrt((W * H * 0.26) / Math.max(n, 1)))); }
  function makeBody(it, x, y, s){
    var opts = { restitution: 0.12, friction: 0.7, frictionAir: 0.012, density: 0.002, angle: Math.random() * 6.28 };
    var b;
    if (it.shape === 'circle') b = M.Bodies.circle(x, y, s * 0.52, opts);
    else if (it.shape === 'triangle') b = M.Bodies.polygon(x, y, 3, s * 0.68, opts);
    else if (it.shape === 'arch') b = M.Bodies.rectangle(x, y, s * 1.25, s * 0.95, opts);
    else b = M.Bodies.rectangle(x, y, s, s, Object.assign({ chamfer: { radius: 3 } }, opts));
    b.plugin = { it: it, s: s, w: it.shape === 'arch' ? s * 1.25 : s, h: it.shape === 'arch' ? s * 0.95 : s };
    return b;
  }
  function statics(){
    var R = Math.max(W * 0.95, 520), hillH = Math.min(110, H * 0.24);
    var hill = M.Bodies.circle(W / 2, H + R - hillH, R, { isStatic: true, friction: 0.9 });
    hill.plugin = { hill: true, R: R };
    return [
      hill,
      M.Bodies.rectangle(W / 2, H + 30, W * 3, 60, { isStatic: true, friction: 0.9 }),
      M.Bodies.rectangle(-30, H / 2 - H, 60, H * 4, { isStatic: true }),
      M.Bodies.rectangle(W + 30, H / 2 - H, 60, H * 4, { isStatic: true })
    ];
  }
  function blocks(){ return M.Composite.allBodies(engine.world).filter(function(b){ return !b.isStatic; }); }
  function spawnX(){ return W / 2 + (Math.random() - 0.5) * W * 0.78; }
  function build(animate){
    gen++; var my = gen; pending = {};
    M.Composite.clear(engine.world, false);
    M.Composite.add(engine.world, statics());
    sparks = [];
    var list = items(); S_ = size(list.length);
    if (animate && !reduced){
      var step = Math.min(110, 2400 / list.length);
      list.forEach(function(it, i){
        if (it.bid) pending[it.bid] = true;
        setTimeout(function(){
          if (my !== gen) return;
          if (it.bid){ if (!pending[it.bid]) return; delete pending[it.bid]; }
          var last = i === list.length - 1 && highlight;
          M.Composite.add(engine.world, makeBody(it, last ? W / 2 : spawnX(), -S_ * 1.5, S_));
        }, 250 + i * step + (i === list.length - 1 && highlight ? 700 : 0));
      });
    } else {
      list.forEach(function(it, i){ M.Composite.add(engine.world, makeBody(it, spawnX(), -S_ - i * S_ * 0.7, S_)); });
      for (var k = 0; k < 520; k++) M.Engine.update(engine, 1000 / 60);
    }
  }
  function resize(){
    var r = host.getBoundingClientRect();
    var nw = Math.round(r.width), nh = Math.round(r.height);
    var changed = Math.abs(nw - W) > 30 || Math.abs(nh - H) > 50;
    W = nw; H = nh; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    return changed;
  }
  function pathFor(b){
    var p = b.plugin, it = p.it;
    ctx.beginPath();
    if (it.shape === 'circle'){ ctx.arc(b.position.x, b.position.y, b.circleRadius, 0, Math.PI * 2); return; }
    if (it.shape === 'arch'){
      ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
      var w = p.w / 2, hh = p.h / 2, r = p.w * 0.2;
      ctx.moveTo(-w, hh); ctx.lineTo(-w, -hh + 5); ctx.quadraticCurveTo(-w, -hh, -w + 5, -hh);
      ctx.lineTo(w - 5, -hh); ctx.quadraticCurveTo(w, -hh, w, -hh + 5); ctx.lineTo(w, hh);
      ctx.lineTo(r, hh); ctx.arc(0, hh, r, 0, Math.PI, true); ctx.closePath();
      ctx.restore(); return;
    }
    var v = b.vertices; ctx.moveTo(v[0].x, v[0].y);
    for (var i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
  }
  function draw(){
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var all = M.Composite.allBodies(engine.world);
    for (var i = 0; i < all.length; i++){
      var b = all[i];
      if (b.plugin && b.plugin.hill){
        ctx.beginPath(); ctx.arc(b.position.x, b.position.y, b.plugin.R, 0, Math.PI * 2);
        ctx.fillStyle = colors.hill; ctx.fill();
        ctx.fillRect(0, H - 2, W, 2);
      }
    }
    var now = performance.now();
    for (var j = 0; j < all.length; j++){
      var bb = all[j]; if (bb.isStatic || !bb.plugin || !bb.plugin.it) continue;
      var it = bb.plugin.it, s = bb.plugin.s;
      pathFor(bb);
      ctx.fillStyle = colors[it.tone] || colors.cream; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = colors.line; ctx.lineJoin = 'round';
      if (it.local) ctx.setLineDash([5, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.save(); ctx.translate(bb.position.x, bb.position.y); ctx.rotate(bb.angle);
      var lc = colors.label[it.tone] || colors.ink;
      if (it.label){
        ctx.fillStyle = lc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 ' + Math.round(s * (it.label.length > 1 ? 0.34 : 0.42)) + 'px Kalam, "Comic Sans MS", cursive';
        ctx.fillText(it.label, 0, it.shape === 'arch' ? -s * 0.12 : s * 0.04);
      } else if (!it.spark){
        ctx.strokeStyle = lc; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        var q = s * 0.18;
        ctx.beginPath();
        if (it.doodle === 0){ ctx.moveTo(-q, -q * 0.6); ctx.quadraticCurveTo(0, -q * 1.4, q, -q * 0.6); ctx.moveTo(-q, q * 0.4); ctx.quadraticCurveTo(0, -q * 0.4, q, q * 0.4); }
        else if (it.doodle === 1){ ctx.moveTo(-q, 0); ctx.lineTo(q, 0); ctx.moveTo(0, -q); ctx.lineTo(0, q); }
        else { ctx.moveTo(-q, q * 0.5); ctx.lineTo(-q * 0.3, -q * 0.6); ctx.lineTo(q * 0.3, q * 0.5); ctx.lineTo(q, -q * 0.6); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.restore();
      if (highlight && it.bid === highlight && now < hlUntil){
        ctx.save(); ctx.strokeStyle = colors.fg; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(bb.position.x, bb.position.y, s * 0.95, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = colors.fg; ctx.textAlign = 'center';
        ctx.font = '700 18px Kalam, "Comic Sans MS", cursive';
        ctx.fillText('you!', bb.position.x, bb.position.y - s * 1.15);
        ctx.restore();
      }
    }
  }
  function loop(){
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    M.Engine.update(engine, 1000 / 60);
    draw();
  }
  function pt(e){ var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function hitAt(p){
    var hits = M.Query.point(blocks(), p);
    return hits.length ? hits[hits.length - 1] : null;
  }
  function toss(b){
    M.Sleeping.set(b, false);
    M.Body.setVelocity(b, { x: (Math.random() - 0.5) * 7, y: -11 - Math.random() * 4 });
    M.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.45);
  }
  function wire(){
    canvas.addEventListener('pointerdown', function(e){
      var p = pt(e), hit = hitAt(p); if (!hit) return;
      drag = { body: hit, start: p, t: performance.now(), moved: false, id: e.pointerId, c: null };
      M.Sleeping.set(hit, false);
      if (e.pointerType === 'mouse'){
        drag.c = M.Constraint.create({ pointA: p, bodyB: hit, pointB: { x: p.x - hit.position.x, y: p.y - hit.position.y }, stiffness: 0.16, damping: 0.08, length: 0 });
        M.Composite.add(engine.world, drag.c);
        try { canvas.setPointerCapture(e.pointerId); } catch(err){}
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('pointermove', function(e){
      var p = pt(e);
      if (drag && drag.id === e.pointerId){
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 6) drag.moved = true;
        if (drag.c) drag.c.pointA = p;
      } else if (e.pointerType === 'mouse'){
        canvas.style.cursor = hitAt(p) ? 'grab' : '';
      }
    });
    function end(e){
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.c) M.Composite.remove(engine.world, drag.c);
      canvas.style.cursor = '';
      var d = drag; drag = null;
      if (e.type === 'pointerup' && !d.moved && performance.now() - d.t < 400){
        toss(d.body);
        var it = d.body.plugin.it;
        if (it.bid) setTimeout(function(){ openPerson(it.bid); }, reduced ? 0 : 420);
      }
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
  function init(el, hl){
    host = el; M = window.Matter || null; highlight = hl || null; hlUntil = performance.now() + 9000;
    canvas = h('canvas', { 'aria-hidden': 'true' }); host.append(canvas);
    ctx = canvas.getContext('2d');
    readColors(); resize();
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ readColors(); if (!M) staticDraw(); });
    new MutationObserver(function(){ readColors(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (!M){ staticDraw(); new ResizeObserver(function(){ resize(); staticDraw(); }).observe(host); return; }
    engine = M.Engine.create({ enableSleeping: true });
    engine.gravity.y = 1;
    wire();
    var go = function(){ if (started) return; started = true; build(true); loop(); };
    if ('IntersectionObserver' in window){
      new IntersectionObserver(function(en){ visible = en[0].isIntersecting; if (visible) go(); }, { threshold: 0.05 }).observe(host);
    } else go();
    var rt;
    new ResizeObserver(function(){
      clearTimeout(rt);
      rt = setTimeout(function(){ if (resize() && started) build(false); }, 180);
    }).observe(host);
  }
  function staticDraw(){
    // Fallback when the physics library can't load: a still pile.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var R = Math.max(W * 0.95, 520), hillH = Math.min(110, H * 0.24);
    ctx.beginPath(); ctx.arc(W / 2, H + R - hillH, R, 0, Math.PI * 2); ctx.fillStyle = colors.hill; ctx.fill();
    var list = items(), s = size(list.length) * 0.9, perRow = Math.max(1, Math.floor(W * 0.7 / (s * 1.1)));
    list.forEach(function(it, i){
      var row = Math.floor(i / perRow), col = i % perRow;
      var x = W * 0.15 + col * s * 1.1 + (row % 2) * s * 0.5 + s / 2, y = H - hillH - s / 2 - row * s * 1.02;
      ctx.save(); ctx.translate(x, y); ctx.rotate(((i * 37) % 21 - 10) / 60);
      ctx.beginPath();
      if (it.shape === 'circle') ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      else if (it.shape === 'triangle'){ ctx.moveTo(0, -s / 2); ctx.lineTo(s / 2, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath(); }
      else ctx.rect(-s / 2, -s / 2, s, s);
      ctx.fillStyle = colors[it.tone]; ctx.fill(); ctx.strokeStyle = colors.line; ctx.lineWidth = 2; ctx.stroke();
      if (it.label){ ctx.fillStyle = colors.label[it.tone]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + Math.round(s * 0.34) + 'px Kalam, cursive'; ctx.fillText(it.label, 0, 2); }
      ctx.restore();
    });
  }
  function spark(shape, tone){
    if (!M || !engine || !started) return;
    var it = { shape: shape, tone: tone, label: '', spark: true };
    var b = makeBody(it, spawnX(), -S_, S_ * 0.55);
    M.Body.setVelocity(b, { x: (Math.random() - 0.5) * 4, y: 2 });
    M.Composite.add(engine.world, b);
    sparks.push(b);
    if (sparks.length > 24) M.Composite.remove(engine.world, sparks.shift());
  }
  function bodyFor(bid){ return blocks().find(function(x){ return x.plugin && x.plugin.it && x.plugin.it.bid === bid; }); }
  // Bring the pile in line with the builder list: new people fall in,
  // removed people vanish, edited blocks are swapped for their new look.
  function sync(){
    if (!M || !engine || !started){ if (!M && ctx) staticDraw(); return; }
    var want = {};
    allBuilders().slice(-60).forEach(function(b){ want[b.id] = b; });
    var have = {};
    blocks().forEach(function(body){
      var it = body.plugin && body.plugin.it; if (!it || !it.bid) return;
      var b = want[it.bid];
      if (!b || it.sig !== sig(b) || have[it.bid]) M.Composite.remove(engine.world, body);
      else have[it.bid] = true;
    });
    Object.keys(pending).forEach(function(bid){ if (!want[bid]) delete pending[bid]; });
    Object.keys(want).forEach(function(bid){
      if (have[bid] || pending[bid]) return;
      M.Composite.add(engine.world, makeBody(blockItem(want[bid]), bid === highlight ? W / 2 : spawnX(), -S_ * 1.5, S_));
    });
  }
  // Drop (or re-drop) one builder's block from the top centre with a "you!" ring.
  function drop(b){
    if (!M || !engine || !started){ if (!M && ctx) staticDraw(); return; }
    highlight = b.id; hlUntil = performance.now() + 7000;
    delete pending[b.id];
    var old = bodyFor(b.id); if (old) M.Composite.remove(engine.world, old);
    M.Composite.add(engine.world, makeBody(blockItem(b), W / 2, -S_ * 1.5, S_));
  }
  return { init: init, spark: spark, drop: drop, sync: sync };
})();

/* ---------- countdown ---------- */
function countdownText(){
  var now = Date.now(), ms = EVENT_START - now;
  if (now >= EVENT_END) return 'That was the day. Keep building.';
  if (ms <= 0) return 'Happening right now.';
  var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hr = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d >= 1) return 'Starts in ' + d + (d === 1 ? ' day, ' : ' days, ') + hr + (hr === 1 ? ' hour' : ' hours');
  if (hr >= 1) return 'Starts in ' + hr + ' h ' + mm + ' min';
  return 'Starts in ' + Math.max(1, mm) + (mm === 1 ? ' minute' : ' minutes');
}

/* ---------- layout ---------- */
var FILTER = { skill: null, q: '' };
var COL = { a: null, b: null };
var el = {};

function renderShell(){
  var root = $('root');
  var navJoin = h('button', { class: 'btn primary', type: 'button', onclick: function(){ openJoin(); } });
  el.navJoin = navJoin;
  var nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, h('div', { class: 'nav-in' },
    h('a', { class: 'brand', href: '#top' }, 'Opus Build Day'),
    h('a', { class: 'lnk', href: '#builders' }, 'Builders'),
    h('a', { class: 'lnk', href: '#teams' }, 'Teams'),
    h('a', { class: 'lnk', href: '#collider' }, 'Collider'),
    h('a', { class: 'lnk', href: '#wall' }, 'Wall'),
    navJoin
  ));

  el.announce = h('div', { class: 'announce', role: 'status', 'aria-live': 'polite', hidden: true });

  el.countdown = h('span', { class: 'countdown' }, countdownText());
  el.here = h('p', { class: 'here', 'aria-live': 'polite' });
  var sparkBtn = h('button', { class: 'btn', type: 'button', onclick: throwSpark }, 'Throw a spark');
  el.heroJoin = h('button', { class: 'btn primary', type: 'button', onclick: function(){ openJoin(); } });
  var swing = h('p', { class: 'swing' }, 'Take the swing.');
  swing.append(doodle('M4 10 C 60 2, 140 3, 236 8', 240, 14));
  swing.lastChild.setAttribute('preserveAspectRatio', 'none');

  var n1 = h('p', { class: 'note n1' }, 'Build', h('br'), 'weird.', doodle('M2 8 L70 4', 74, 12));
  var n2 = h('p', { class: 'note n2' }, 'Ideas', h('br'), 'prototypes', h('br'), 'people', h('br'), 'possibilities');
  var n3 = h('p', { class: 'note n3' }, 'Curiosity', h('br'), 'in progress', doodle('M2 6 C 30 12, 60 0, 96 6', 100, 14));

  var pileHost = h('div', { class: 'pile', id: 'pile' },
    h('p', { class: 'pile-hint' }, 'Every block is a builder. Grab one, fling it, tap to meet them.'),
    h('p', { class: 'sr' }, 'A playful pile of blocks, one for each attendee. The same people are listed in the Builders section below.')
  );
  var hero = h('header', { class: 'hero', id: 'top' },
    h('div', { class: 'hero-text' },
      h('p', { class: 'community' }, 'Claude Community'),
      h('h1', { class: 'city' }, 'Bangalore'),
      h('p', { class: 'event' }, 'Opus Build Day'),
      h('p', { class: 'when' }, '26th September, 9 AM', el.countdown),
      swing,
      h('div', { class: 'cta-row' }, el.heroJoin, sparkBtn),
      el.here
    ),
    n1, n2, n3,
    pileHost
  );

  // builders
  el.bSearch = h('input', { type: 'search', placeholder: 'Search names, skills, ideas', 'aria-label': 'Search builders', oninput: function(e){ FILTER.q = e.target.value.toLowerCase(); renderBuilders(); } });
  el.bChips = h('div', { style: 'display:contents' });
  el.bNotice = h('div');
  el.bGrid = h('div');
  var builders = h('section', { class: 'band on-hill', id: 'builders', 'aria-labelledby': 'h-builders' }, h('div', { class: 'wrap' },
    h('div', { class: 'head' },
      h('div', {}, h('h2', { id: 'h-builders' }, 'Who\u2019s on the pile'),
        h('p', { class: 'lede' }, 'Find the people you want to spend Saturday with. Everyone here wrote their own card.')),
      h('p', { class: 'aside' }, 'Tap anyone\u2019s block up top to meet them.')
    ),
    el.bNotice,
    h('div', { class: 'filters' }, el.bChips, el.bSearch),
    el.bGrid
  ));

  // teams
  el.tGrid = h('div');
  var teams = h('section', { class: 'band', id: 'teams', 'aria-labelledby': 'h-teams' }, h('div', { class: 'wrap' },
    h('div', { class: 'head' },
      h('div', {}, h('h2', { id: 'h-teams' }, 'Teams forming'),
        h('p', { class: 'lede' }, 'Start a team around an idea, or jump into one that needs what you bring. Up to eight blocks per team.')),
      h('button', { class: 'btn primary', type: 'button', onclick: openTeam }, 'Start a team')
    ),
    el.tGrid
  ));

  // collider
  el.col = h('div');
  var collider = h('section', { class: 'band cream', id: 'collider', 'aria-labelledby': 'h-collider' }, h('div', { class: 'wrap' },
    h('div', { class: 'head' },
      h('div', {}, h('h2', { id: 'h-collider' }, 'The collider'),
        h('p', { class: 'lede' }, 'Smash two builders together and Claude invents the weird thing only they could make in a day. Or ask it who you should meet.')),
      h('p', { class: 'aside' }, 'Powered by Claude.')
    ),
    el.col
  ));

  // wall
  el.wComposer = h('div');
  el.wPosts = h('div');
  var wall = h('section', { class: 'band', id: 'wall', 'aria-labelledby': 'h-wall' }, h('div', { class: 'wrap' },
    h('div', { class: 'head' },
      h('div', {}, h('h2', { id: 'h-wall' }, 'The wall'),
        h('p', { class: 'lede' }, 'Questions, half-ideas, hot takes, who\u2019s coming from where. Say it before Saturday.'))
    ),
    el.wComposer,
    el.wPosts
  ));

  el.host = h('section', { class: 'band cream host', id: 'host', hidden: true, 'aria-labelledby': 'h-host' });

  var foot = h('footer', {}, h('div', { class: 'wrap' },
    h('p', { class: 'big' }, 'Build weird. See you on the 26th.'),
    h('p', {}, 'Claude Community Bangalore. Supported by knowShubhangi, anakin, and The Residency, Bangalore chapter.')
  ));

  el.dialog = h('dialog', { 'aria-labelledby': 'dlg-title' });
  el.dialog.addEventListener('close', function(){ if (!el.dialog.open) el.dialog.replaceChildren(); });
  el.dialog.addEventListener('click', function(e){ if (e.target === el.dialog) closeDialog(); });
  toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });

  root.append(nav, el.announce, hero, builders, teams, collider, wall, el.host, foot, el.dialog, toastEl);
  setInterval(function(){ el.countdown.textContent = countdownText(); }, 30000);
  return pileHost;
}

function renderAll(){ renderAnnouncements(); renderJoinButtons(); renderBuilders(); renderTeams(); renderCollider(); renderWall(); renderHost(); }

var lastAnn = null, annLoaded = false;
function renderAnnouncements(){
  var live = ANN.filter(function(a){ return a.active; });
  // A fresh announcement also pops up as a toast for people scrolled down the page.
  var top = live.length ? live[0].id : 0;
  if (annLoaded){
    if (lastAnn !== null && top > lastAnn && !IS_OWNER) toast(live[0].message, 8000);
    if (lastAnn === null || top > lastAnn) lastAnn = top;
  }
  el.announce.hidden = !live.length;
  el.announce.replaceChildren(h('div', { class: 'wrap' }, live.slice(0, 3).map(function(a){ return h('p', {}, a.message); })));
}

function renderJoinButtons(){
  var m = myBuilder();
  el.navJoin.textContent = m ? 'Edit my block' : 'Add my block';
  el.heroJoin.textContent = m ? 'Edit my block' : 'Throw your block in';
}

/* builders */
function builderCard(b, opts){
  opts = opts || {};
  var mine = isMine(b);
  var actions = h('div', { class: 'row' });
  if (SAMPLE_STATE !== 'none') actions.append(h('button', { class: 'btn small', type: 'button', onclick: function(){ collideWith(b.id); } }, mine ? 'Collide me with someone' : 'Collide'));
  if (mine) actions.append(h('button', { class: 'btn small quiet', type: 'button', onclick: function(){ openJoin(); } }, 'Edit'));
  if ((mine || IS_OWNER) && !READONLY) actions.append(removeBtn(function(){
    run(async function(){ await OBD.builders.remove(b.id); await reload(['builders', 'teams']); }, 'Block removed.');
  }));
  var link = b.where ? (safeUrl(b.where) ? h('a', { href: safeUrl(b.where), target: '_blank', rel: 'noopener noreferrer' }, b.where) : b.where) : null;
  return h('article', { class: 'bcard' + (b.local ? ' local' : '') },
    h('div', { class: 'bname' }, glyph(b.shape, b.tone, 34), h('h3', {}, b.name)),
    b.role ? h('p', { class: 'role' }, b.role) : null,
    b.building ? h('p', { class: 'wants' }, h('b', {}, 'Wants to build: '), b.building) : null,
    b.skills.length ? h('div', {}, b.skills.map(function(s){ return h('span', { class: 'chip' }, s); })) : null,
    b.looking.length ? h('p', { class: 'wants' }, h('b', {}, 'Looking for: '), b.looking.join(', ').toLowerCase()) : null,
    link ? h('p', { class: 'where' }, 'Find them: ', link) : null,
    opts.noActions ? null : actions
  );
}
function removeBtn(fn){
  var armed = false, t;
  var btn = h('button', { class: 'btn small quiet', type: 'button' }, 'Remove');
  btn.addEventListener('click', function(){
    if (!armed){ armed = true; btn.textContent = 'Tap again to remove'; t = setTimeout(function(){ armed = false; btn.textContent = 'Remove'; }, 3500); return; }
    clearTimeout(t); fn();
  });
  return btn;
}
function renderBuilders(){
  var list = allBuilders().slice().reverse();
  var counts = {};
  list.forEach(function(b){ b.skills.forEach(function(s){ counts[s] = (counts[s] || 0) + 1; }); });
  var skills = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a]; }).slice(0, 12);
  function chip(label, val){
    return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(FILTER.skill === val), onclick: function(){ FILTER.skill = val; renderBuilders(); } }, h('span', {}, label));
  }
  el.bChips.replaceChildren.apply(el.bChips, [chip('Everyone (' + list.length + ')', null)].concat(skills.map(function(s){ return chip(s + ' (' + counts[s] + ')', s); })));
  el.bNotice.replaceChildren();
  if (READONLY) el.bNotice.append(h('p', { class: 'notice' }, 'This copy of the page isn\u2019t connected to the live pile yet, so you\u2019re looking at a preview. Blocks, teams, and notes can\u2019t be saved here.'));
  var shown = list.filter(function(b){
    if (FILTER.skill && b.skills.indexOf(FILTER.skill) < 0) return false;
    if (FILTER.q){ var hay = [b.name, b.role, b.building, b.skills.join(' '), b.looking.join(' ')].join(' ').toLowerCase(); if (hay.indexOf(FILTER.q) < 0) return false; }
    return true;
  });
  if (!list.length){
    el.bGrid.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'The pile is empty. First block gets the best spot.'), h('button', { class: 'btn primary', type: 'button', onclick: function(){ openJoin(); } }, 'Throw your block in')));
  } else if (!shown.length){
    el.bGrid.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Nobody matches that yet. Maybe that\u2019s your niche.'), h('button', { class: 'btn', type: 'button', onclick: function(){ FILTER = { skill: null, q: '' }; el.bSearch.value = ''; renderBuilders(); } }, 'Show everyone')));
  } else {
    el.bGrid.replaceChildren(h('div', { class: 'grid' }, shown.map(function(b){ return builderCard(b); })));
  }
}

/* teams */
function renderTeams(){
  var list = S.teams.slice().reverse();
  var me = myBuilder();
  if (!list.length){
    el.tGrid.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'No teams yet. Got an idea brewing? Plant a flag.'), h('button', { class: 'btn primary', type: 'button', onclick: openTeam }, 'Start a team')));
    return;
  }
  el.tGrid.replaceChildren(h('div', { class: 'tgrid' }, list.map(function(t){
    var inTeam = me && t.members.indexOf(me.id) >= 0;
    var full = t.members.length >= 8;
    var members = t.members.map(builderById).filter(Boolean);
    var act = h('div', { class: 'row' });
    if (inTeam) act.append(h('button', { class: 'btn small', type: 'button', onclick: function(){ joinTeam(t, true); } }, 'Leave team'));
    else act.append(h('button', { class: 'btn small', type: 'button', disabled: full, onclick: function(){ joinTeam(t, false); } }, full ? 'Team is full' : 'Join this team'));
    if ((IS_OWNER || isMine(t)) && !READONLY) act.append(removeBtn(function(){
      run(async function(){ await OBD.teams.remove(t.id); await reload(['teams']); }, 'Team removed.');
    }));
    return h('article', { class: 'tcard' },
      h('h3', {}, t.name),
      t.idea ? h('p', {}, t.idea) : null,
      t.needs.length ? h('p', {}, h('span', { class: 'hand' }, 'Needs: '), t.needs.join(', ').toLowerCase()) : null,
      h('div', { class: 'members' }, members.length ? members.map(function(b){ return h('span', {}, glyph(b.shape, b.tone, 18), b.name); }) : h('span', {}, 'No one yet')),
      act
    );
  })));
}
function joinTeam(t, leave){
  var me = myBuilder();
  if (!me){ toast('Add your block first. Teams are made of blocks.'); openJoin(); return; }
  run(async function(){
    if (leave) await OBD.teams.leave(t.id); else await OBD.teams.join(t.id);
    await reload(['teams']);
  }, leave ? 'You left ' + t.name + '.' : 'You\u2019re on ' + t.name + '.');
}

/* collider */
var colCtl = null;
function renderCollider(){
  var list = allBuilders();
  var me = myBuilder();
  el.col.replaceChildren();
  if (SAMPLE_STATE === 'none'){
    el.col.append(h('p', { class: 'notice' }, 'The collider needs Claude, which isn\u2019t switched on for this page yet. Everything else on the pile works as usual.'));
  }
  if (list.length < 2){
    el.col.append(h('div', { class: 'empty' }, h('p', {}, 'Collisions need at least two blocks on the pile.'), me ? null : h('button', { class: 'btn primary', type: 'button', onclick: function(){ openJoin(); } }, 'Add my block')));
    return;
  }
  if (!builderById(COL.a)) COL.a = me ? me.id : list[list.length - 1].id;
  if (!builderById(COL.b) || COL.b === COL.a) COL.b = (list.find(function(b){ return b.id !== COL.a; }) || {}).id;
  function sel(key, label){
    var s = h('select', { id: 'col-' + key, onchange: function(e){ COL[key] = e.target.value; } },
      list.map(function(b){ var o = h('option', { value: b.id }, b.name + (me && b.id === me.id ? ' (you)' : '')); if (b.id === COL[key]) o.selected = true; return o; }));
    return h('div', {}, h('label', { class: 'f', for: 'col-' + key }, label), s);
  }
  var off = SAMPLE_STATE === 'none';
  el.colBtn = h('button', { class: 'btn primary', type: 'button', disabled: off, onclick: function(){ runCollide(); } }, 'Collide');
  var surprise = h('button', { class: 'btn', type: 'button', disabled: off, onclick: function(){
    var a = pick(list), b = pick(list.filter(function(x){ return x.id !== a.id; }));
    COL.a = a.id; COL.b = b.id; renderCollider(); runCollide();
  } }, 'Surprise me');
  var find = me ? h('button', { class: 'btn', type: 'button', disabled: off, onclick: runFind }, 'Who should I meet?') : null;
  el.colOut = el.colOut || h('div', { 'aria-live': 'polite' });  // kept across live re-renders
  el.col.append(
    h('div', { class: 'collider' }, sel('a', 'Builder one'), h('span', { class: 'x', 'aria-hidden': 'true' }, '\u00d7'), sel('b', 'Builder two')),
    h('div', { class: 'col-actions' }, el.colBtn, surprise, find),
    el.colOut
  );
}
function collideWith(id){
  var me = myBuilder();
  var list = allBuilders();
  if (me && me.id !== id){ COL.a = me.id; COL.b = id; }
  else if (me && me.id === id){ COL.a = id; COL.b = (pick(list.filter(function(x){ return x.id !== id; })) || {}).id; }
  else { COL.a = id; COL.b = (pick(list.filter(function(x){ return x.id !== id; })) || {}).id; }
  closeDialog();
  renderCollider();
  $('collider').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  if (COL.b) setTimeout(runCollide, reduced ? 0 : 450);
}
function sampleErr(e){
  var c = e && e.code;
  if (['not_granted','not_configured','collider_off'].indexOf(c) >= 0){ SAMPLE_STATE = 'none'; setTimeout(renderCollider, 2500); return 'Claude isn\u2019t switched on for this page yet, so the collider is off.'; }
  if (c === 'need_login' || c === 'anon_disabled'){ openSignIn('Sign in with your email to use the collider.'); return ''; }
  if (c === 'not_found') return 'One of those blocks just left the pile. Pick someone else.';
  if (c === 'rate_limited') return 'Claude is busy for you right now. Try again in a minute.';
  if (c === 'session_expired') return 'Your session expired. Refresh the page, then try once more.';
  if (c === 'refused') return 'Claude passed on that one. Try a different pair.';
  if (c === 'invalid_json' || c === 'empty_completion') return 'The idea came back garbled. Try again.';
  if (c === 'cancelled') return '';
  return 'Couldn\u2019t reach Claude. Try again.';
}
function thinking(label){
  if (colCtl) colCtl.abort();
  colCtl = new AbortController();
  var ctl = colCtl;
  el.colOut.replaceChildren(h('div', { class: 'result' }, h('p', { class: 'thinking' }, label),
    h('button', { class: 'btn small quiet', type: 'button', onclick: function(){ ctl.abort(); } }, 'Stop')));
  return ctl;
}
async function runCollide(){
  var a = builderById(COL.a), b = builderById(COL.b);
  if (!a || !b || a.id === b.id){ toast('Pick two different builders.'); return; }
  if (SAMPLE_STATE === 'none'){ renderCollider(); return; }
  var ctl = thinking('Colliding ' + a.name + ' and ' + b.name + '\u2026');
  try {
    // The prompt is built server-side (supabase/functions/collider) from the database.
    var r = await OBD.collider.collide(a.id, b.id, ctl.signal);
    if (ctl !== colCtl) return;
    showCollision(a, b, r);
  } catch(e){
    if (ctl !== colCtl) return;
    var m = sampleErr(e);
    el.colOut.replaceChildren(m ? h('p', { class: 'notice' }, m) : '');
  }
}
function showCollision(a, b, r){
  r = r || {};
  var title = str(r.title, 80) || 'Untitled weirdness';
  var pitch = str(r.pitch, 400), why = str(r.whyYouTwo, 260);
  var steps = arr(r.firstHour).map(function(s){ return str(s, 160); }).filter(Boolean).slice(0, 4);
  var w = Math.max(1, Math.min(10, Math.round(+r.weirdness || 5)));
  var meter = h('span', { class: 'meter', 'aria-hidden': 'true' });
  for (var i = 1; i <= 10; i++) meter.append(h('i', { class: i <= w ? 'on' : '' }));
  el.colOut.replaceChildren(h('div', { class: 'result' },
    h('p', { class: 'hand' }, a.name + ' \u00d7 ' + b.name),
    h('h3', {}, title),
    h('p', {}, pitch),
    why ? h('p', {}, h('span', { class: 'hand' }, 'Why you two: '), why) : null,
    steps.length ? h('div', {}, h('p', { class: 'hand' }, 'Your first hour'), h('ol', {}, steps.map(function(s){ return h('li', {}, s); }))) : null,
    h('p', {}, 'Weirdness ' + w + ' out of 10', meter),
    h('div', { class: 'col-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: function(){ prefillWall('Idea', title + ': ' + pitch + ' (collider pick for ' + a.name + ' and ' + b.name + ')'); } }, 'Post it to the wall'),
      h('button', { class: 'btn', type: 'button', onclick: runCollide }, 'Collide again')
    )
  ));
}
async function runFind(){
  var me = myBuilder(); if (!me) return;
  if (SAMPLE_STATE === 'none'){ renderCollider(); return; }
  var others = allBuilders().filter(function(b){ return b.id !== me.id; });
  if (!others.length){ toast('You\u2019re the only block so far. Invite someone.'); return; }
  var ctl = thinking('Reading the pile for you\u2026');
  try {
    var r = await OBD.collider.find(ctl.signal);
    if (ctl !== colCtl) return;
    showFind(r || {});
  } catch(e){
    if (ctl !== colCtl) return;
    var m = sampleErr(e);
    el.colOut.replaceChildren(m ? h('p', { class: 'notice' }, m) : '');
  }
}
function showFind(r){
  var people = arr(r.people).map(function(p){ return { b: builderById(p && p.id), why: str(p && p.why, 200) }; }).filter(function(p){ return p.b; }).slice(0, 3);
  var team = r.team && S.teams.find(function(t){ return t.id === r.team.id; });
  var opener = str(r.opener, 300);
  var box = h('div', { class: 'result' }, h('h3', {}, 'Your people, probably'));
  if (!people.length && !team) box.append(h('p', {}, 'No strong matches yet. As more blocks land, ask again.'));
  people.forEach(function(p){
    box.append(h('div', { class: 'pick' }, glyph(p.b.shape, p.b.tone, 30),
      h('div', {}, h('button', { class: 'linkish', type: 'button', onclick: function(){ openPerson(p.b.id); } }, p.b.name), h('p', {}, p.why))));
  });
  if (team) box.append(h('div', { class: 'pick' }, h('span', { class: 'hand' }, 'Team'),
    h('div', {}, h('a', { href: '#teams' }, team.name), h('p', {}, str(r.team.why, 200)))));
  if (opener) box.append(h('p', {}, h('span', { class: 'hand' }, 'Say hi with: '), opener),
    h('button', { class: 'btn small', type: 'button', onclick: function(){ copyText(opener); } }, 'Copy message'));
  el.colOut.replaceChildren(box);
}

/* wall */
var wallKind = 'Question';
function renderWall(){
  var me = myBuilder();
  el.wText = el.wText || h('textarea', { id: 'w-text', maxlength: '280', placeholder: 'Anyone driving in from Whitefield? What are you building? Hot takes welcome.', oninput: function(){ el.wCount.textContent = el.wText.value.length + ' / 280'; } });
  el.wCount = el.wCount || h('span', { class: 'count' }, '0 / 280');
  var kinds = h('div', { class: 'kinds', role: 'group', 'aria-label': 'What kind of note' }, KINDS.map(function(k){
    return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(wallKind === k), onclick: function(){ wallKind = k; renderWall(); } }, h('span', {}, k));
  }));
  var post = h('button', { class: 'btn primary', type: 'button', onclick: function(){
    var text = el.wText.value.trim();
    if (!text){ el.wText.focus(); toast('Write something first.'); return; }
    run(async function(){ await OBD.wall.post(wallKind, text); await reload(['wall']); }, 'Posted to the wall.')
      .then(function(ok){ if (ok){ el.wText.value = ''; el.wCount.textContent = '0 / 280'; } });
  } }, 'Post');
  el.wComposer.replaceChildren(h('div', { class: 'composer' },
    kinds,
    h('label', { class: 'sr', for: 'w-text' }, 'Your note'),
    el.wText,
    h('div', { class: 'composer-row' }, post, el.wCount, h('span', { class: 'count' }, me ? 'Posting as ' + me.name : 'Posting as a curious builder. Add your block to post as you.'))
  ));
  var list = S.wall.slice().reverse();
  if (!list.length){ el.wPosts.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Blank wall. Ask the question everyone\u2019s wondering.'))); return; }
  el.wPosts.replaceChildren(h('div', { class: 'posts' }, list.map(function(p){
    var b = p.author ? builderById(p.author) : null;
    var meta = h('div', { class: 'meta' }, b ? glyph(b.shape, b.tone, 18) : null,
      b ? h('button', { class: 'linkish', type: 'button', onclick: function(){ openPerson(b.id); } }, b.name) : h('span', {}, p.name),
      h('span', {}, ago(p.ts)));
    if ((IS_OWNER || isMine(p)) && !READONLY) meta.append(removeBtn(function(){
      run(async function(){ await OBD.wall.remove(p.id); await reload(['wall']); }, 'Note removed.');
    }));
    return h('article', { class: 'post' }, h('p', { class: 'kind' }, p.kind), h('p', { class: 'txt' }, p.text), meta);
  })));
}
function prefillWall(kind, text){
  wallKind = kind; renderWall();
  el.wText.value = text.slice(0, 280); el.wCount.textContent = el.wText.value.length + ' / 280';
  $('wall').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  setTimeout(function(){ el.wText.focus({ preventScroll: true }); }, reduced ? 0 : 500);
}

/* host desk (hosts only: profiles.is_host = true, set in SQL) */
function renderHost(){
  if (!IS_OWNER || READONLY){ el.host.hidden = true; return; }
  el.host.hidden = false;
  el.annText = el.annText || h('textarea', { id: 'host-ann', maxlength: '280', placeholder: 'Lunch moved to 1:15 PM. Demos start at 6 PM.' });
  var publish = h('button', { class: 'btn primary', type: 'button', onclick: function(){
    var msg = el.annText.value.trim();
    if (!msg){ el.annText.focus(); toast('Write the announcement first.'); return; }
    run(async function(){ await OBD.announcements.publish(msg); await reload(['announcements']); }, 'Announced. Every open page shows it now.')
      .then(function(ok){ if (ok) el.annText.value = ''; });
  } }, 'Publish announcement');
  var list = ANN.map(function(a){
    return h('div', { class: 'ann-item' }, h('p', {}, a.message, a.active ? null : h('span', { class: 'count' }, ' (hidden)')),
      h('button', { class: 'btn small quiet', type: 'button', onclick: function(){
        run(async function(){ await OBD.announcements.setActive(a.id, !a.active); await reload(['announcements']); }, a.active ? 'Taken down.' : 'Showing again.');
      } }, a.active ? 'Take down' : 'Show again'));
  });
  el.host.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'head' }, h('div', {},
      h('h2', { id: 'h-host' }, 'Host desk'),
      h('p', { class: 'lede' }, 'Only hosts see this. Announcements appear at the top of every open page straight away. You can also remove any block, team, or note from its card.')
    )),
    h('label', { class: 'f', for: 'host-ann' }, 'New announcement'),
    el.annText, h('div', { class: 'col-actions' }, publish),
    list.length ? h('div', { class: 'ann-list' }, list) : null
  ));
}

/* ---------- dialogs ---------- */
function openDialog(title, body){
  el.dialog.replaceChildren(h('div', { class: 'dlg' },
    h('div', { class: 'dlg-top' }, h('h2', { id: 'dlg-title' }, title),
      h('button', { class: 'x-close', type: 'button', 'aria-label': 'Close', onclick: closeDialog }, '\u00d7')),
    body));
  if (!el.dialog.open){ try { el.dialog.showModal(); } catch(e){ el.dialog.setAttribute('open', ''); } }
}
function closeDialog(){ if (el.dialog && el.dialog.open) el.dialog.close(); }

function chipToggles(options, set, max, onMax){
  var wrap = h('div', { role: 'group' });
  function draw(){
    wrap.replaceChildren.apply(wrap, options.concat(Array.from(set).filter(function(s){ return options.indexOf(s) < 0; })).map(function(o){
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(set.has(o)), onclick: function(){
        if (set.has(o)) set.delete(o);
        else { if (set.size >= max){ onMax(); return; } set.add(o); }
        draw();
      } }, h('span', {}, o));
    }));
  }
  draw();
  wrap.redraw = draw;
  return wrap;
}

function openJoin(prefill){
  var mine = myBuilder();
  var d = prefill || mine || {};
  var editing = !!mine;
  var skills = new Set(d.skills || []), looking = new Set(d.looking || []);
  var err = h('p', { class: 'err', 'aria-live': 'polite' });
  var name = h('input', { type: 'text', id: 'j-name', maxlength: '40', required: true, autocomplete: 'name', value: d.name || '' });
  var role = h('input', { type: 'text', id: 'j-role', maxlength: '80', placeholder: 'Backend engineer at a fintech, weekend robot tinkerer', value: d.role || '' });
  var building = h('textarea', { id: 'j-build', maxlength: '200', placeholder: 'A voice agent that argues with my grocery list' });
  building.value = d.building || '';
  var where = h('input', { type: 'text', id: 'j-where', maxlength: '100', placeholder: 'https://linkedin.com/in/you or @you on X', value: d.where || '' });
  var skillBox = chipToggles(SKILLS, skills, 5, function(){ err.textContent = 'Pick up to 5 skills. Your best ones.'; });
  var custom = h('input', { type: 'text', maxlength: '28', placeholder: 'Something else? Add it', 'aria-label': 'Add your own skill' });
  function addCustom(){
    var v = custom.value.trim(); if (!v) return;
    if (skills.size >= 5){ err.textContent = 'Pick up to 5 skills. Your best ones.'; return; }
    skills.add(v); custom.value = ''; skillBox.redraw();
  }
  custom.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); addCustom(); } });
  var lookBox = chipToggles(LOOKING, looking, 3, function(){ err.textContent = 'Pick up to 3.'; });
  var shape = d.shape || pick(SHAPES), tone = d.tone || pick(TONES);
  function radios(name, opts, cur, render, onpick){
    return h('div', { class: 'shape-pick', role: 'radiogroup', 'aria-label': name }, opts.map(function(o){
      var id = name + '-' + o;
      var inp = h('input', { type: 'radio', name: name, id: id, value: o, checked: o === cur, onchange: function(){ onpick(o); } });
      return [inp, h('label', { for: id, title: o }, render(o), h('span', { class: 'sr' }, o))];
    }));
  }
  var shapeWrap = h('div'), toneWrap = h('div');
  function drawPickers(){
    shapeWrap.replaceChildren(radios('shape', SHAPES, shape, function(o){ return glyph(o, tone, 36); }, function(o){ shape = o; drawPickers(); focusPicked('shape-' + o); }));
    toneWrap.replaceChildren(radios('tone', TONES, tone, function(o){ return glyph(shape, o, 36); }, function(o){ tone = o; drawPickers(); focusPicked('tone-' + o); }));
  }
  function focusPicked(id){ var x = $(id); if (x) x.focus(); }
  drawPickers();
  // Email: required for magic-link mode, optional for guests (keeps the block across devices).
  var emailMode = OBD.auth.mode === 'email';
  var needEmail = LIVE && emailMode && !ME;
  var askEmail = LIVE && (needEmail || (!emailMode && !OBD.auth.email()));
  var email = askEmail ? h('input', { type: 'email', id: 'j-email', maxlength: '120', autocomplete: 'email', inputmode: 'email', placeholder: 'you@example.com', value: (prefill && prefill.email) || '' }) : null;
  var signIn = (LIVE && !editing) ? h('p', { class: 'count' }, 'Already on the pile from another device? ',
    h('button', { class: 'linkish', type: 'button', onclick: function(){ openSignIn(); } }, 'Sign in with email')) : null;
  var submitBtn = h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Update my block' : 'Throw my block in');
  var form = h('form', { novalidate: true },
    h('label', { class: 'f', for: 'j-name' }, 'Your name'), name,
    h('label', { class: 'f', for: 'j-role' }, 'What you do ', h('small', {}, '(optional)')), role,
    h('label', { class: 'f', for: 'j-build' }, 'What you want to build on Saturday ', h('small', {}, '(half-formed is fine)')), building,
    h('p', { class: 'f' }, 'What you bring ', h('small', {}, '(up to 5)')), skillBox,
    h('div', { class: 'custom-skill' }, custom, h('button', { class: 'btn small', type: 'button', onclick: addCustom }, 'Add')),
    h('p', { class: 'f' }, 'Looking for ', h('small', {}, '(up to 3)')), lookBox,
    h('label', { class: 'f', for: 'j-where' }, 'Where people can find you ', h('small', {}, '(optional)')), where,
    email ? h('label', { class: 'f', for: 'j-email' }, 'Your email ', h('small', {}, needEmail ? '(we\u2019ll send a sign-in link; never shown on the pile)' : '(optional, keeps your block if you switch devices; never shown)')) : null, email,
    h('p', { class: 'f' }, 'Pick your block'), shapeWrap,
    h('p', { class: 'f' }, 'And its color'), toneWrap,
    err,
    h('div', { class: 'dlg-actions' }, submitBtn),
    signIn
  );
  form.addEventListener('submit', function(e){
    e.preventDefault();
    if (!name.value.trim()){ err.textContent = 'Add your name so people know who to find.'; name.focus(); return; }
    var mail = email ? email.value.trim() : '';
    if (needEmail && !mail){ err.textContent = 'Add your email so we can send your sign-in link.'; email.focus(); return; }
    if (mail && !EMAIL_RE.test(mail)){ err.textContent = 'That email doesn\u2019t look right.'; email.focus(); return; }
    var card = cleanBuilder({ id: ME || 'pending', name: name.value, role: role.value, building: building.value, skills: Array.from(skills), looking: Array.from(looking), where: where.value, shape: shape, tone: tone, by: ME, ts: mine ? mine.ts : Date.now() });
    submitBtn.disabled = true;
    if (needEmail){
      // Magic-link mode: park the block, send the link, finish when they come back signed in.
      lsSet(PENDING_KEY, JSON.stringify(card));
      OBD.auth.sendMagicLink(mail, true).then(function(){ showCheckEmail(mail, 'Tap the link in it and your block drops onto the pile.'); },
        function(e2){ submitBtn.disabled = false; lsSet(PENDING_KEY, null); handleErr(e2); });
      return;
    }
    saveBlock(card, editing, mail).then(function(ok){ if (!ok) submitBtn.disabled = false; });
  });
  openDialog(editing ? 'Edit your block' : 'Throw your block in', form);
  setTimeout(function(){ name.focus(); }, 30);
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PENDING_KEY = 'obd-pending-block';

/* Save the signed-in person's block, then drop it onto the pile with a "you!" ring. */
async function saveBlock(card, editing, mail){
  var ok = await run(async function(){
    await OBD.builders.save(card);
    await reload(['builders']);
  }, editing ? 'Your block is updated.' : 'Your block is on the pile.');
  if (!ok) return false;
  closeDialog();
  var me = myBuilder(); if (me) Pile.drop(me);
  if (mail && OBD.auth.isGuest()){
    OBD.auth.linkEmail(mail).then(function(){
      setTimeout(function(){ toast('Check ' + mail + ' and confirm. After that you can sign in to your block from any device.', 7000); }, 2500);
    }, handleErr);
  }
  return true;
}
/* Magic-link mode: finish a block that was parked before the sign-in email. */
function finishPendingBlock(){
  if (!ME) return;
  var raw = lsGet(PENDING_KEY); if (!raw) return;
  lsSet(PENDING_KEY, null);
  var d = null; try { d = JSON.parse(raw); } catch(e){}
  if (!d) return;
  d.id = ME; d.by = ME;
  var card = cleanBuilder(d);
  if (card) saveBlock(card, !!myBuilder(), '');
}
function showCheckEmail(mail, what){
  openDialog('Check your email', h('div', {},
    h('p', {}, 'We sent a link to ', h('b', {}, mail), '. ' + what),
    h('p', { class: 'count' }, 'Open it on this device. No email after a minute? Check spam, then try again.'),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: closeDialog }, 'Got it'))
  ));
}
function openSignIn(reason){
  var err = h('p', { class: 'err', 'aria-live': 'polite' });
  var email = h('input', { type: 'email', id: 's-email', maxlength: '120', autocomplete: 'email', inputmode: 'email', placeholder: 'you@example.com' });
  var btn = h('button', { class: 'btn primary', type: 'submit' }, 'Email me a link');
  var form = h('form', { novalidate: true },
    h('p', {}, reason || 'Get back to your block. We\u2019ll email you a sign-in link.'),
    h('label', { class: 'f', for: 's-email' }, 'Your email'), email, err,
    h('div', { class: 'dlg-actions' }, btn)
  );
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var mail = email.value.trim();
    if (!EMAIL_RE.test(mail)){ err.textContent = 'That email doesn\u2019t look right.'; email.focus(); return; }
    btn.disabled = true;
    OBD.auth.sendMagicLink(mail, OBD.auth.mode === 'email').then(function(){ showCheckEmail(mail, 'Tap the link in it and you\u2019re back on your block.'); },
      function(e2){ btn.disabled = false; handleErr(e2); });
  });
  openDialog('Sign in', form);
  setTimeout(function(){ email.focus(); }, 30);
}

function openTeam(){
  var me = myBuilder();
  if (!me){ toast('Add your block first. Teams are made of blocks.'); openJoin(); return; }
  var needs = new Set();
  var err = h('p', { class: 'err', 'aria-live': 'polite' });
  var name = h('input', { type: 'text', id: 't-name', maxlength: '50', placeholder: 'The Midnight Chai Agents' });
  var idea = h('textarea', { id: 't-idea', maxlength: '240', placeholder: 'What you\u2019ll try to build, in a sentence or two.' });
  var needBox = chipToggles(SKILLS, needs, 4, function(){ err.textContent = 'Pick up to 4.'; });
  var form = h('form', { novalidate: true },
    h('label', { class: 'f', for: 't-name' }, 'Team name'), name,
    h('label', { class: 'f', for: 't-idea' }, 'The idea'), idea,
    h('p', { class: 'f' }, 'Who you need ', h('small', {}, '(up to 4)')), needBox,
    err,
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Start the team'))
  );
  form.addEventListener('submit', function(e){
    e.preventDefault();
    if (!name.value.trim()){ err.textContent = 'Give your team a name. Weird is good.'; name.focus(); return; }
    var t = cleanTeam({ id: 'new', name: name.value, idea: idea.value, needs: Array.from(needs) });
    run(async function(){ await OBD.teams.create(t); await reload(['teams']); }, 'Team started. Now go recruit.')
      .then(function(ok){ if (ok) closeDialog(); });
  });
  openDialog('Start a team', form);
  setTimeout(function(){ name.focus(); }, 30);
}

function openPerson(id){
  var b = builderById(id); if (!b) return;
  var teams = S.teams.filter(function(t){ return t.members.indexOf(b.id) >= 0; });
  var body = h('div', {},
    builderCard(b, { noActions: true }),
    teams.length ? h('p', { class: 'wants', style: 'margin-top:1rem' }, h('b', {}, 'On team: '), teams.map(function(t){ return t.name; }).join(', ')) : null,
    h('div', { class: 'dlg-actions' },
      SAMPLE_STATE !== 'none' ? h('button', { class: 'btn primary', type: 'button', onclick: function(){ collideWith(b.id); } }, isMine(b) ? 'Collide me with someone' : (myBuilder() ? 'Collide with my block' : 'Collide with someone')) : null,
      isMine(b) ? h('button', { class: 'btn', type: 'button', onclick: function(){ openJoin(); } }, 'Edit my block') : null
    )
  );
  openDialog(b.name, body);
}

function copyText(t, box){
  function fallback(){
    if (box){ box.focus(); box.select(); }
    var ok = false; try { ok = document.execCommand('copy'); } catch(e){}
    toast(ok ? 'Copied.' : 'Select the text and copy it yourself. Your browser blocked copying here.');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function(){ toast('Copied.'); }, fallback);
  else fallback();
}

/* ---------- live room ---------- */
var lastSpark = 0;
function throwSpark(){
  var now = Date.now(); if (now - lastSpark < 500) return; lastSpark = now;
  var me = myBuilder();
  var shape = me ? me.shape : pick(SHAPES), tone = pick(TONES);
  Pile.spark(shape, tone);
  if (ROOM) ROOM.emit('spark', { shape: shape, tone: tone }).catch(function(){});
}
function renderHere(){
  var n = PEERS.length;
  el.here.replaceChildren();
  if (n >= 2){
    var dots = h('span', { class: 'dots', 'aria-hidden': 'true' });
    PEERS.slice(0, 8).forEach(function(p){
      var pr = p.presence || {};
      dots.append(glyph(SHAPES.indexOf(pr.shape) >= 0 ? pr.shape : 'circle', TONES.indexOf(pr.tone) >= 0 ? pr.tone : 'cream', 18));
    });
    el.here.append(dots, n + ' people on this page right now. Throw a spark and it lands on their screens too.');
  }
}
function wireRoom(){
  var me = myBuilder();
  ROOM.presence({ shape: me ? me.shape : 'circle', tone: me ? me.tone : 'cream' }).catch(function(){});
  ROOM.onPeers(function(ch){ PEERS = ch.peers.filter(function(p){ return p.kind === 'viewer'; }); renderHere(); }, function(){});
  ROOM.on('spark', function(msg){
    if (msg.sameTab) return;
    var d = msg.data || {};
    Pile.spark(SHAPES.indexOf(d.shape) >= 0 ? d.shape : 'square', TONES.indexOf(d.tone) >= 0 ? d.tone : 'clay');
  }, function(){});
}

/* ---------- boot ---------- */
var pileHost = renderShell();
renderAll();

(async function boot(){
  if (!LIVE){ Pile.init(pileHost, null); return; }

  // Who is this? (restores a saved guest/email session, or a magic-link return)
  await OBD.auth.init();
  ME = OBD.auth.userId();

  // First paint of the real pile: wait for the data (briefly) so blocks fall in together.
  var first = reload(['builders', 'teams', 'wall', 'announcements']);
  await Promise.race([first, new Promise(function(r){ setTimeout(r, 4000); })]);
  Pile.init(pileHost, null);
  first.then(function(ok){ if (!ok) toast('Couldn\u2019t reach the live pile. Check your connection and refresh.', 0); });

  async function onIdentity(){
    ME = OBD.auth.userId();
    IS_OWNER = await OBD.auth.isHost();
    if (IS_OWNER) await loadSlice('announcements').catch(function(){}); // hosts also see hidden ones
    renderAll();
    if (ROOM){ var me = myBuilder(); ROOM.presence({ shape: me ? me.shape : 'circle', tone: me ? me.tone : 'cream' }).catch(function(){}); }
    finishPendingBlock();
  }
  OBD.auth.onChange(onIdentity);
  if (ME) onIdentity();

  // Live updates: someone joins -> their block drops into everyone's pile.
  var subscribedOnce = false;
  OBD.realtime.watch(function(which){ refresh(which); }, function(status){
    // After a dropped connection (phone asleep, flaky venue wifi) catch up on anything missed.
    if (status === 'SUBSCRIBED'){
      if (subscribedOnce) ['builders', 'teams', 'wall', 'announcements'].forEach(refresh);
      subscribedOnce = true;
    }
  });
  ROOM = OBD.realtime.room();
  if (ROOM) wireRoom();
})();
})(window.OBD = window.OBD || {});
