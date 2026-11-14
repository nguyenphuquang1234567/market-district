// Measures how the soldiers move. In the browser console, with the dev server running:
//   const probe = await import('/tools/locomotion-probe.js');
//   probe.patrol(G, 60)                         walk one team round the district with nobody to fight; returns the numbers
//   await probe.sheet(G, 'walk', { secs: 2 })   contact sheet of one soldier from a tracking camera, saved to captures/
// Everything runs on fixed steps through the real update, so two runs give the same figures.
const wrap = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const pct = (a, p) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r2 = v => Math.round(v * 100) / 100;

function clearanceTo(cols, x, z, y, limit = 3) {
  let best = limit;
  for (const b of cols) {
    if (b.y1 < y + 0.5 || b.y0 > y + 1.6) continue;
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > b.hx + b.hz + best || Math.abs(dz) > b.hx + b.hz + best) continue;
    const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    const d = Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz));
    if (d < best) best = d;
  }
  return best;
}

// Measurement needs the simulation, not the picture: skip rendering while stepping.
function unrendered(G, run) {
  const render = G.R.render; G.R.render = () => {};
  try { return run(); } finally { G.R.render = render; }
}

export function begin(G, { teams = [0], seed = 0 } = {}) {
  G.manual = true; G.auto = true; G.frozen = true;
  G.resetMatch(); G.playing = true; G.hud.show(null);
  G.player.sim = { f: 0, s: 0 }; G.goto(44, -79, 0);
  for (const b of G.bots.list) if (!teams.includes(b.team)) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; }
  for (let i = 0; i < seed; i++) G.bots.list[0].rnd();
  for (const b of G.bots.list) {
    if (b.probed) continue;
    const place = b.place.bind(b); b.probed = true;
    b.place = (x, z, c) => { const hit = place(x, z, c); if (hit) { b.scraped = true; b.scrapes = (b.scrapes || 0) + 1; b.lastScrape = [Math.round(b.pos.x * 10) / 10, Math.round(b.pos.z * 10) / 10]; } return hit; };       // walls touched while walking
  }
}

// Watches every living soldier for `secs` and reports the motion a viewer would notice.
export function watch(G, secs, opts = {}) { return unrendered(G, () => measure(G, secs, opts)); }

