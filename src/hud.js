// DOM heads-up display and menus. Drawn at native resolution above the 3D canvas, untouched by post-processing.
// The look is all in index.html (#hud); this sets text, classes and a few CSS variables, each only when it changes.
import { Raycaster, Vector3 } from 'three';
import { rayActor } from './bots.js';

const $ = id => document.getElementById(id);
const TEAM = ['#6fb1ff', '#ff6a55'];
const MARK_RANGE = 45;
const LOW_HP = 35, LOW_AMMO = 8;
const CHIP_HOLD = 0.45, CHIP_RATE = 0.7;   // health just lost stays on the bar as a red chunk this long, then drains (bars per second)
const CALM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const NUM = '"DIN Condensed","Bahnschrift Condensed","Roboto Condensed","Arial Narrow",sans-serif';
const INK = (a = 1) => `rgba(243,241,234,${a})`;
const ICON = {
  gun: '<svg viewBox="0 0 64 18" class="gun"><path d="M0 5.2 10.5 4.2 14 5.6V10.2L9.5 10.6 4.6 12.8H0ZM14 4H36V10H14ZM17.2 10H21.6L20.2 16.6H16.4ZM24.6 10H29.4L31 16.6H26.6ZM36 4.7H52.5V9.3H36ZM52.5 6.1H57.5V7.9H52.5ZM57.5 5.3H64V8.7H57.5ZM19.5.8H32.5V3.3H19.5ZM22 3.3H24V4H22ZM28 3.3H30V4H28Z"/></svg>',
  nade: '<svg viewBox="0 0 16 19" class="nadei"><path d="M5.6 0h5.2v2.1h3.4L15 6.4l-1.6.5-.5-2.7h-2.1v1.3a6.5 6.5 0 1 1-5.2 0V4.2H4.3V2.1h1.3z"/></svg>',
  head: '<svg viewBox="0 0 14 14" class="hs"><circle cx="7" cy="7" r="4.9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="7" r="1.7"/><path d="M7 0v3.4M7 10.6V14M0 7h3.4M10.6 7H14" stroke="currentColor" stroke-width="1.7"/></svg>',
};
const pop = (el, frames, ms) => { if (!CALM && el.animate) el.animate(frames, { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' }); };

export class HUD {
  constructor(G) {
    this.G = G; this.last = {};
    this.mm = $('minimap').getContext('2d'); this.cp = $('compass').getContext('2d');
    $('hpbar').innerHTML = '<i class="chip"></i><i class="fill"></i>';
    $('abar').innerHTML = Array.from({ length: 30 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
    this.ticks = [...$('abar').children];
    this.feed = []; this.hitT = 0; this.dmgT = 0; this.bannerT = 0; this.fillT = 0; this.pings = new Map();
    this.chip = 1; this.chipHold = 0; this.lastFrac = 1; this.respawnLen = 4;
    this.marks = new Map(); this.markLayer = $('teamMarks');
    this.markRay = new Raycaster(); this.markRay.firstHitOnly = true;
    this.markPoint = new Vector3(); this.markDirection = new Vector3(); this.aimDirection = new Vector3();
    this.headPoint = new Vector3(); this.bodyPoint = new Vector3();
    this.markHits = []; this.focusedMark = null; this.smokeEnd = new Vector3();
  }
  set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } }
  cls(id, name, on) { const k = id + '.' + name; if (this.last[k] !== on) { this.last[k] = on; $(id).classList.toggle(name, on); } }
  css(id, prop, v) { const k = id + prop; if (this.last[k] !== v) { this.last[k] = v; $(id).style.setProperty(prop, v); } }

  hitmarker(kind) {
    const e = $('hit'); e.className = 'on ' + kind; this.hitT = kind === 'kill' ? 0.32 : 0.16;
    pop(e, [{ transform: `scale(${kind === 'kill' ? 1.6 : 1.4})` }, { transform: 'scale(1)' }], kind === 'kill' ? 220 : 120);
  }
  damageFrom(angle) { const e = $('dmg'); e.style.transform = `translate(-50%,-50%) rotate(${(-angle * 180 / Math.PI).toFixed(1)}deg)`; e.style.opacity = 1; this.dmgT = 1.1; }
  banner(head) {
    const b = $('banner');
    b.querySelector('.a').textContent = head ? 'Headshot' : 'Enemy eliminated'; $('bannerB').textContent = head ? '+150' : '+100';
    b.classList.add('on'); this.bannerT = 1.9;
    pop(b, [{ opacity: 0, transform: 'translateX(-50%) scale(1.25)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], 180);
  }
  kill(killer, victim, head, how) {
    const row = document.createElement('div'); row.className = 'row' + (killer?.isPlayer || victim.isPlayer ? ' me' : '');
    const name = (a, team) => `<span style="color:${TEAM[team]}">${a ? a.name : '—'}</span>`;
    row.innerHTML = name(killer, killer ? killer.team : 1 - victim.team) + (how === 'blast' ? ICON.nade : ICON.gun) + (head ? ICON.head : '') + name(victim, victim.team);
    const f = $('feed'); f.prepend(row); this.feed.unshift({ row, t: 6 }); while (this.feed.length > 5) this.feed.pop().row.remove();
  }
  ping(actor, secs) { this.pings.set(actor, secs); }
  // a grenade asked for with none left: its slot shakes
  noNade(kind) { pop($(kind === 'frag' ? 'nFrag' : 'nSmoke'), [0, -4, 4, -3, 3, 0].map(x => ({ transform: `translateX(${x}px)` })), 340); }
  // a new match: nothing left over from the last one on screen
  reset() {
    this.hitT = this.dmgT = this.bannerT = this.fillT = 0; this.chip = this.lastFrac = 1; this.chipHold = 0;
    $('hit').className = ''; $('dmg').style.opacity = 0; $('banner').classList.remove('on'); $('abar').classList.remove('fill');
  }

  update(dt) {
    const G = this.G, P = G.player, W = G.weapon, T = G.throw;
    // health: the number, the bar, the chunk just lost (held, then drained), a sweep while it regenerates
    const hp = Math.ceil(P.health), frac = Math.min(1, Math.max(0, P.health / 100));
    this.set('hp', Math.max(0, hp)); this.cls('health', 'low', hp < LOW_HP);
    if (frac >= this.chip) { this.chip = frac; this.chipHold = 0; }
    else if (frac < this.lastFrac - 1e-4) this.chipHold = CHIP_HOLD;
    else if ((this.chipHold -= dt) <= 0) this.chip = Math.max(frac, this.chip - CHIP_RATE * dt);
    this.lastFrac = frac;
    this.css('health', '--hp', frac.toFixed(3)); this.css('health', '--chip', this.chip.toFixed(3));
    this.cls('health', 'regen', P.alive && P.hurtT > 5 && P.health < 100);

    // ammunition: magazine, reserve, selector, a mark per round, the reload's progress
    this.set('mag', W.ammo); this.set('res', W.reserve); this.set('fmode', W.mode === 'auto' ? 'Auto' : 'Semi'); this.cls('ammo', 'semi', W.mode !== 'auto');
    this.cls('ammo', 'low', W.ammo <= LOW_AMMO); this.cls('ammo', 'reload', W.reloading);
    const reserveSeconds = W.reserveRefillRemaining;
    this.set('resRefill', reserveSeconds ? `${reserveSeconds}s` : '');
    this.css('hud', '--rl', (W.reloading ? Math.min(1, W.reloadT / (W.reloadLen || 2)) : 0).toFixed(3));
    if (this.last.ammoSeg !== W.ammo) {
      const seated = this.last.ammoSeg !== undefined && W.ammo > this.last.ammoSeg + 1;    // a fresh magazine: the strip refills round by round
      this.last.ammoSeg = W.ammo; this.ticks.forEach((e, i) => e.classList.toggle('on', i < W.ammo));
      if (seated && !CALM) { const a = $('abar'); a.classList.remove('fill'); void a.offsetWidth; a.classList.add('fill'); this.fillT = 0.75; }
    }
    if (this.fillT > 0 && (this.fillT -= dt) <= 0) $('abar').classList.remove('fill');

    // grenades: counts, refill clocks, the one in the hand
    this.set('nFragN', T.count.frag); this.set('nSmokeN', T.count.smoke);
    for (const [kind, id] of [['frag', 'nFragRefill'], ['smoke', 'nSmokeRefill']]) {
      const pending = T.refillAt[kind];
      const seconds = pending.length ? Math.max(1, Math.ceil(pending[0] - G.time)) : 0;
      this.set(id, seconds ? `${seconds}s` : '');
    }
    this.cls('nFrag', 'none', T.count.frag <= 0); this.cls('nSmoke', 'none', T.count.smoke <= 0); this.cls('nFrag', 'sel', T.sel === 'frag'); this.cls('nSmoke', 'sel', T.sel === 'smoke');
    this.set('wlabel', T.sel === 'frag' ? 'K-22 Frag' : T.sel === 'smoke' ? 'V-8 Smoke' : 'MK4 Carbine');

    // score race to the limit either side of the clock; the clock turns amber in the last minute
    const limit = G.match?.score || 30;
    this.set('s0', G.score[0]); this.set('s1', G.score[1]);
    this.css('scorebar', '--p0', Math.min(1, G.score[0] / limit).toFixed(3)); this.css('scorebar', '--p1', Math.min(1, G.score[1] / limit).toFixed(3));
    const tl = Math.max(0, Math.ceil(G.timeLeft)); this.set('timer', `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`); this.cls('timer', 'low', tl <= 60);

    // Project the next shot's spread to CSS pixels. Keep the center legible at low spread.
    const pixelsPerSlope = G.R.renderer.domElement.clientHeight * 0.5 * G.R.camera.projectionMatrix.elements[5];
    const gap = Math.max(5, W.nextShotSpread * pixelsPerSlope);
    const c = $('cross'); c.style.setProperty('--g', (T.busy ? 9 : gap).toFixed(1) + 'px'); c.style.opacity = P.alive && !W.reloading ? Math.max(0, 1 - W.ads * 2.2).toFixed(2) : 0;
    this.prompt(P, W, T);
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hit').className = ''; }
    if (this.dmgT > 0) { this.dmgT -= dt; $('dmg').style.opacity = Math.max(0, this.dmgT).toFixed(2); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').classList.remove('on'); }
    for (const f of this.feed) { f.t -= dt; if (f.t < 1) f.row.style.opacity = Math.max(0, f.t).toFixed(2); }
    for (const [a, t] of this.pings) { if (t - dt <= 0) this.pings.delete(a); else this.pings.set(a, t - dt); }
    this.cls('dead', 'on', !P.alive && G.matchLive);
    if (!P.alive) {
      const r = Math.max(0, P.respawnT); this.respawnLen = Math.max(this.respawnLen, r);
      this.set('respawn', r.toFixed(1)); this.css('dead', '--r', (1 - r / this.respawnLen).toFixed(3));
    } else this.respawnLen = 0;
    this.identifyTeams(); this.minimap(); this.compass();
  }

  // under the sights: how to throw the grenade in the hand, the reload in progress, a low magazine, nothing left at all
  prompt(P, W, T) {
    let html = '', tone = '';
    if (P.alive && this.G.matchLive) {
      if (T.busy && T.sel) { html = '<kbd>LMB</kbd><span>Throw</span><kbd>RMB</kbd><span>Lob</span>'; tone = 'nade'; }
      else if (W.reloading) html = '<span>Reloading</span><i class="bar"></i>';
      else if (W.ammo === 0 && W.reserve === 0) { html = '<span>Out of ammo</span>'; tone = 'out'; }
      else if (W.ammo <= LOW_AMMO && W.reserve > 0) { html = '<kbd>R</kbd><span>Reload</span>'; tone = 'warn'; }
    }
    if (this.last.prompt !== html) { this.last.prompt = html; const e = $('prompt'); if (html) e.innerHTML = html; e.classList.toggle('on', !!html); }
    for (const t of ['nade', 'out', 'warn']) this.cls('prompt', t, tone === t);
  }

  identifyTeams() {
    const { player, bots, R } = this.G;
    const camera = R.camera, origin = camera.position, point = this.markPoint;
    camera.getWorldDirection(this.aimDirection);
    let focused = null, focusDistance = MARK_RANGE;
    for (const bot of bots.list) {
      let mark = this.marks.get(bot);
      if (!mark) {
        const el = document.createElement('div');
        const name = document.createElement('span');
        const ally = bot.team === player.team;
        el.className = `team-mark ${ally ? 'ally' : 'enemy'}`;
        name.textContent = bot.name;
        name.hidden = true;
        el.append(name); this.markLayer.append(el);
        mark = { el, name }; this.marks.set(bot, mark);
      }

      const visible = player.alive && this.projectMark(bot, camera);
      if (mark.el.hidden === visible) mark.el.hidden = !visible;
      if (!visible) continue;
      mark.el.style.transform = `translate(${((point.x + 1) * 50).toFixed(2)}vw, ${((1 - point.y) * 50).toFixed(2)}vh)`;
      const aimHit = rayActor(origin, this.aimDirection, bot, focusDistance);
      if (aimHit) { focused = mark; focusDistance = aimHit.t; }
    }
    if (focused && this.blocked(origin, this.aimDirection, focusDistance)) focused = null;
    if (this.focusedMark !== focused) {
      if (this.focusedMark) this.focusedMark.name.hidden = true;
      if (focused) focused.name.hidden = false;
      this.focusedMark = focused;
    }
  }

  projectMark(bot, camera) {
    const origin = camera.position;
    if (!bot.alive || !bot.root.visible || bot.pos.distanceToSquared(origin) > MARK_RANGE ** 2) return false;
    const head = bot.b.head.getWorldPosition(this.headPoint);
    const chest = bot.b.spine2.getWorldPosition(this.bodyPoint);
    head.lerp(chest, -0.25); // the head joint itself sits at the bottom of the helmet
    const point = this.markPoint.copy(head).addScaledVector(camera.up, 0.23).project(camera);
    if (Math.abs(point.z) > 1 || Math.abs(point.x) > 0.98 || Math.abs(point.y) > 0.98) return false;

    // The mark floats above the model, while sight checks pass through a visible part of its body.
    return this.hasSight(origin, head) || this.hasSight(origin, chest);
  }

  hasSight(origin, target) {
    const direction = this.markDirection.subVectors(target, origin);
    const distance = direction.length();
    return distance > 0.02 && !this.blocked(origin, direction.divideScalar(distance), distance - 0.02);
  }

  blocked(origin, direction, far) {
    const { world, rigid } = this.G, ray = this.markRay, hits = this.markHits;
    ray.set(origin, direction);
    ray.far = far;
    hits.length = 0;
    ray.intersectObjects(world.rayMeshes, false, hits);
    return hits.some(h => this.G.R.kitShown(h.object)) || !!rigid.ray(origin, direction, far) || this.G.throw.smoked(origin, this.smokeEnd.copy(origin).addScaledVector(direction, far));      // smoke hides a soldier as a wall does
  }

  // Heading up, ~58 m around: dark glass, buildings, the view cone, allies, enemies heard or reported, north on the rim.
  minimap() {
    const G = this.G, P = G.player, g = this.mm, S = g.canvas.width, c = S / 2, sc = S / 360 * 3.1;     // 3.1 px per metre on a 360 px map
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = -fz, rz = fx;
    const X = (x, z) => c + ((x - P.pos.x) * rx + (z - P.pos.z) * rz) * sc, Y = (x, z) => c - ((x - P.pos.x) * fx + (z - P.pos.z) * fz) * sc;
    g.clearRect(0, 0, S, S);
    const glass = g.createRadialGradient(c, c, S * 0.08, c, c, S * 0.72); glass.addColorStop(0, 'rgba(6,8,10,0.30)'); glass.addColorStop(1, 'rgba(6,8,10,0.58)');
    g.fillStyle = glass; g.fillRect(0, 0, S, S);
    g.fillStyle = INK(0.16); g.strokeStyle = INK(0.5); g.lineWidth = 1.5; g.lineJoin = 'round';
    for (const b of G.world.buildings) {
      if (Math.abs((b.x0 + b.x1) / 2 - P.pos.x) > 80 || Math.abs((b.z0 + b.z1) / 2 - P.pos.z) > 80) continue;
      g.beginPath(); g.moveTo(X(b.x0, b.z0), Y(b.x0, b.z0)); g.lineTo(X(b.x1, b.z0), Y(b.x1, b.z0)); g.lineTo(X(b.x1, b.z1), Y(b.x1, b.z1)); g.lineTo(X(b.x0, b.z1), Y(b.x0, b.z1)); g.closePath(); g.fill(); g.stroke();
    }
    // field of view wedge
    const half = (G.R.camera.fov * G.R.camera.aspect * 0.5 * Math.PI) / 180 * 0.62;
    const cone = g.createRadialGradient(c, c, 0, c, c, 130); cone.addColorStop(0, INK(0.24)); cone.addColorStop(1, INK(0));
    g.fillStyle = cone; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 130, -Math.PI / 2 - half, -Math.PI / 2 + half); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 2.5;
    for (const b of G.bots.list) {
      if (!b.alive) continue;
      const mine = b.team === P.team; if (!mine && !this.pings.has(b)) continue;
      const x = X(b.pos.x, b.pos.z), y = Y(b.pos.x, b.pos.z); if (x < 8 || y < 8 || x > S - 8 || y > S - 8) continue;
      g.globalAlpha = mine ? 1 : Math.min(1, this.pings.get(b) * 1.5);
      g.beginPath();
      if (mine) g.arc(x, y, 6.5, 0, Math.PI * 2);
      else { g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); }
      g.fillStyle = TEAM[b.team]; g.stroke(); g.fill();
      g.globalAlpha = 1;
    }
    // the player's arrow
    g.beginPath(); g.moveTo(c, c - 12); g.lineTo(c + 8.5, c + 9); g.lineTo(c, c + 4.5); g.lineTo(c - 8.5, c + 9); g.closePath();
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke(); g.fillStyle = INK(); g.fill();
    // north, where its bearing crosses the rim
    const nx = Math.sin(P.yaw), ny = -Math.cos(P.yaw), k = (c - 17) / Math.max(Math.abs(nx), Math.abs(ny));
    g.font = `700 25px ${NUM}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(c + nx * k, c + ny * k, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK(); g.fillText('N', c + nx * k, c + ny * k + 2);
    // corner brackets
    g.strokeStyle = INK(0.7); g.lineWidth = 3; const L = 22, o = 1.5;
    g.beginPath();
    g.moveTo(o, o + L); g.lineTo(o, o); g.lineTo(o + L, o); g.moveTo(S - o - L, o); g.lineTo(S - o, o); g.lineTo(S - o, o + L);
    g.moveTo(S - o, S - o - L); g.lineTo(S - o, S - o); g.lineTo(S - o - L, S - o); g.moveTo(o + L, S - o); g.lineTo(o, S - o); g.lineTo(o, S - o - L);
    g.stroke();
  }

  // A tape of bearings: a tick every 5 degrees, a number every 15, a letter every 45; the exact bearing sits under it.
  compass() {
    const P = this.G.player, head = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.set('bearing', String(Math.round(head) % 360).padStart(3, '0'));
    const key = head.toFixed(2); if (this.last.compass === key) return; this.last.compass = key;
    const g = this.cp, w = g.canvas.width, h = g.canvas.height, k = w / 440, ppd = 3 * k;
    g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 3 * k;
    const LETTER = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = Math.floor((head - 80) / 5) * 5; d <= head + 80; d += 5) {
      const x = w / 2 + (d - head) * ppd, m = ((d % 360) + 360) % 360;
      if (m % 45 === 0) {
        g.fillStyle = INK(); g.fillRect(x - k, h - 9 * k, 2 * k, 9 * k);
        g.font = `700 ${17 * k}px ${NUM}`; g.fillText(LETTER[m], x, 18 * k);
      } else if (m % 15 === 0) {
        g.fillStyle = INK(0.8); g.fillRect(x - 0.6 * k, h - 6 * k, 1.2 * k, 6 * k);
        g.font = `700 ${12 * k}px ${NUM}`; g.fillStyle = INK(0.62); g.fillText(m, x, 17 * k);
      } else { g.fillStyle = INK(0.45); g.fillRect(x - 0.5 * k, h - 4 * k, k, 4 * k); }
    }
    g.shadowBlur = 0;
  }

  // ---- menus -------------------------------------------------------------------------------------------------------------
  show(screen, data = {}) {
    for (const id of ['start', 'pause', 'results']) $(id).classList.toggle('on', id === screen);
    $('menu').classList.toggle('on', !!screen); $('hud').classList.toggle('on', !screen);
    if (screen === 'results') {
      const G = this.G, win = data.win;
      $('resTitle').textContent = win === null ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT'; $('resTitle').className = win ? 'win' : 'lose';
      $('resScore').innerHTML = `<span style="color:${TEAM[0]}">${G.score[0]}</span> — <span style="color:${TEAM[1]}">${G.score[1]}</span>`;
      const acc = G.stats.shots ? Math.round((G.stats.hits / G.stats.shots) * 100) : 0;
      const rows = [G.player, ...G.bots.list].sort((a, b) => b.kills - a.kills).map(a => `<tr class="${a.isPlayer ? 'me' : ''}"><td style="color:${TEAM[a.team]}">${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td></tr>`).join('');
      $('resStats').innerHTML = `<div class="sum">${data.reason} · Accuracy ${acc}% · ${G.stats.shots} rounds fired</div><table><tr><th>Operator</th><th>K</th><th>D</th></tr>${rows}</table>`;
    }
  }
}
