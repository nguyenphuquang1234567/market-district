// Touch play for phones and tablets, after the scheme Saltline used: a move stick that appears under the left thumb
// wherever it lands, look by dragging anywhere on the right, and a cluster of buttons under the right thumb. FIRE can be
// dragged while it is held, so one thumb keeps aiming while it fires. Pointer Events, so every finger is followed by its
// own id. While the controls are shown a mouse drives them too (the Browser pane's clicks, ?touch=1 on a desktop).
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
// A phone or a small tablet. It gets the phone quality preset unless another one was picked in the menu (main.js).
export const PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && coarse && Math.min(screen.width, screen.height) < 900);
// The controls are on from the start on a touch-first device, and otherwise from the first finger on the screen.
// ?touch=1 turns them on anywhere, ?touch=0 never.
const FORCE = params.get('touch');
const FIRST = FORCE === '1' || (FORCE !== '0' && (PHONE || coarse));

const RIM = 56;            // CSS px from the stick's centre to its rim
const DEAD = 0.12;         // of the rim: a resting thumb's jitter moves nothing
const RUN = 0.93;          // pushed out this far, mostly forward: sprint (no button for it)
const LOOK = 2.4;          // a CSS px of drag turns as far as 2.4 px of mouse: 0.005 rad at sensitivity 1, Saltline's rate
const LEFT = 0.42;         // the stick's side of the screen, a fraction of its width