function measure(G, secs, { dt = 1 / 60, trace = null, each = null } = {}) {
  const T = G.THREE, cols = G.world.colliders, heel = new T.Vector3(), toe = new T.Vector3(), cap = new T.Vector3();
  const S = new Map();
  const acc = [], jerk = [], turn = [], yawRate = [], bodyRate = [], slipSpeed = [], clear = [], speeds = [], skew = [], lean = [], drift = [], contactLen = [];
  let frames = 0, moving = 0, contactT = 0, slipDist = 0, travel = 0, stops = 0, stuck = 0, scrape = 0, hug = 0, backpedal = 0, sidestep = 0, snaps = 0, airborne = 0, sunk = 0, idle = 0, skim = 0, crowd = 0;
  const steps = Math.round(secs / dt), traceOut = [];
  for (let k = 0; k < steps; k++) {
    G.step(1, dt); G.player.health = 100;
    for (const b of G.bots.list) {
      if (!b.alive) { S.delete(b); continue; }
      let s = S.get(b);
      const feet = [[b.b.lft, b.b.ltoe], [b.b.rft, b.b.rtoe]].map(([f, t]) => {
        // lowest point of the sole: under the heel, under the ball of the foot, or the toe cap
        f.localToWorld(heel.set(0, -2, 13.3)); f.localToWorld(toe.set(0, 15.8, 12.7));
        if (t) { t.localToWorld(cap.set(1.22, 7.97, -0.04)); cap.y -= 0.019; } else cap.set(0, 9, 0);
        const p = heel.y <= toe.y && heel.y <= cap.y ? heel : toe.y <= cap.y ? toe : cap;
        return { x: p.x, y: p.y, z: p.z, toe: p === heel ? 0 : p === toe ? 1 : 2 };
      });
      if (!s) { S.set(b, { x: b.pos.x, z: b.pos.z, y: b.pos.y, vx: 0, vz: 0, ax: 0, az: 0, yaw: b.yaw, body: b.bodyYaw, feet, hold: [null, null], fast: false, stuckT: 0, head: null, n: 0 }); continue; }
      const vx = (b.pos.x - s.x) / dt, vz = (b.pos.z - s.z) / dt, sp = Math.hypot(vx, vz);
      const ax = (vx - s.vx) / dt, az = (vz - s.vz) / dt, a = Math.hypot(ax, az);
      frames++; s.n++;
      speeds.push(sp);
      if (s.n > 2) { acc.push(a); jerk.push(Math.hypot(ax - s.ax, az - s.az) / dt); }
      const yr = wrap(s.yaw, b.yaw) / dt, br = wrap(s.body, b.bodyYaw) / dt;
      yawRate.push(Math.abs(yr)); bodyRate.push(Math.abs(br));
      if (Math.abs(br) > 12) snaps++;
      if (sp > 0.6) {
        moving++; travel += sp * dt;
        const head = Math.atan2(vx, vz);
        if (s.head != null) turn.push(Math.abs(wrap(s.head, head)) / dt);
        s.head = head;
        const rel = Math.abs(wrap(b.bodyYaw, head));
        skew.push(rel);
        if (b.state !== 'combat') { if (rel > 2.2) backpedal++; else if (rel > 0.9) sidestep++; }
        const c = clearanceTo(cols, b.pos.x, b.pos.z, b.pos.y) - 0.39;
        clear.push(c); if (c < 0.12) hug++;
      } else { s.head = null; if (b.state !== 'combat' && b.wishSpeed > 0.5) idle++; }
      if (sp < 0.25 && s.fast && b.state !== 'combat') { stops++; s.fast = false; } else if (sp > 1.4) s.fast = true;
      if (b.stuckT < s.stuckT && s.stuckT > 0.85) stuck++;
      s.stuckT = b.stuckT;
      if (b.scraped) { scrape++; b.scraped = false; }
      lean.push(Math.hypot(b.leanF, b.leanS));
      // While the stride has a boot bearing weight, its sole should stay where it landed: track how far it wanders.
      // Outside that, a sole close to the ground and moving is a boot skimming or dragging.
      let grounded = 0;
      for (let i = 0; i < 2; i++) {
        const f = feet[i], p = s.feet[i], ground = b.footGround ? b.footGround[i] : b.floorY;
        const low = f.y - ground < 0.014 && Math.abs(f.y - p.y) / dt < 0.2, d = Math.hypot(f.x - p.x, f.z - p.z);
        if (f.y - ground < -0.03) sunk++;
        if (f.y - ground < 0.05) grounded++;
        const bearing = !!b.plants[i] && low, hold = s.hold[i];
        if (!bearing && low && d / dt > 0.8) skim++;
        if (!bearing || (hold && hold.toe !== f.toe)) {
          if (hold && hold.n > 3) { drift.push(hold.far); contactLen.push(hold.n * dt); }
          s.hold[i] = bearing ? { x: f.x, z: f.z, toe: f.toe, far: 0, n: 0 } : null;
          continue;
        }
        if (!hold) { s.hold[i] = { x: f.x, z: f.z, toe: f.toe, far: 0, n: 0 }; continue; }
        hold.far = Math.max(hold.far, Math.hypot(f.x - hold.x, f.z - hold.z)); hold.n++;
        contactT += dt; slipDist += d; slipSpeed.push(d / dt);
      }
      if (!grounded && sp < 4) airborne++;
      for (const o of G.bots.list) if (o !== b && o.alive && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < 0.6 && Math.abs(o.pos.y - b.pos.y) < 0.9) { crowd++; break; }
      if (trace === b || (trace === true && b === G.bots.list[0])) traceOut.push([r2(k * dt), r2(b.pos.x), r2(b.pos.z), r2(sp), r2(b.yaw), r2(b.bodyYaw), r2(a), r2(b.phase), b.state, r2(b.pos.y)]);
      if (each) each(b, k, { sp, a, vx, vz });
      s.x = b.pos.x; s.z = b.pos.z; s.vx = vx; s.vz = vz; s.ax = ax; s.az = az; s.yaw = b.yaw; s.body = b.bodyYaw; s.feet = feet;
    }
  }
  const mins = frames * dt / 60;
  return {
    soldierSeconds: r2(frames * dt), metres: r2(travel), movingShare: r2(moving / Math.max(1, frames)),
    speed: { median: r2(pct(speeds, 0.5)), p90: r2(pct(speeds, 0.9)), max: r2(pct(speeds, 1)) },
    accel: { median: r2(pct(acc, 0.5)), p95: r2(pct(acc, 0.95)), p99: r2(pct(acc, 0.99)), max: r2(pct(acc, 1)) },
    jerk: { p95: r2(pct(jerk, 0.95)), p99: r2(pct(jerk, 0.99)) },
    pathTurnRate: { median: r2(pct(turn, 0.5)), p95: r2(pct(turn, 0.95)), p99: r2(pct(turn, 0.99)), max: r2(pct(turn, 1)) },
    aimTurnRate: { p95: r2(pct(yawRate, 0.95)), max: r2(pct(yawRate, 1)) },
    pelvisTurnRate: { p95: r2(pct(bodyRate, 0.95)), max: r2(pct(bodyRate, 1)), snaps },
    bodyVsTravel: { median: r2(pct(skew, 0.5)), p95: r2(pct(skew, 0.95)) },
    soleSlip: { cmPerMetre: r2(slipDist * 100 / Math.max(0.01, travel)), driftCmP50: r2(pct(drift, 0.5) * 100), driftCmP95: r2(pct(drift, 0.95) * 100), speedP95: r2(pct(slipSpeed, 0.95)), contactSecP50: r2(pct(contactLen, 0.5)), contactShare: r2(contactT / Math.max(dt, frames * dt) / 2) },
    wallClearance: { median: r2(pct(clear, 0.5)), p05: r2(pct(clear, 0.05)), huggingShare: r2(hug / Math.max(1, moving)) },
    perMinute: { stops: r2(stops / mins), stuck: r2(stuck / mins), scrapes: r2(scrape / mins) },
    share: { backpedalOutOfCombat: r2(backpedal / Math.max(1, moving)), sidestepOutOfCombat: r2(sidestep / Math.max(1, moving)), waitingWithAGoal: r2(idle / Math.max(1, frames)), bothBootsOffGround: r2(airborne / Math.max(1, frames)), bodiesOverlapping: Math.round(crowd / Math.max(1, frames) * 1000) / 1000, bootSkimming: r2(skim / Math.max(1, frames * 2)), bootBelowGround: r2(sunk / Math.max(1, frames * 2)) },
    leanP95: r2(pct(lean, 0.95)),
    trace: traceOut.length ? traceOut : undefined,
  };
}

export function patrol(G, secs = 60, opts = {}) { begin(G, opts); unrendered(G, () => G.step(120, 1 / 30)); return watch(G, secs, opts); }

