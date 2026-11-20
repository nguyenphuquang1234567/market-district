// The HUD in each of its states, staged in a real match and saved with the HUD drawn over the frame (tools/hud-shot.js):
// a fight in the sun with an ally and two enemies marked, low ammunition, a reload, a hit marker, damage taken, the
// kill feed after a headshot, a grenade in the hand, death, a dark interior. For judging one HUD against another.
// In the page (dev server running, after boot):
//   const hp = await import('/tools/hud-probe.js?v=' + Date.now());
//   hp.run(G, 'before')                       -> captures/hud_<tag>_<view>.jpg (1920x1080)
//   hp.run(G, 'before', { w: 2192, h: 1080, views: ['fight'] })
// (javascript_tool gives up after 45 s: start it without awaiting and wait for the files.)
// (hud-shot.js is loaded with this module's own ?v=, so an edited copy is picked up without reloading the page)
const { size, shot } = await import('./hud-shot.js' + new URL(import.meta.url).search);

const DEG = Math.PI / 180;

function park(G) { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } }
// bot i standing still at (x, z), facing yaw (radians)
function dummy(G, i, x, z, yaw) { const b = G.bots.list[i]; b.spawn({ x, z, yaw }); b.think = 1e9; b.wishDir = null; b.wishSpeed = 0; return b; }
// yaw and pitch (degrees) from the player's eye to a point
function aim(G, x, y, z) {
  const P = G.player, dx = x - P.pos.x, dz = z - P.pos.z;
  return [Math.atan2(dx, dz) / DEG, Math.atan2(y - (P.pos.y + P.eyeY), Math.hypot(dx, dz)) / DEG];
}

// a mid-match street fight: player at (0.5, -36) looking up the market street, an ally ahead on the left, two enemies further up
function fight(G, { shoot = false } = {}) {
  const P = G.player, W = G.weapon, B = G.bots.list;
  G.resetMatch(); G.playing = true; G.hud.show(null); G.setClock(120); park(G);
  if (G.throw.busy) G.throw.stow(true);
  Object.assign(G.hud, { hitT: 1e-4, dmgT: 1e-4, bannerT: 1e-4 });   // last view's hit marker, damage arc and banner go with the next step
  G.goto(0.5, -36, 0, 0);
  dummy(G, 0, -2.4, -27.5, 0.15);                 // ally, facing away up the street
  const e1 = dummy(G, 3, 2.2, -16, Math.PI);       // enemies, facing the player
  dummy(G, 4, -3.4, -9.5, Math.PI - 0.3);
  G.score[0] = 17; G.score[1] = 14; G.timeLeft = 372.4;
  G.step(30);
  const [yaw, pitch] = aim(G, e1.pos.x, e1.pos.y + 1.2, e1.pos.z);
  G.goto(0.5, -36, yaw, pitch); P.sim.pitch = pitch * DEG;
  W.ammo = 23; W.reserve = 90; W.reserveRefillTime = 7;
  G.hud.kill(B[1], B[5], false, 'gun'); G.hud.kill(B[6], B[2], true, 'gun'); G.hud.kill(P, B[4], false, 'blast');
  G.step(20);
  if (shoot) { P.sim.fire = true; G.step(1); P.sim.fire = false; G.step(3); }
  return { P, W, e1 };
}

const VIEWS = {
  fight: G => { fight(G); },
  lowammo: G => { const { W } = fight(G); W.ammo = 5; G.step(4); },
  reload: G => { const { W } = fight(G); W.ammo = 4; W.startReload(); G.step(54); },
  hit: G => { fight(G, { shoot: true }); },
  damage: G => { const { P } = fight(G); P.damage(42, { x: P.pos.x + 9, z: P.pos.z + 3 }, G.bots.list[3], 'body'); G.step(8); },
  lowhealth: G => { const { P } = fight(G); P.damage(74, { x: P.pos.x - 6, z: P.pos.z - 8 }, G.bots.list[3], 'body'); G.step(14); },
  killfeed: G => {
    const { P } = fight(G), B = G.bots.list;
    G.hud.kill(B[0], B[3], false, 'gun'); G.hud.kill(P, B[5], true, 'gun'); G.hud.banner(true);
    G.step(12);
  },
  grenade: G => { const { P } = fight(G); G.throw.select('frag'); G.step(40); void P; },
  dead: G => { const { P } = fight(G); P.damage(200, { x: P.pos.x + 4, z: P.pos.z + 9 }, G.bots.list[3], 'head'); G.step(70); },
  interior: G => { fight(G); park(G); G.goto(61, 3.2, 100, 2); dummy(G, 5, 70.5, 1.5, -80 * DEG); G.step(40); },
};

export async function run(G, tag, { w = 1920, h = 1080, scale = 1, views = null } = {}) {
  const out = [];
  G.manual = true; G.auto = true; G.frozen = true;
  size(G, w, h);
  for (const [name, stage] of Object.entries(VIEWS)) {
    if (views && !views.includes(name)) continue;
    stage(G);
    out.push(await shot(G, `hud_${tag}_${name}${w !== 1920 ? '_' + w : ''}`, { scale }));
  }
  const P = G.player; P.sim.fire = false; P.sim.pitch = 0;
  G.hudProbe = out;
  return out;
}
