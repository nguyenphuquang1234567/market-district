// Before/after captures from fixed camera positions, at a fixed clock (same cloud shadows) with the bots parked and the
// first-person rifle hidden, so two builds can be compared frame for frame.
// In the page (dev server running):
//   const cmp = await import('/tools/compare-shots.js?v=' + Date.now());
//   await cmp.shots(G, 'before')             -> writes captures/cmp_before_<view>.jpg (1920 x 1080 on High)
//   await cmp.shots(G, 'after', { names: ['market_lane'] })
// A view is [x, z, yawDeg, pitchDeg] at standing eye height, or [x, z, yawDeg, pitchDeg, eyeY] for a raised camera.

export const VIEWS = {
  // ---- the old district
  main_street: [0.6, -56, 0, 2],
  arch_plaza: [1.5, -9, 14, 6],
  market_lane: [28.4, -47, 0, 3],                 // the covered lane: under the shade cloths
  lane_canopy_up: [28.4, -34, 180, 24],           // looking up under the cloths
  laundry_alley: [-29, -45, 0, 2],
  spawn_alley: [-29, -58.5, 0, 5],
  facades_west: [2.6, -34, -72, 16],              // main street, the west row's windows, balconies and cornice
  facades_east: [-2.6, -27, 74, 15],
  roofline: [-22, -10, 60, -8, 5.4],              // from the roof you can climb to, across the parapets
  shop_interior: 'room',                          // inside a walk-in shop on the main street, looking out
  eave_up: [2.5, -51, -90, 36],                   // up at a three-storey house's eaves on the main street
  street_corner: [-2.4, -60.6, -45, 9],           // a street corner: the house corner, its two facades
  door_close: [-3.0, -31.2, -90, 6],              // a doorway on the main street, close up
  street_corner2: [-2.6, 19.4, -45, 8],           // another house corner, on the north cross street
  // ---- the market quarter
  gate_north: [28.4, 20, 90, 2],
  calle_mercado: [49, -45, 0, 4],
  quarter_south: [88, -60, -90, 2],              // the quarter's south street, cobbles half in shade
  quarter_facades: [50.6, -36, -90, 18],          // the ring's new faces along Calle del Mercado
  hall_portal: [47.5, 0, 90, 6],
  hall_inside: [61, 3.2, 100, 8],
  plazuela: [74.6, -27.5, 135, 3],
  atrium: [74, 18, 200, 3],
  east_street: [93, 0, 0, 2],
};

const park = G => { for (const b of G.bots.list) { b.alive = false; b.root.visible = false; b.gun.visible = false; b.respawnT = 1e9; } };

function roomView(G) {
  const rm = G.world.anchors.find(a => a.kind === 'room' && a.bd.street[Object.keys(a.bd.street).find(k => a.bd.street[k] === 'main')]);
  const p = rm.P((rm.ra + rm.rb) / 2 + 0.6, 0, rm.D - 1.0);
  return [p.x, p.z, Math.atan2(rm.N.x, rm.N.z) * 180 / Math.PI, 4];
}

export async function shots(G, tag, { names = Object.keys(VIEWS), w = 1536, h = 864, settle = 2.0, clock = 120 } = {}) {
  const out = [], R = G.R, cam = R.camera, deg = Math.PI / 180;
  // capture size first: exposure settles on the framing that is saved (a square pane would meter a different picture)
  const canvas = R.renderer.domElement; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; R.renderScale = 1; R.adaptive = false; R.resize();
  G.manual = true; G.auto = true; G.frozen = true; G.resetMatch(); G.playing = true; G.hud.show(null); park(G);
  const yieldToLoop = () => new Promise(r => setTimeout(r, 40));     // lets an exposure read still in flight from the menu land first
  for (const [i, name] of names.entries()) {
    let v = VIEWS[name]; if (v === 'room') v = roomView(G);
    const [x, z, yaw, pitch, eye] = v;
    G.setClock(clock);
    G.goto(x, z, yaw, pitch);
    G.weapon.root.visible = false;
    await yieldToLoop();
    if (i === 0) { G.step(120, 1 / 60); await yieldToLoop(); G.setClock(clock); }      // the first view also settles out of the menu's exposure
    G.step(Math.round(settle * 60), 1 / 60);
    if (eye) {                                    // a raised camera: drawn without the player, the meter settling on what it sees
      const place = () => { cam.position.set(x, eye, z); cam.rotation.set(pitch * deg, Math.PI + yaw * deg, 0, 'YXZ'); cam.updateMatrixWorld(); };
      G.setClock(clock + settle);
      for (let i = 0; i < 90; i++) { place(); R.render(1 / 60, clock + settle); }
      place();
    }
    G.weapon.root.visible = false;
    out.push(await G.capture(`cmp_${tag}_${name}`, w, h));
  }
  park(G); G.resetMatch(); G.playing = false; G.manual = false; G.auto = false; G.frozen = false; G.matchLive = false; G.hud.show('start');
  return out;
}