// Contact sheet: `cols` x `rows` frames of one soldier, camera travelling with it at a fixed bearing.
export async function sheet(G, name, { bot = G.bots.list[0], secs = 2, cols = 8, rows = 3, cell = 300, bearing = 90, dist = 4.2, height = 1.0, dt = 1 / 60, world = false, exposure = 0 } = {}) {
  const R = G.R, cv = R.renderer.domElement, n = cols * rows, every = Math.max(1, Math.round(secs / dt / n));
  const keep = { w: cv.style.width, h: cv.style.height, weapon: G.weapon.root.visible, hud: document.getElementById('hud')?.style.display };
  cv.style.width = cell + 'px'; cv.style.height = cell + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  const out = document.createElement('canvas'); out.width = cols * cell; out.height = rows * cell;
  const ctx = out.getContext('2d'); let wall = performance.now() / 1000;
  const fixed = world ? { x: bot.pos.x, z: bot.pos.z, yaw: bot.bodyYaw } : null, auto = R.autoExposure;
  if (exposure) { R.autoExposure = false; R.exposureTarget = exposure; for (let k = 0; k < 5; k++) R.render(2, wall); }       // a soldier in shade: open up by hand
  for (let i = 0; i < n; i++) {
    G.step(every, dt); wall += every * dt;
    const yaw = (fixed ? fixed.yaw : bot.bodyYaw) + bearing * Math.PI / 180;
    const cx = fixed ? fixed.x : bot.pos.x, cz = fixed ? fixed.z : bot.pos.z;
    R.camera.position.set(cx + Math.sin(yaw) * dist, bot.pos.y + height + 0.25, cz + Math.cos(yaw) * dist);
    R.camera.lookAt(bot.pos.x, bot.pos.y + height, bot.pos.z);
    R.camera.fov = 28; R.camera.updateProjectionMatrix();
    G.weapon.root.visible = false;
    R.render(dt, wall);
    ctx.drawImage(cv, 0, 0, cv.width, cv.height, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
    G.weapon.root.visible = keep.weapon;
  }
  cv.style.width = keep.w; cv.style.height = keep.h; R.resize(); R.autoExposure = auto;
  const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.9));
  await fetch('/__capture/' + name + '.jpg', { method: 'POST', body: blob });
  return `${name}.jpg ${out.width}x${out.height}, one frame every ${(every * dt * 1000).toFixed(0)} ms`;
}

// Top-down plot of where the soldiers went: walls in grey, trails coloured by speed (blue slow, red fast).
export async function map(G, name, secs = 60, { dt = 1 / 60, scale = 9, x0 = -48, x1 = 48, z0 = -82, z1 = 82, teams = [0], fresh = true } = {}) {
  if (fresh) { begin(G, { teams }); unrendered(G, () => G.step(60, 1 / 30)); }
  const render = G.R.render; G.R.render = () => {};
  const cv = document.createElement('canvas'); cv.width = (x1 - x0) * scale; cv.height = (z1 - z0) * scale;
  const c = cv.getContext('2d'), X = x => (x - x0) * scale, Z = z => (z1 - z) * scale;
  c.fillStyle = '#14171c'; c.fillRect(0, 0, cv.width, cv.height);
  for (const b of G.world.colliders) {
    if (b.y1 < 0.5 || b.y0 > 1.6) continue;
    c.save(); c.translate(X(b.x), Z(b.z)); c.rotate(Math.atan2(b.s, b.c));
    c.fillStyle = b.y1 >= 1.6 ? '#59616d' : '#3a424d'; c.fillRect(-b.hx * scale, -b.hz * scale, b.hx * 2 * scale, b.hz * 2 * scale); c.restore();
  }
  const last = new Map();
  for (let k = 0, n = Math.round(secs / dt); k < n; k++) {
    G.step(1, dt); G.player.health = 100;
    for (const b of G.bots.list) {
      if (!b.alive) { last.delete(b); continue; }
      const p = last.get(b);
      if (p) {
        const sp = Math.hypot(b.pos.x - p.x, b.pos.z - p.z) / dt;
        c.strokeStyle = `hsl(${Math.max(0, 230 - sp * 46)} 90% 60%)`; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(X(p.x), Z(p.z)); c.lineTo(X(b.pos.x), Z(b.pos.z)); c.stroke();
        if (k % 30 === 0) { c.fillStyle = '#fff'; c.fillRect(X(b.pos.x) - 1.5, Z(b.pos.z) - 1.5, 3, 3); c.strokeStyle = '#fff'; c.lineWidth = 1; c.beginPath(); c.moveTo(X(b.pos.x), Z(b.pos.z)); c.lineTo(X(b.pos.x + Math.sin(b.yaw) * 0.9), Z(b.pos.z + Math.cos(b.yaw) * 0.9)); c.stroke(); }
      }
      last.set(b, { x: b.pos.x, z: b.pos.z });
    }
  }
  G.R.render = render;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  await fetch('/__capture/' + name + '.png', { method: 'POST', body: blob });
  return `${name}.png ${cv.width}x${cv.height}`;
}

// One soldier under direct orders (no decisions of its own): walk `dir` at `speed` from a chosen spot, facing `yaw`.
export function drive(G, { i = 0, x = 0, z = -52, yaw = 0, dir = [0, 1], speed = 1.7, state = 'advance', settle = 2.5 } = {}) {
  G.manual = true; G.auto = true; G.frozen = true;
  if (!G.matchLive) { G.resetMatch(); G.playing = true; G.hud.show(null); }
  G.player.sim = { f: 0, s: 0 }; G.goto(44, -79, 0);
  for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; }
  const b = G.bots.list[i]; b.spawn({ x, z, yaw });
  b.think = 1e9; b.state = state; b.wantYaw = yaw; b.wishDir = speed > 0 ? { x: dir[0], z: dir[1] } : null; b.wishSpeed = speed;
  unrendered(G, () => G.step(Math.round(settle * 60), 1 / 60));
  return b;
}

