import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { clamp, lerp, smooth } from './util.js';

export const CONTACT = 0.55;
export const STRAFE_STRIDE = 0.99;
export const BACK_STRIDE = 1.26;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const FLAT_BOOT = new THREE.Quaternion(0, Math.SQRT1_2, -Math.SQRT1_2, 0);
const JOINTS = ['hips', 'lul', 'll', 'lft', 'rul', 'rl', 'rft'];
const vec = (x, y, z) => new THREE.Vector3(x, y, z);

// The lead foot steps out, then the rear foot gathers. Pelvis height and roll
// follow the weight transfer. Clip space is model right, up, and rear; metres.
const SIDE_HIPS = [
  // phase, toward travel, height, rear offset, lateral tilt
  [0, -0.038, 0.878, 0.043, -0.035],
  [0.12, -0.016, 0.867, 0.039, -0.025],
  [0.33, 0.038, 0.885, 0.033, 0.039],
  [0.50, 0.033, 0.882, 0.036, 0.027],
  [0.65, 0.013, 0.871, 0.043, 0.007],
  [0.84, -0.035, 0.888, 0.047, -0.035],
  [1, -0.038, 0.878, 0.043, -0.035],
];
const BACK_HIPS = [
  [0, -0.026, 0.896, 0.066, -0.029],
  [0.13, -0.023, 0.883, 0.072, -0.022],
  [0.33, 0.023, 0.909, 0.063, 0.018],
  [0.50, 0.026, 0.896, 0.066, 0.029],
  [0.63, 0.023, 0.883, 0.072, 0.022],
  [0.83, -0.023, 0.909, 0.063, -0.018],
  [1, -0.026, 0.896, 0.066, -0.029],
];

// Lift, pass, extend and settle. The two ends continue moving rearward
// relative to the hips so the foot doesn't snap on leaving or entering stance.
const SWING = [
  // swing phase, stride progress, lift in m, pitch in radians
  [0, 0, 0, 0],
  [0.12, -0.035, 0.032, 0.19],
  [0.46, 0.46, 0.092, 0.10],
  [0.77, 0.91, 0.054, -0.045],
  [0.90, 1.016, 0.019, -0.060],
  [1, 1, 0, 0],
];

// A smooth curve through the keys (cubic Hermite with Catmull-Rom tangents). Easing each span separately would bring
// the boot to rest at every key and start it again: a swing made of several little pushes. `loop` joins the last key
// to the first (pelvis cycles); otherwise `ends` gives the slope of each column at the first and last key.
function sampleKeys(keys, t, { loop = false, ends = null } = {}) {
  let i = keys.findIndex(key => key[0] >= t);
  if (i <= 0) i = t <= keys[0][0] ? 1 : keys.length - 1;
  const a = keys[i - 1], b = keys[i], span = b[0] - a[0], u = clamp((t - a[0]) / span, 0, 1);
  const last = keys.length - 1;
  const slope = (k, j) => {
    if (k > 0 && k < last) return (keys[k + 1][j] - keys[k - 1][j]) / (keys[k + 1][0] - keys[k - 1][0]);
    if (loop) return (keys[1][j] - keys[last - 1][j]) / (keys[1][0] - keys[0][0] + keys[last][0] - keys[last - 1][0]);
    if (ends) return ends[k === 0 ? 0 : 1][j - 1];
    return k === 0 ? (keys[1][j] - keys[0][j]) / (keys[1][0] - keys[0][0]) : (keys[last][j] - keys[last - 1][j]) / (keys[last][0] - keys[last - 1][0]);
  };
  const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return a.slice(1).map((v, j) => h00 * v + h10 * span * slope(i - 1, j + 1) + h01 * b[j + 1] + h11 * span * slope(i, j + 1));
}

// Slopes of the swing curve where it meets the stance on either side. On the ground the boot travels rearward under
// the hips at a steady rate; leaving and landing at that same rate, it neither kicks off nor skids in.
const GROUND_RATE = -(1 - CONTACT) / CONTACT;
const SWING_ENDS = [[GROUND_RATE, 0, 0], [GROUND_RATE, -0.12, 0]];

function footKey(phase, foot, side) {
  const back = side === 0, lead = side > 0 ? 1 : 0;
  const p = (phase + (foot === lead ? 0 : 0.5)) % 1;
  const stance = p <= CONTACT;
  const [advance, lift, pitch] = stance ? [0, 0, 0] : sampleKeys(SWING, (p - CONTACT) / (1 - CONTACT), { ends: SWING_ENDS });
  const stride = back ? BACK_STRIDE : STRAFE_STRIDE;
  const offset = stance ? -p * stride : (advance - 1) * CONTACT * stride;
  const x = foot === 0 ? -1 : 1;
  const out = Math.abs(pitch) * 0.13;
  const pos = back
    ? vec(x * (0.14 + out), 0.142 + lift, 0.365 + offset)
    : vec(side * ((foot === lead ? 0.455 : -0.036) + offset), 0.142 + lift * 0.83, foot === 0 ? -0.105 - out : 0.158 + out);
  const rot = new THREE.Quaternion().setFromAxisAngle(UP, -x * (back ? 0.13 : 0.17))
    .multiply(new THREE.Quaternion().setFromAxisAngle(vec(1, 0, 0), pitch * (back ? 1 : side * 0.24)))
    .multiply(FLAT_BOOT);
  return { pos, rot };
}

