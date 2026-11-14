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
export async function sheet(G, name, { bot = G.bots.list[0], secs = 2, cols = 8, rows = 3, cell = 300, bearing = 90, dist = 4.2, height = 1.0, dt = 1 / 60, world = false } = {}) {
  const R = G.R, cv = R.renderer.domElement, n = cols * rows, every = Math.max(1, Math.round(secs / dt / n));
  const keep = { w: cv.style.width, h: cv.style.height, weapon: G.weapon.root.visible, hud: document.getElementById('hud')?.style.display };
  cv.style.width = cell + 'px'; cv.style.height = cell + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  const out = document.createElement('canvas'); out.width = cols * cell; out.height = rows * cell;
  const ctx = out.getContext('2d'); let wall = performance.now() / 1000;
  const fixed = world ? { x: bot.pos.x, z: bot.pos.z, yaw: bot.bodyYaw } : null;
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
  cv.style.width = keep.w; cv.style.height = keep.h; R.resize();
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
export async function film(G, name, state = {}, { bot = G.bots.list[0], frames = 150, fps = 30, w = 854, h = 480, bearing = 150, dist = 5.2, height = 1.05, fov = 34 } = {}) {
  const R = G.R, cv = R.renderer.domElement, dt = 1 / 60, per = Math.round(60 / fps), cols = G.world.colliders;
  if (state.n == null) { state.n = 0; state.yaw = bot.heading; state.wall = performance.now() / 1000; state.dist = dist; state.x = bot.pos.x; state.z = bot.pos.z; }
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  const weapon = G.weapon.root.visible, wrap = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)), shots = [];
  for (let i = 0; i < frames; i++) {
    G.step(per, dt); state.wall += per * dt;
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
  return state;
}