// Frames for a film of one soldier, shot from a camera that walks with it. Posts name_0001.jpg … to captures/;
// join them with: ffmpeg -framerate 30 -i captures/name_%04d.jpg -pix_fmt yuv420p captures/name.mp4
// Call again with the returned state to continue the same shot (a browser task should not run for minutes).
export async function film(G, name, state = {}, { bot = G.bots.list[0], frames = 150, fps = 30, w = 854, h = 480, bearing = 150, dist = 5.2, height = 1.05, fov = 34, exposure = 0, each = null } = {}) {
  const R = G.R, cv = R.renderer.domElement, dt = 1 / 60, per = Math.round(60 / fps), cols = G.world.colliders;
  if (state.n == null) { state.n = 0; state.yaw = bot.heading; state.wall = performance.now() / 1000; state.dist = dist; state.x = bot.pos.x; state.z = bot.pos.z; }
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  const weapon = G.weapon.root.visible, wrap = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)), shots = [];
  const auto = R.autoExposure;
  if (exposure) { R.autoExposure = false; R.exposureTarget = exposure; for (let k = 0; k < 5; k++) R.render(2, state.wall); }
  for (let i = 0; i < frames; i++) {
    for (let k = 0; k < per; k++) { if (each && each(bot, state) === false) { frames = i; break; } G.step(1, dt); }
    state.wall += per * dt;
    // the camera operator: follows the soldier's line of march loosely and steps closer when a wall gets in the way
    state.yaw += wrap(state.yaw, bot.heading) * 0.03;
    state.x += (bot.pos.x - state.x) * 0.25; state.z += (bot.pos.z - state.z) * 0.25;
    const a = state.yaw + bearing * Math.PI / 180, dx = Math.sin(a), dz = Math.cos(a);
    let free = dist;
    for (const c of cols) {
      if (c.y1 < 1.3 || c.y0 > 1.7) continue;
      for (let s = 0.6; s < free; s += 0.3) {
        const px = state.x + dx * s - c.x, pz = state.z + dz * s - c.z, lx = px * c.c - pz * c.s, lz = px * c.s + pz * c.c;
        if (Math.abs(lx) < c.hx + 0.3 && Math.abs(lz) < c.hz + 0.3) { free = Math.max(1.6, s - 0.3); break; }
      }
    }
    state.dist += (free - state.dist) * (free < state.dist ? 0.5 : 0.04);
    R.camera.position.set(state.x + dx * state.dist, bot.pos.y + height + 0.45, state.z + dz * state.dist);
    R.camera.lookAt(state.x, bot.pos.y + height, state.z);
    R.camera.fov = fov; R.camera.updateProjectionMatrix();
    G.weapon.root.visible = false;
    R.render(per * dt, state.wall);
    // encoded on the spot (no waiting on the browser between frames, which crawls when the page is in the background)
    const data = atob(cv.toDataURL('image/jpeg', 0.9).split(',')[1]), bytes = new Uint8Array(data.length);
    for (let k = 0; k < data.length; k++) bytes[k] = data.charCodeAt(k);
    shots.push(fetch('/__capture/' + name + '_' + String(++state.n).padStart(4, '0') + '.jpg', { method: 'POST', body: bytes }));
    G.weapon.root.visible = weapon;
  }
  await Promise.all(shots);
  R.autoExposure = auto;
  return state;
}

// How steady the body is on a straight walk: peak-to-peak swing of the pelvis, shoulders, head and rifle over `secs`,
// in degrees and centimetres. A person's head barely moves; the pelvis lists and turns a few degrees each way.
export function posture(G, { speed = 1.6, secs = 4, x = -29, z = -58, i = 0 } = {}) {
  const T = G.THREE, b = drive(G, { i, speed, x, z, settle: 3 }), deg = 180 / Math.PI;
  const lh = new T.Vector3(), rh = new T.Vector3(), ls = new T.Vector3(), rs = new T.Vector3(), hip = new T.Vector3(), neck = new T.Vector3(), head = new T.Vector3();
  const fwd = new T.Vector3(), up = new T.Vector3(), q = new T.Quaternion(), gun = new T.Vector3(), stock = new T.Vector3();
  const series = {}, add = (k, v) => (series[k] || (series[k] = [])).push(v);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  unrendered(G, () => {
    for (let k = 0, n = Math.round(secs * 60); k < n; k++) {
      G.step(1, 1 / 60);
      const h = b.heading, fx = Math.sin(h), fz = Math.cos(h), sx = fz, sz = -fx;       // forward and sideways on the ground
      b.b.lul.getWorldPosition(lh); b.b.rul.getWorldPosition(rh); b.b.la.getWorldPosition(ls); b.b.ra.getWorldPosition(rs);
      b.b.hips.getWorldPosition(hip); b.b.neck.getWorldPosition(neck); b.b.head.getWorldPosition(head);
      const line = (a, c, name) => {
        const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, across = dx * sx + dz * sz, along = dx * fx + dz * fz;
        add(name + 'RollDeg', Math.atan2(dy, Math.hypot(across, along)) * Math.sign(across || 1) * deg); add(name + 'TurnDeg', Math.atan2(along * Math.sign(across || 1), Math.abs(across)) * deg);
      };
      line(lh, rh, 'pelvis'); line(ls, rs, 'shoulders');
      const tx = neck.x - hip.x, ty = neck.y - hip.y, tz = neck.z - hip.z;
      add('trunkSideLeanDeg', Math.atan2(tx * sx + tz * sz, ty) * deg); add('trunkForwardLeanDeg', Math.atan2(tx * fx + tz * fz, ty) * deg);
      b.b.head.getWorldQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q);
      add('headTurnDeg', wrap(Math.atan2(fwd.x, fwd.z) - h) * deg); add('headNodDeg', Math.asin(Math.max(-1, Math.min(1, fwd.y))) * deg);
      add('headTiltDeg', Math.asin(Math.max(-1, Math.min(1, up.x * sx + up.z * sz))) * deg);
      add('headSideCm', ((head.x - b.pos.x) * sx + (head.z - b.pos.z) * sz) * 100); add('headHeightCm', (head.y - b.pos.y) * 100);
      add('hipSideCm', ((hip.x - b.pos.x) * sx + (hip.z - b.pos.z) * sz) * 100); add('hipHeightCm', (hip.y - b.pos.y) * 100);
      b.gun.localToWorld(gun.set(0, 0, -0.5)); b.gun.localToWorld(stock.set(0, 0, 0.3));
      const gx = gun.x - stock.x, gy = gun.y - stock.y, gz = gun.z - stock.z;
      add('rifleTurnDeg', wrap(Math.atan2(gx, gz) - h) * deg); add('riflePitchDeg', Math.atan2(gy, Math.hypot(gx, gz)) * deg);
      add('rifleHeightCm', (stock.y - b.pos.y) * 100);
      add('figureLeanDeg', Math.hypot(b.leanF, b.leanS) * deg); add('headingDeg', h * deg);
    }
  });
  const out = { speed: r2(b.speed) };
  for (const [k, v] of Object.entries(series)) { const lo = Math.min(...v), hi = Math.max(...v); out[k] = { swing: r2(hi - lo), mean: r2(v.reduce((a, c) => a + c, 0) / v.length) }; }
  return out;
}