// Bake the authored poses to ordinary bone rotation/position tracks once.
// The bake works on a scratch copy of the exact skeleton and does no work per bot.
export function bakeDirectionalGaits(asset, bindBones, solveLeg) {
  const model = clone(asset.scene);
  const bones = Object.fromEntries(JOINTS.map(k => [k, model.getObjectByName(bindBones[k].name)]));
  const mixer = new THREE.AnimationMixer(model);
  const bind = mixer.clipAction(THREE.AnimationClip.findByName(asset.animations, 'TPose')).play();
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const times = Array.from({ length: 81 }, (_, i) => i / 80);
  const clips = {};
  bind.paused = true;
  mixer.update(0);
  const neutral = JOINTS.map(name => ({
    bone: bones[name], position: bones[name].position.clone(), rotation: bones[name].quaternion.clone(),
  }));
  for (const [key, side] of [['left', -1], ['right', 1], ['back', 0]]) {
    const tracks = Object.fromEntries(JOINTS.map(k => [k, []]));
    const positions = [];
    for (const phase of times) {
      for (const { bone, position, rotation } of neutral) {
        bone.position.copy(position);
        bone.quaternion.copy(rotation);
      }
      const [sway, height, rear, tilt] = sampleKeys(side === 0 ? BACK_HIPS : SIDE_HIPS, phase, { loop: true });
      bones.hips.parent.updateWorldMatrix(true, false);
      bones.hips.position.copy(bones.hips.parent.worldToLocal(vec(sway * (side || 1), height, rear)));
      euler.set(-0.065, side * sway * 0.9, tilt * (side || 1));
      bones.hips.parent.getWorldQuaternion(parentQ).invert();
      bones.hips.getWorldQuaternion(worldQ);
      bones.hips.quaternion.copy(parentQ).multiply(rotation.setFromEuler(euler)).multiply(worldQ);
      for (const [i, [thigh, knee, foot]] of [[bones.lul, bones.ll, bones.lft], [bones.rul, bones.rl, bones.rft]].entries()) {
        const target = footKey(phase, i, side);
        solveLeg(thigh, knee, foot, target.pos, FORWARD);
        foot.quaternion.copy(foot.parent.getWorldQuaternion(parentQ).invert().multiply(target.rot));
      }
      positions.push(...bones.hips.position.toArray());
      for (const name of JOINTS) tracks[name].push(...bones[name].quaternion.toArray());
    }
    clips[key] = new THREE.AnimationClip(key, 1, [
      new THREE.VectorKeyframeTrack('hips.position', times, positions),
      ...JOINTS.map(name => new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, tracks[name])),
    ]);
  }
  mixer.uncacheRoot(model);
  return Object.fromEntries(Object.entries(clips).map(([name, clip]) => [
    name, clip.tracks.map(track => {
      const [joint, prop] = track.name.split('.');
      return { joint, prop, sample: track.createInterpolant() };
    }),
  ]));
}

const q = new THREE.Quaternion(), p = new THREE.Vector3();
export function applyDirectionalGait(bones, clips, blend, phase, amount = 1) {
  // Normalize the incremental blend so weights are relative to the same base pose.
  let remaining = 1 - (blend.left + blend.right + blend.back) * amount;
  for (const name of ['left', 'right', 'back']) {
    const weight = blend[name] * amount;
    if (weight < 0.0001) continue;
    const alpha = weight / (remaining + weight);
    const t = (phase + (name === 'right' ? 0.5 : 0)) % 1;
    for (const { joint, prop, sample } of clips[name]) {
      const value = bones[joint][prop], target = sample.evaluate(t);
      if (prop === 'position') value.lerp(p.fromArray(target), alpha);
      else value.slerp(q.fromArray(target), alpha);
    }
    remaining += weight;
  }
}

// Which way the feet are going relative to the hips, as shares of the sideways and backward gaits. It follows the
// direction of travel only (how much the soldier is stepping at all is a separate, slower blend), keeps its last
// answer when too slow to tell, and is taken at once (`fresh`) when starting from a standstill.
export function directionBlend(out, angle, speed, dt, fresh = false) {
  if (speed < 0.12 && !fresh) return;
  const side = Math.sin(angle), forward = Math.cos(angle);
  const lateral = Math.abs(side), retreat = Math.max(0, -forward);
  const sideWeight = smooth(clamp((lateral - 0.23) / 0.62, 0, 1));
  const backWeight = smooth(clamp((retreat - 0.20) / 0.68, 0, 1)) * (1 - sideWeight);
  const k = fresh ? 1 : 1 - Math.exp(-7 * dt);
  // Positive angle corresponds to model left once root's half-turn is applied.
  out.left = lerp(out.left, side > 0 ? sideWeight : 0, k);
  out.right = lerp(out.right, side < 0 ? sideWeight : 0, k);
  out.back = lerp(out.back, backWeight, k);
}
