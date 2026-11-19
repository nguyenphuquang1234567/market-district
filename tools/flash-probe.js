// Muzzle flash, caught on the frame it is lit: the player's rifle from the hip and through the optic, in sun and in
// shade, and a bot's rifle from the side, from three quarters and from in front. For judging one build's flash
// against another's (the flash is random shot to shot, so a few frames of each are taken).
// In the page (dev server running):
//   const fp = await import('/tools/flash-probe.js?v=' + Date.now());
//   await fp.run(G, 'before')        -> captures/flash_<tag>_<view>_<n>.jpg
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function begin(G, w, h) {
  const R = G.R, canvas = R.renderer.domElement; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  G.manual = true; G.auto = true; G.frozen = true; G.resetMatch(); G.playing = true; G.hud.show(null);
}
const park = (G, keep) => { for (const b of G.bots.list) if (b !== keep) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };

export async function run(G, tag, { w = 1536, h = 864, shots = 3, views = null } = {}) {
  const P = G.player, W = G.weapon, out = [];
  begin(G, w, h); G.setClock(120);
  const keep = () => { P.health = 100; P.alive = true; W.ammo = 30; W.heat = 0; };
  // ---- the player's own rifle: [x, z, yaw, pitch, aiming]
  const own = { hip_sun: [0.6, -56, 0, 0, false], hip_shade: [28.4, -44, 0, 0, false], ads_shade: [28.4, -44, 0, 0, true], hip_hall: [61, 3.2, 100, 2, false] };
  park(G, null);
  for (const [name, [x, z, yaw, pitch, ads]] of Object.entries(own)) {
    if (views && !views.includes(name)) continue;
    G.goto(x, z, yaw, pitch); keep(); P.sim.ads = ads; G.step(name === 'hip_sun' ? 150 : 90, 1 / 60);
    for (let k = 0; k < shots; k++) {
      keep(); P.sim.fire = true; let lit = false;
      for (let i = 0; i < 8 && !lit; i++) { G.step(1, 1 / 60); lit = W.flashT > 0.02; }      // (one in eight shots shows no flash)
      P.sim.fire = false;
      out.push(await G.capture(`flash_${tag}_${name}_${k}`, w, h));
      G.step(14, 1 / 60);
    }
    P.sim.ads = false;
  }
  // ---- a bot's: stood in the covered lane and made to fire up it, seen from the side, three quarters and in front
  G.resetMatch(); G.playing = true; G.step(300, 1 / 60);
  const b = G.bots.list.find(q => q.alive && q.team !== P.team);
  if (b) {
    park(G, b);
    const at = V(28.4, 0, -40), aim = { pos: V(28.4, 0, -20), eyeY: 1.4, vel: V(0, 0, 0), alive: true, team: P.team, damage() { return false; } };
    const cams = { bot_side: [24.6, -39.2, 100, 0], bot_34: [26.9, -36.4, 157, -3], bot_front: [28.8, -34.4, 183, -2] };
    for (const [name, [x, z, yaw, pitch]] of Object.entries(cams)) {
      if (views && !views.includes(name)) continue;
      for (let k = 0; k < Math.min(2, shots); k++) {
        keep(); G.goto(x, z, yaw, pitch); G.weapon.root.visible = false;
        for (let i = 0; i < 30; i++) { b.pos.copy(at); b.vel.set(0, 0, 0); b.yaw = b.lookYaw = 0; b.health = 100; b.alive = true; b.root.visible = true; b.gun.visible = true; G.step(1, 1 / 60); keep(); }
        b.pos.copy(at); G.bots.fire(b, aim, { err: 0.2, dmg: 0 }); G.step(1, 1 / 60); G.weapon.root.visible = false;
        out.push(await G.capture(`flash_${tag}_${name}_${k}`, w, h));
      }
    }
  }
  G.weapon.root.visible = true;
  park(G, null); G.resetMatch(); G.playing = false; G.manual = false; G.auto = false; G.frozen = false; G.matchLive = false; G.hud.show('start');
  return out;
}