// Walks one soldier across a kerb and back and reports how violently the legs move: the fastest any ankle travels
// relative to the hips, the hardest it is thrown about, and the biggest change of knee angle in one frame.
// `legs` lists three way-points [x, z]; pass points on level ground for a baseline.
export function steps(G, { speed = 1.6, from = [2.4, -52], legs = [[5.0, -47.5], [5.0, -44], [2.4, -39.5]], i = 0, trace = false } = {}) {
  const T = G.THREE, b = drive(G, { i, speed: 0, x: from[0], z: from[1], settle: 0.5 }), deg = 180 / Math.PI;
  const ank = [new T.Vector3(), new T.Vector3()], knee = new T.Vector3(), hipj = new T.Vector3(), hips = new T.Vector3();
  const prev = [null, null], out = { ankleSpeed: 0, ankleAccel: 0, ankleLift: 0, kneeStepDeg: 0, hipDrop: 0, bodyStep: 0, worst: [] }, rows = [];
  let leg = 0, t = 0, lastY = b.pos.y, lastHip = null;
  unrendered(G, () => {
    while (leg < legs.length && t < 40) {
      const [gx, gz] = legs[leg], dx = gx - b.pos.x, dz = gz - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) { leg++; continue; }
      b.wishDir = { x: dx / d, z: dz / d }; b.wishSpeed = speed; b.state = 'advance';
      G.step(1, 1 / 60); t += 1 / 60;
      b.b.hips.getWorldPosition(hips);
      [[b.b.lul, b.b.ll, b.b.lft], [b.b.rul, b.b.rl, b.b.rft]].forEach(([thigh, shin, foot], s) => {
        thigh.getWorldPosition(hipj); shin.getWorldPosition(knee); foot.getWorldPosition(ank[s]);
        const a = knee.clone().sub(hipj), c = ank[s].clone().sub(knee), bend = a.angleTo(c) * deg;
        const rel = ank[s].clone().sub(hips), p = prev[s];
        if (p) {
          const v = rel.clone().sub(p.rel).multiplyScalar(60), acc = p.v ? v.clone().sub(p.v).length() * 60 : 0, kd = Math.abs(bend - p.bend);
          if (v.length() > out.ankleSpeed) out.ankleSpeed = v.length();
          if (acc > out.ankleAccel) out.ankleAccel = acc;
          if (Math.abs(v.y) > out.ankleLift) out.ankleLift = Math.abs(v.y);
          if (kd > out.kneeStepDeg) out.kneeStepDeg = kd;
          if (acc > 260 || kd > 9) out.worst.push([r2(t), s ? 'R' : 'L', 'acc', Math.round(acc), 'knee', r2(kd), 'at', r2(b.pos.x), r2(b.pos.z), 'y', r2(b.pos.y), b.plants[s] ? 'planted' : 'swing']);
          prev[s] = { rel, v, bend };
        } else prev[s] = { rel, v: null, bend };
        if (trace) rows.push([r2(t), s, r2(ank[s].y), r2(b.footGround[s]), r2(bend), b.plants[s] ? 1 : 0, r2(b.pos.y), r2(b.floorY), r2(b.pos.x)].join(' '));
      });
      out.bodyStep = Math.max(out.bodyStep, Math.abs(b.pos.y - lastY) * 60); lastY = b.pos.y;
      if (lastHip != null) out.hipDrop = Math.max(out.hipDrop, Math.abs(hips.y - lastHip) * 60); lastHip = hips.y;
    }
  });
  for (const k of ['ankleSpeed', 'ankleAccel', 'ankleLift', 'kneeStepDeg', 'hipDrop', 'bodyStep']) out[k] = r2(out[k]);
  out.jolts = out.worst.length; out.worst = out.worst.slice(0, 10); out.secs = r2(t);
  if (trace) out.rows = rows;
  return out;
}

// ---- jolt hunting ----------------------------------------------------------------------------------------------------
// A jolt is a joint changing its motion abruptly between one frame and the next: the knee's bending rate jumping, an
// ankle thrown about, a boot's attitude snapping, the pelvis kicked. Smooth motion, however fast, does not count.
const JOLT = { knee: 9, ankle: 330, boot: 9, pelvis: 70 };       // °/frame², m/s², °/frame², m/s²

