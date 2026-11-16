// DOM heads-up display and menus. Drawn at native resolution above the 3D canvas, untouched by post-processing.
import { Raycaster, Vector3 } from 'three';
import { rayActor } from './bots.js';

const $ = id => document.getElementById(id);
const TEAM = ['#6fb1ff', '#ff6a55'];
const MARK_RANGE = 45;

export class HUD {
  constructor(G) {
    this.G = G; this.last = {};
    this.mm = $('minimap').getContext('2d'); this.cp = $('compass').getContext('2d');
    $('hpbar').innerHTML = '<i></i>'.repeat(10); $('abar').innerHTML = '<i></i>'.repeat(30);
    this.feed = []; this.hitT = 0; this.dmgT = 0; this.bannerT = 0; this.pings = new Map();
    this.marks = new Map(); this.markLayer = $('teamMarks');
    this.markRay = new Raycaster(); this.markRay.firstHitOnly = true;
    this.markPoint = new Vector3(); this.markDirection = new Vector3(); this.aimDirection = new Vector3();
    this.headPoint = new Vector3(); this.bodyPoint = new Vector3();
    this.markHits = []; this.focusedMark = null; this.smokeEnd = new Vector3();
  }
  set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } }
  cls(id, name, on) { const k = id + '.' + name; if (this.last[k] !== on) { this.last[k] = on; $(id).classList.toggle(name, on); } }

  hitmarker(kind) { const e = $('hit'); e.className = 'on ' + kind; this.hitT = kind === 'kill' ? 0.32 : 0.16; }
  damageFrom(angle) { const e = $('dmg'); e.style.transform = `translate(-50%,-50%) rotate(${(-angle * 180 / Math.PI).toFixed(1)}deg)`; e.style.opacity = 1; this.dmgT = 1.1; }
  banner(head) { $('bannerB').textContent = head ? 'HEADSHOT  +150 XP' : '+100 XP'; $('banner').classList.add('on'); this.bannerT = 1.9; }
  kill(killer, victim, head, how) {
    const row = document.createElement('div'); row.className = 'row';
    const icon = how === 'blast' ? `<svg viewBox="0 0 16 18" class="nadei"><path d="M6 0h5v2h3v2h-3v1.2a6.2 6.2 0 1 1-5 0V4H5V2h1z"/></svg>`
      : `<svg viewBox="0 0 44 12" class="gun"><path d="M0 4h9l2-2h17v2h14v2H30l-1 2h-6l-2 4h-4l1-4H9L7 6H0z"/></svg>`;
    row.innerHTML = `<span style="color:${TEAM[killer ? killer.team : 1 - victim.team]}">${killer ? killer.name : '—'}</span>${icon}${head ? '<b class="hs">◎</b>' : ''}<span style="color:${TEAM[victim.team]}">${victim.name}</span>`;
    const f = $('feed'); f.prepend(row); this.feed.unshift({ row, t: 6 }); while (this.feed.length > 5) this.feed.pop().row.remove();
  }
  ping(actor, secs) { this.pings.set(actor, secs); }

  update(dt) {
    const G = this.G, P = G.player, W = G.weapon;
    const hp = Math.ceil(P.health);
    this.set('hp', hp); this.cls('health', 'low', hp < 35);
    if (this.last.hpSeg !== Math.ceil(hp / 10)) { this.last.hpSeg = Math.ceil(hp / 10); [...$('hpbar').children].forEach((e, i) => e.classList.toggle('on', i < this.last.hpSeg)); }
    this.set('mag', W.ammo); this.set('res', W.reserve); this.set('fmode', W.mode === 'auto' ? 'AUTO' : 'SEMI'); this.cls('ammo', 'low', W.ammo <= 8); this.cls('ammo', 'reload', W.reloading);
    const reserveSeconds = W.reserveRefillRemaining;
    this.set('resRefill', reserveSeconds ? `${reserveSeconds}s` : '');
    if (this.last.ammoSeg !== W.ammo) { this.last.ammoSeg = W.ammo; [...$('abar').children].forEach((e, i) => e.classList.toggle('on', i < W.ammo)); }
    const T = G.throw;
    this.set('nFragN', T.count.frag); this.set('nSmokeN', T.count.smoke);
    for (const [kind, id] of [['frag', 'nFragRefill'], ['smoke', 'nSmokeRefill']]) {
      const pending = T.refillAt[kind];
      const seconds = pending.length ? Math.max(1, Math.ceil(pending[0] - G.time)) : 0;
      this.set(id, seconds ? `${seconds}s` : '');
    }
    this.cls('nFrag', 'none', T.count.frag <= 0); this.cls('nSmoke', 'none', T.count.smoke <= 0); this.cls('nFrag', 'sel', T.sel === 'frag'); this.cls('nSmoke', 'sel', T.sel === 'smoke');
    this.set('wlabel', T.sel === 'frag' ? 'K-22 Frag' : T.sel === 'smoke' ? 'V-8 Smoke' : 'MK4 Carbine');
    this.set('s0', G.score[0]); this.set('s1', G.score[1]);
    const tl = Math.max(0, Math.ceil(G.timeLeft)); this.set('timer', `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
    // Project the next shot's spread to CSS pixels. Keep the center legible at low spread.
    const pixelsPerSlope = G.R.renderer.domElement.clientHeight * 0.5 * G.R.camera.projectionMatrix.elements[5];
    const gap = Math.max(5, W.nextShotSpread * pixelsPerSlope);
    const c = $('cross'); c.style.setProperty('--g', (T.busy ? 9 : gap).toFixed(1) + 'px'); c.style.opacity = P.alive && !W.reloading ? Math.max(0, 1 - W.ads * 2.2).toFixed(2) : 0;
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('hit').className = ''; }
    if (this.dmgT > 0) { this.dmgT -= dt; $('dmg').style.opacity = Math.max(0, this.dmgT).toFixed(2); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').classList.remove('on'); }
    for (const f of this.feed) { f.t -= dt; if (f.t < 1) f.row.style.opacity = Math.max(0, f.t).toFixed(2); }
    for (const [a, t] of this.pings) { if (t - dt <= 0) this.pings.delete(a); else this.pings.set(a, t - dt); }
    this.cls('dead', 'on', !P.alive && G.matchLive); if (!P.alive) this.set('respawn', Math.max(0, P.respawnT).toFixed(1));
    this.identifyTeams(); this.minimap(); this.compass();
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
        name.textContent = ally ? 'Ally' : 'Enemy';
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
    return hits.length > 0 || !!rigid.ray(origin, direction, far) || this.G.throw.smoked(origin, this.smokeEnd.copy(origin).addScaledVector(direction, far));      // smoke hides a soldier as a wall does
  }

  minimap() {
    const G = this.G, P = G.player, g = this.mm, S = 360, c = S / 2, sc = 3.1;     // 3.1 px per metre → ~58 m radius
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = -fz, rz = fx;
    const X = (x, z) => c + ((x - P.pos.x) * rx + (z - P.pos.z) * rz) * sc, Y = (x, z) => c - ((x - P.pos.x) * fx + (z - P.pos.z) * fz) * sc;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(214,206,190,0.30)'; g.strokeStyle = 'rgba(240,234,220,0.55)'; g.lineWidth = 1.2;
    for (const b of G.world.buildings) {
      if (Math.abs((b.x0 + b.x1) / 2 - P.pos.x) > 80 || Math.abs((b.z0 + b.z1) / 2 - P.pos.z) > 80) continue;
      g.beginPath(); g.moveTo(X(b.x0, b.z0), Y(b.x0, b.z0)); g.lineTo(X(b.x1, b.z0), Y(b.x1, b.z0)); g.lineTo(X(b.x1, b.z1), Y(b.x1, b.z1)); g.lineTo(X(b.x0, b.z1), Y(b.x0, b.z1)); g.closePath(); g.fill(); g.stroke();
    }
    // field of view wedge + own arrow
    const half = (G.R.camera.fov * G.R.camera.aspect * 0.5 * Math.PI) / 180 * 0.62;
    const grd = g.createRadialGradient(c, c, 0, c, c, 120); grd.addColorStop(0, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 120, -Math.PI / 2 - half, -Math.PI / 2 + half); g.closePath(); g.fill();
    for (const b of G.bots.list) {
      if (!b.alive) continue;
      const mine = b.team === P.team; if (!mine && !this.pings.has(b)) continue;
      const x = X(b.pos.x, b.pos.z), y = Y(b.pos.x, b.pos.z); if (x < 6 || y < 6 || x > S - 6 || y > S - 6) continue;
      g.globalAlpha = mine ? 1 : Math.min(1, this.pings.get(b) * 1.5);
      g.beginPath();
      if (mine) {
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fillStyle = '#12151a'; g.fill();
        g.strokeStyle = TEAM[b.team]; g.lineWidth = 3; g.stroke();
      } else {
        g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y);
        g.fillStyle = TEAM[b.team]; g.fill();
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(c, c - 10); g.lineTo(c + 7, c + 8); g.lineTo(c, c + 4); g.lineTo(c - 7, c + 8); g.closePath(); g.fill();
  }

  compass() {
    const g = this.cp, w = 640, h = 44, P = this.G.player, head = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360, ppd = 3.2;
    g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.font = '600 17px "Avenir Next Condensed","DIN Condensed","Arial Narrow",sans-serif';
    for (let d = Math.floor((head - 100) / 5) * 5; d <= head + 100; d += 5) {
      const x = w / 2 + (d - head) * ppd, a = Math.max(0, 1 - Math.abs(d - head) / 100), m = ((d % 360) + 360) % 360;
      g.fillStyle = `rgba(255,255,255,${(a * 0.85).toFixed(2)})`;
      if (m % 45 === 0) { g.fillRect(x - 1, 0, 2, 12); g.fillText({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[m], x, 32); }
      else if (m % 15 === 0) { g.fillRect(x - 0.5, 0, 1, 8); g.fillStyle = `rgba(255,255,255,${(a * 0.5).toFixed(2)})`; g.font = '500 12px "Avenir Next Condensed","Arial Narrow",sans-serif'; g.fillText(m, x, 30); g.font = '600 17px "Avenir Next Condensed","DIN Condensed","Arial Narrow",sans-serif'; }
      else g.fillRect(x - 0.5, 0, 1, 4);
    }
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w / 2 - 5, h); g.lineTo(w / 2 + 5, h); g.lineTo(w / 2, h - 7); g.fill();
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