export class Touch {
  constructor(G) {
    this.G = G; this.on = false; this.shown = false;
    this.state = { f: 0, s: 0, sprint: false, crouch: false, fire: false, ads: false };    // read by the player each frame
    this.ptr = new Map(); this.stick = null; this.look = null; this.run = false;
    this.aim = false; this.lob = false; this.duck = false; this.last = {};                 // AIM and CROUCH toggle; LOB is held
    this.el = document.getElementById('touch'); this.stickEl = document.getElementById('tStick'); this.nub = this.stickEl.querySelector('.nub');
    this.btn = {}; for (const b of this.el.querySelectorAll('[data-k]')) this.btn[b.dataset.k] = b;
    // the first finger turns the controls on; on a touch-screen laptop a mouse click in the menus turns them off again
    addEventListener('pointerdown', e => {
      if (FORCE === '0') return;
      if (e.pointerType === 'touch') this.enable();
      else if (e.pointerType === 'mouse' && this.on && !FIRST && !this.shown) this.disable();
    }, true);
    const el = this.el;
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, e => this.up(e));
    // (fingers on the controls neither scroll, zoom, call up the magnifier nor send the mouse events a tap is copied into)
    for (const t of ['touchstart', 'touchmove', 'touchend']) el.addEventListener(t, e => e.preventDefault(), { passive: false });
    addEventListener('resize', () => this.home());
    if (FIRST) this.enable();
  }

  enable() {
    if (this.on) return;
    this.on = true; document.documentElement.classList.add('touch'); this.home();
  }
  disable() { this.on = false; document.documentElement.classList.remove('touch'); }
  // shown while a match is being played (main.js startPlaying / stopPlaying); hiding lets go of everything held
  show(v) {
    v = v && this.on; if (v === this.shown) return;
    this.shown = v; this.el.classList.toggle('on', v); this.reset();
  }
  reset() {
    this.ptr.clear(); this.stick = this.look = null; this.run = this.lob = this.aim = this.duck = false;
    Object.assign(this.state, { f: 0, s: 0, sprint: false, crouch: false, fire: false, ads: false });
    for (const b of Object.values(this.btn)) b.classList.remove('held');
    this.home();
  }

  // the stick rests, dimmed, where a left thumb would fall; a touch anywhere on the left brings it there
  home() {
    if (this.stick) return;
    const pad = parseFloat(getComputedStyle(this.el).paddingLeft) || 0, padB = parseFloat(getComputedStyle(this.el).paddingBottom) || 0;
    this.place(pad + Math.max(92, innerWidth * 0.12), innerHeight - padB - Math.max(92, innerHeight * 0.26), 0, 0);
    this.stickEl.classList.remove('live', 'run');
  }
  place(cx, cy, dx, dy) {
    this.stickEl.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
    this.nub.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }

  down(e) {
    if (!this.shown) return;
    e.preventDefault();
    const b = e.target.closest('[data-k]');
    const k = b ? b.dataset.k : !this.stick && e.clientX < innerWidth * LEFT ? 'stick' : !this.look ? 'look' : null;
    if (!k) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* (a pointer the browser does not know: a test's synthetic event) */ }
    const p = { k, b, x: e.clientX, y: e.clientY };
    this.ptr.set(e.pointerId, p);
    this.press(p);
  }
  press(p) {
    const G = this.G, B = G.settings.binds, P = G.player, T = G.throw;
    if (p.b) p.b.classList.add('held');
    switch (p.k) {
      case 'stick': this.stick = p; p.cx = p.x; p.cy = p.y; this.stickEl.classList.add('live'); this.place(p.x, p.y, 0, 0); break;
      case 'look': this.look = p; break;
      case 'fire': this.state.fire = true; break;
      case 'aim': if (T.busy) this.lob = true; else this.aim = !this.aim; break;      // with a grenade out: held for the underhand lob
      case 'crouch': this.duck = !this.duck; break;
      case 'frag': case 'smoke': this.aim = false; P.onKey(B[p.k]); break;
      case 'reload': case 'jump': case 'mode': P.onKey(B[p.k]); break;              // as the keys do (reload also puts a grenade away)
      case 'pause': G.pause?.(); break;
    }
  }
  move(e) {
    const p = this.ptr.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (p.k === 'stick') this.steer(p);
    else if (p.k === 'look' || p.k === 'fire') { const m = this.G.player.mouse; m.dx += dx * LOOK; m.dy += dy * LOOK; }
  }
  steer(p) {
    let dx = p.x - p.cx, dy = p.y - p.cy; const d = Math.hypot(dx, dy);
    if (d > RIM) { dx *= RIM / d; dy *= RIM / d; }
    this.place(p.cx, p.cy, dx, dy);
    const m = Math.min(1, d / RIM), k = m > DEAD ? (m - DEAD) / (1 - DEAD) / m : 0;   // past the dead zone, rescaled to start from nothing
    this.state.s = clamp(dx / RIM * k, -1, 1); this.state.f = clamp(-dy / RIM * k, -1, 1);
    this.run = m >= RUN && -dy > 0.8 * Math.hypot(dx, dy);
  }
  up(e) {
    const p = this.ptr.get(e.pointerId); if (!p) return;
    this.ptr.delete(e.pointerId);
    if (p.b) p.b.classList.remove('held');
    if (p === this.stick) { this.stick = null; this.state.f = this.state.s = 0; this.run = false; this.home(); }
    else if (p === this.look) this.look = null;
    else if (p.k === 'fire') this.state.fire = false;
    else if (p.k === 'aim') this.lob = false;
  }

  // once a frame, before the player reads the state: the toggles against what the hands hold, and the labels
  update() {
    if (!this.on) return;
    const { player: P, throw: T, weapon: W } = this.G, s = this.state;
    if (!P.alive) this.aim = this.duck = false;
    if (T.busy) this.aim = false;                      // a grenade in the hands: AIM is the lob, FIRE the throw
    s.ads = T.busy ? this.lob : this.aim;
    s.sprint = this.run && !s.ads;
    if (s.sprint) this.duck = false;                   // running off stands up
    s.crouch = this.duck;
    if (!this.shown) return;
    const b = this.btn;
    this.text(b.fire, T.busy ? 'Throw' : 'Fire'); this.text(b.aim, T.busy ? 'Lob' : 'Aim'); this.text(b.mode, W.mode === 'auto' ? 'Auto' : 'Semi');
    this.cls(b.aim, 'lit', s.ads); this.cls(b.crouch, 'lit', this.duck); this.cls(this.stickEl, 'run', s.sprint);
    for (const k of ['frag', 'smoke']) { this.text(b[k], String(T.count[k]), 'b'); this.cls(b[k], 'lit', T.sel === k); this.cls(b[k], 'none', T.count[k] <= 0); }
  }
  text(el, v, sel = 'span') { const key = el.dataset.k + sel; if (this.last[key] !== v) { this.last[key] = v; el.querySelector(sel).textContent = v; } }
  cls(el, name, on) { const key = (el.dataset.k || el.id) + '.' + name; if (this.last[key] !== on) { this.last[key] = on; el.classList.toggle(name, on); } }

  // Deploy and Resume (a tap, so a page may ask): the whole screen, turned sideways where the browser lets a page do that.
  // Android Chrome does both; an iPhone does neither for a page (Add to Home Screen opens it without the browser's bars).
  fullscreen() {
    if (!this.on || this.G.settings.fullscreen === false) return;
    const d = document, el = d.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    const turn = () => { try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* not offered */ } };
    if (d.fullscreenElement || d.webkitFullscreenElement) { turn(); return; }
    if (!req) return;
    try { const r = req.call(el, { navigationUI: 'hide' }); if (r && r.then) r.then(turn, () => {}); else turn(); } catch { /* refused */ }
  }
}