export function legWatch(G) {
  const T = G.THREE, hipj = new T.Vector3(), kneej = new T.Vector3(), q = new T.Quaternion();
  const mem = new Map();
  return (b, note) => {
    let m = mem.get(b);
    if (!m) mem.set(b, m = { leg: [{}, {}], hips: [] });
    const found = [];
    [[b.b.lul, b.b.ll, b.b.lft], [b.b.rul, b.b.rl, b.b.rft]].forEach(([thigh, shin, foot], s) => {
      const L = m.leg[s], ank = new T.Vector3();
      thigh.getWorldPosition(hipj); shin.getWorldPosition(kneej); foot.getWorldPosition(ank); foot.getWorldQuaternion(q);
      const bend = kneej.clone().sub(hipj).angleTo(ank.clone().sub(kneej)) * 180 / Math.PI;
      const rate = L.bend != null ? bend - L.bend : null, spin = L.q ? L.q.angleTo(q) * 180 / Math.PI : null;
      const kneeJ = rate != null && L.rate != null ? Math.abs(rate - L.rate) : 0;
      const ankleA = L.p1 && L.p2 ? ank.clone().addScaledVector(L.p1, -2).add(L.p2).length() * 3600 : 0;
      const bootJ = spin != null && L.spin != null ? Math.abs(spin - L.spin) : 0;
      if (kneeJ > JOLT.knee) found.push({ what: 'knee', size: r2(kneeJ), side: s ? 'R' : 'L' });
      if (ankleA > JOLT.ankle) found.push({ what: 'ankle', size: Math.round(ankleA), side: s ? 'R' : 'L' });
      if (bootJ > JOLT.boot) found.push({ what: 'boot', size: r2(bootJ), side: s ? 'R' : 'L' });
      L.rate = rate; L.bend = bend; L.spin = spin; L.q = (L.q || new T.Quaternion()).copy(q); L.p2 = L.p1; L.p1 = ank;
      L.kneeJ = kneeJ; L.ankleA = ankleA; L.bootJ = bootJ;
    });
    const h = b.b.hips.getWorldPosition(new T.Vector3()), H = m.hips;
    const pelvisA = H.length === 2 ? h.clone().addScaledVector(H[1], -2).add(H[0]).length() * 3600 : 0;
    if (pelvisA > JOLT.pelvis) found.push({ what: 'pelvis', size: Math.round(pelvisA), side: '-' });
    H.push(h); if (H.length > 2) H.shift();
    m.last = { knee: Math.max(m.leg[0].kneeJ, m.leg[1].kneeJ), ankle: Math.max(m.leg[0].ankleA, m.leg[1].ankleA), boot: Math.max(m.leg[0].bootJ, m.leg[1].bootJ), pelvis: pelvisA, bend: [m.leg[0].bend, m.leg[1].bend] };
    return { found, last: m.last, forget: () => mem.delete(b) };
  };
}

const context = b => {
  const g = b.gaitBlend, plant = s => (b.plants[s] ? 'P' + b.plants[s].part : b.releasedPlants[s] ? 'r' : '-');
  return `ph ${b.phase.toFixed(2)} sp ${b.speed.toFixed(2)} move ${(b.moveBlend ?? 0).toFixed(2)} run ${b.runGait.toFixed(2)} piv ${(b.pivotBlend ?? 0).toFixed(2)} dir ${(g.left + g.right).toFixed(2)}/${g.back.toFixed(2)} cr ${b.crouch.toFixed(2)} feet ${plant(0)}${plant(1)} y ${b.pos.y.toFixed(2)} ${b.state}${b.dash ? 'D' : ''}`;
};

// One soldier put through a scripted move. `script(bot, t)` sets its orders each frame; returns false to end.
export function jolts(G, script, { secs = 6, x = -11, z = 4, yaw = 0, state = 'advance', trace = null } = {}) {
  const b = drive(G, { speed: 0, x, z, yaw, state, settle: 0.6 }), watchLegs = legWatch(G);
  const events = [], peak = { knee: 0, ankle: 0, boot: 0, pelvis: 0 }, rows = [];
  unrendered(G, () => {
    for (let k = 0, n = Math.round(secs * 60); k < n; k++) {
      const t = k / 60;
      if (script(b, t) === false) break;
      G.step(1, 1 / 60);
      const w = watchLegs(b);
      if (k < 3) continue;
      for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], w.last[key]);
      for (const f of w.found) events.push(`${t.toFixed(2)} ${f.what} ${f.side} ${f.size} | ${context(b)}`);
      if (trace && t >= trace[0] && t <= trace[1]) rows.push(`${t.toFixed(2)} knee ${w.last.bend.map(v => v.toFixed(0)).join('/')} J ${w.last.knee.toFixed(1)} ank ${Math.round(w.last.ankle)} boot ${w.last.boot.toFixed(1)} pel ${Math.round(w.last.pelvis)} | ${context(b)}`);
    }
  });
  return { jolts: events.length, peak: { knee: r2(peak.knee), ankle: Math.round(peak.ankle), boot: r2(peak.boot), pelvis: Math.round(peak.pelvis) }, events: events.slice(0, 14), rows: rows.length ? rows : undefined };
}

// The standard battery: every way a soldier moves and every change from one to another.
export const MOVES = {
  walk: { script: (b, t) => { b.wishDir = { x: 0, z: 1 }; b.wishSpeed = t < 4.2 ? 1.6 : 0; }, secs: 6, x: 28.5, z: -58 },
  fastWalk: { script: (b, t) => { b.wishDir = { x: 0, z: 1 }; b.wishSpeed = t < 4 ? 2.05 : 0; }, secs: 5.5, x: 28.5, z: -58 },
  run: { script: (b, t) => { b.wishDir = { x: 0, z: 1 }; b.wishSpeed = t < 3.4 ? 4.6 : 0; }, secs: 6, x: 28.5, z: -58 },
  walkRunWalk: { script: (b, t) => { b.wishDir = { x: 0, z: 1 }; b.wishSpeed = t < 1.8 ? 1.6 : t < 3.6 ? 4.4 : 1.6; }, secs: 6.5, x: 28.5, z: -58 },
  arcWalk: { script: (b, t) => { const a = t * 0.9; b.wishDir = { x: Math.sin(a), z: Math.cos(a) }; b.wishSpeed = 1.6; }, secs: 7 },
  arcRun: { script: (b, t) => { const a = t * 0.55; b.wishDir = { x: Math.sin(a), z: Math.cos(a) }; b.wishSpeed = 3.8; }, secs: 6, x: -11, z: -2 },
  aboutFace: { script: (b, t) => { b.wishDir = { x: 0, z: t < 2.2 ? 1 : -1 }; b.wishSpeed = 1.6; }, secs: 6, x: 28.5, z: -52 },
  turnOnSpot: { script: (b, t) => { b.wishDir = null; b.wishSpeed = 0; b.wantYaw = t < 0.5 ? 0 : t < 2.4 ? 1.6 : t < 4.4 ? -1.3 : 3.0; }, secs: 6.5 },
  aimTurn: { state: 'combat', script: (b, t) => { b.wishDir = null; b.wishSpeed = 0; b.wantYaw = t < 0.5 ? 0 : t < 2.2 ? 1.5 : t < 4 ? -1.6 : 2.9; }, secs: 6 },
  strafe: { state: 'combat', script: (b, t) => { b.wantYaw = 0; const d = t < 0.4 ? 0 : t < 2.2 ? 1 : t < 2.9 ? 0 : t < 4.6 ? -1 : t < 6 ? 1 : 0; b.wishDir = d ? { x: d, z: 0 } : null; b.wishSpeed = d ? 2.1 : 0; }, secs: 7 },
  backpedal: { state: 'combat', script: (b, t) => { b.wantYaw = 0; const on = t > 0.4 && t < 3; b.wishDir = on ? { x: 0, z: -1 } : null; b.wishSpeed = on ? 2 : 0; }, secs: 4.5, z: 10 },
  crouchBack: { state: 'combat', script: (b, t) => { b.wantYaw = 0; b.crouching = t > 0.3; const on = t > 0.9 && t < 3.4; b.wishDir = on ? { x: 0, z: -1 } : null; b.wishSpeed = on ? 2 : 0; }, secs: 5, z: 10 },
  boxStep: { state: 'combat', script: (b, t) => { b.wantYaw = 0; const k = Math.floor(t / 1.3) % 4, d = [[0, 1], [1, 0], [0, -1], [-1, 0]][k]; b.wishDir = { x: d[0], z: d[1] }; b.wishSpeed = 2; }, secs: 8 },
  strafeAndTurn: { state: 'combat', script: (b, t) => { b.wantYaw = Math.sin(t * 0.9) * 1.2; b.wishDir = { x: Math.floor(t / 1.6) % 2 ? -1 : 1, z: 0 }; b.wishSpeed = 2; }, secs: 7 },
  crouch: { state: 'combat', script: (b, t) => { b.wantYaw = 0; b.wishDir = null; b.wishSpeed = 0; b.crouching = (t > 0.8 && t < 2.6) || (t > 3.6 && t < 5); }, secs: 6 },
  crouchTurn: { state: 'combat', script: (b, t) => { b.crouching = t > 0.4; b.wishDir = null; b.wishSpeed = 0; b.wantYaw = t < 1.4 ? 0 : t < 3 ? 1.4 : t < 4.6 ? -1.2 : 2.6; }, secs: 6.5 },
  crouchStrafe: { state: 'combat', script: (b, t) => { b.wantYaw = 0; b.crouching = t > 0.3; const d = t < 0.9 ? 0 : t < 2.6 ? 1 : t < 3.2 ? 0 : t < 4.9 ? -1 : 0; b.wishDir = d ? { x: d, z: 0 } : null; b.wishSpeed = d ? 2 : 0; }, secs: 6 },
  crouchWalk: { state: 'combat', script: (b, t) => { b.wantYaw = 0; b.crouching = t > 0.3; const on = t > 0.9 && t < 4; b.wishDir = on ? { x: 0, z: 1 } : null; b.wishSpeed = on ? 2 : 0; }, secs: 5.5 },
  crouchMidStride: { state: 'combat', script: (b, t) => { b.wantYaw = 0; b.wishDir = { x: 1, z: 0 }; b.wishSpeed = 2; b.crouching = (t > 1.2 && t < 2.6) || (t > 3.8 && t < 5); }, secs: 6 },
  walkToAim: { script: (b, t) => { const fight = t > 2 && t < 4.2; b.state = fight ? 'combat' : 'advance'; b.wantYaw = fight ? 1.3 : null; b.wishDir = { x: 0, z: 1 }; b.wishSpeed = fight ? 2 : 1.6; }, secs: 6.5, x: 28.5, z: -58 },
  kerb: { script: (b, t) => { const legs = [[5.0, -47.5], [5.0, -44], [2.4, -39.5]]; b.leg = b.leg || 0; while (b.leg < 3 && Math.hypot(legs[b.leg][0] - b.pos.x, legs[b.leg][1] - b.pos.z) < 0.35) b.leg++; if (b.leg >= 3) return false; const dx = legs[b.leg][0] - b.pos.x, dz = legs[b.leg][1] - b.pos.z, d = Math.hypot(dx, dz); b.wishDir = { x: dx / d, z: dz / d }; b.wishSpeed = 1.6; }, secs: 12, x: 2.4, z: -52, yaw: 0.52 },
  kerbRun: { script: (b, t) => { const legs = [[5.0, -47.5], [5.0, -44], [2.4, -39.5]]; b.leg = b.leg || 0; while (b.leg < 3 && Math.hypot(legs[b.leg][0] - b.pos.x, legs[b.leg][1] - b.pos.z) < 0.35) b.leg++; if (b.leg >= 3) return false; const dx = legs[b.leg][0] - b.pos.x, dz = legs[b.leg][1] - b.pos.z, d = Math.hypot(dx, dz); b.wishDir = { x: dx / d, z: dz / d }; b.wishSpeed = 3.6; }, secs: 8, x: 2.4, z: -52, yaw: 0.52 },
};

export function battery(G, names = Object.keys(MOVES)) {
  const out = {};
  for (const name of names) {
    const m = MOVES[name]; G.bots.list[0].leg = 0;
    const r = jolts(G, m.script, m);
    out[name] = `${r.jolts} jolts | knee ${r.peak.knee} ankle ${r.peak.ankle} boot ${r.peak.boot} pelvis ${r.peak.pelvis}` + (r.events.length ? ' | first: ' + r.events.slice(0, 2).join(' ;; ') : '');
  }
  return out;
}

// The same watch over every soldier in a real match: how many jolts per soldier-minute and what they were doing.
export function matchJolts(G, secs = 120, { teams = [0, 1], seed = 0 } = {}) {
  begin(G, { teams, seed });
  const watchLegs = legWatch(G), tally = {}, events = [], fresh = new Map();
  let frames = 0, hard = 0;
  unrendered(G, () => {
    for (let k = 0, n = Math.round(secs * 60); k < n; k++) {
      G.step(1, 1 / 60); G.player.health = 100;
      for (const b of G.bots.list) {
        if (!b.alive) { if (fresh.has(b)) { watchLegs(b).forget(); fresh.delete(b); } continue; }
        const w = watchLegs(b), age = (fresh.get(b) || 0) + 1; fresh.set(b, age);
        if (age < 4) continue;
        frames++;
        for (const f of w.found) {
          if (f.size > JOLT[f.what] * 1.6) hard++;
          const g = b.gaitBlend, kind = (b.crouch > 0.3 ? 'crouch ' : '') + (g.left + g.right > 0.4 ? 'strafe' : g.back > 0.4 ? 'back' : (b.pivotBlend ?? 0) > 0.3 ? 'turn' : b.runGait > 0.5 ? 'run' : b.speed > 0.3 ? 'walk' : 'stand') + ' ' + f.what;
          tally[kind] = (tally[kind] || 0) + 1;
          if (events.length < 24 && (tally[kind] <= 3)) events.push(`${(k / 60).toFixed(2)} ${b.team}.${b.idx} ${f.what} ${f.side} ${f.size} | ${context(b)}`);
        }
      }
    }
  });
  const minutes = frames / 3600, total = Object.values(tally).reduce((a, c) => a + c, 0);
  return { perSoldierMinute: r2(total / Math.max(0.01, minutes)), hardPerSoldierMinute: r2(hard / Math.max(0.01, minutes)), by: Object.fromEntries(Object.entries(tally).sort((a, c) => c[1] - a[1])), events };
}

// For chasing one down: plays a match and returns the few frames either side of the worst jolts, with everything the
// foot placement knew at the time.
export function autopsy(G, secs = 90, { teams = [0, 1], seed = 0, want = 3, size = { knee: 12, ankle: 600, boot: 14, pelvis: 110 } } = {}) {
  begin(G, { teams, seed });
  const T = G.THREE, watchLegs = legWatch(G), tape = new Map(), cases = [], open = [], a = new T.Vector3(), age = new Map();
  const line = (b, t, w) => [0, 1].map(s => {
    const pl = b.plants[s], rl = b.releasedPlants[s], g = b.footGoal[s], an = b.footAnim[s];
    (s ? b.b.rft : b.b.lft).getWorldPosition(a);
    return `${s ? 'R' : 'L'} ank ${a.x.toFixed(2)},${a.y.toFixed(3)},${a.z.toFixed(2)} goal ${g.p.x.toFixed(2)},${g.p.y.toFixed(3)},${g.p.z.toFixed(2)} anim ${an.p.x.toFixed(2)},${an.p.y.toFixed(3)},${an.p.z.toFixed(2)} ` +
      (pl ? `P${pl.part} off ${Math.hypot(pl.dx, pl.dz).toFixed(3)} tip ${(pl.tip || 0).toFixed(2)} gnd ${pl.ground.toFixed(2)}` : rl ? `rel k ${(rl.k ?? 1).toFixed(2)}/${rl.over.toFixed(2)} off ${Math.hypot(rl.dx, rl.dz).toFixed(3)} tip ${(rl.tip || 0).toFixed(2)}` : 'free') +
      ` fg ${b.footGround[s].toFixed(3)}/${b.footAim[s].toFixed(3)} knee ${w.last.bend[s].toFixed(0)}`;
  }).join(' || ') + ` || t ${t.toFixed(2)} ${context(b)} floor ${b.floorY.toFixed(2)} rise ${b.rise.toFixed(3)} give ${(b.hipDrop * 100).toFixed(1)} body ${b.bodyYaw.toFixed(2)} yaw ${b.yaw.toFixed(2)} J ${w.last.knee.toFixed(1)}/${Math.round(w.last.ankle)}/${w.last.boot.toFixed(1)}/${Math.round(w.last.pelvis)}`;
  unrendered(G, () => {
    for (let k = 0, n = Math.round(secs * 60); k < n && (cases.length < want || open.length); k++) {
      G.step(1, 1 / 60); G.player.health = 100;
      for (const b of G.bots.list) {
        if (!b.alive) { if (age.has(b)) { watchLegs(b).forget(); age.delete(b); tape.delete(b); } continue; }
        const w = watchLegs(b), n2 = (age.get(b) || 0) + 1; age.set(b, n2);
        const rows = tape.get(b) || tape.set(b, []).get(b);
        rows.push(line(b, k / 60, w)); if (rows.length > 7) rows.shift();
        for (const c of open) if (c.bot === b && c.more-- > 0) c.rows.push(rows[rows.length - 1]);
        if (n2 < 6 || cases.length >= want || open.some(c => c.bot === b)) continue;
        const hit = w.found.find(f => f.size > size[f.what]);
        if (hit) { const c = { bot: b, what: `${hit.what} ${hit.side} ${hit.size}`, rows: rows.slice(), more: 3 }; cases.push(c); open.push(c); }
      }
      for (let i = open.length - 1; i >= 0; i--) if (open[i].more <= 0) open.splice(i, 1);
    }
  });
  return cases.map(c => ({ what: c.what, rows: c.rows }));
}
