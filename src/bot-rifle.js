import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { rayBoxes } from './physics.js';
import { angDiff, clamp, damp, smooth } from './util.js';
import { botReloadPose, MUZZLE } from './weapon.js';

const v = (x, y, z) => new Vector3(x, y, z);
const q = () => new Quaternion();
const euler = new Euler(0, 0, 0, 'YXZ');
const basis = new Matrix4();

// Vanguard's bind pose has +Y along the fingers and -X on the palm side of both hands.
// Set both axes in gun space: a wrist point alone leaves the palm free to roll with the walk cycle.
function handOrientation(fingers, palm) {
  const y = fingers.normalize();
  const x = palm.negate();
  x.addScaledVector(y, -x.dot(y)).normalize();
  return q().setFromRotationMatrix(basis.makeBasis(x, y, v().crossVectors(x, y)));
}

export const CARRY = {
  stock: [0, -0.12, 0.309],
  gripR: [0.048, -0.113, 0.153],
  gripL: [-0.099, -0.117, -0.211],
  rightHand: handOrientation(v(-0.21, -0.57, -0.80), v(-0.96, 0.06, 0.27)),
  leftHand: handOrientation(v(0.80, 0.20, -0.56), v(-0.20, 0.98, 0)),
};

const PISTOL_FINGERS = {
  Thumb: [[0.24, 0.22], [0.43, 0.05], [0.30, 0]],
  Index: [[0.08, -0.05], [0.28, 0], [0.13, 0]],
  Middle: [[0.49, 0], [1.03, 0], [0.61, 0]],
  Ring: [[0.55, 0], [1.13, 0], [0.72, 0]],
  Pinky: [[0.61, 0.10], [1.18, 0], [0.75, 0]],
};
const SUPPORT_FINGERS = {
  Thumb: [[0.24, -0.38], [0.50, -0.05], [0.31, 0]],
  Index: [[0.29, 0], [1.20, 0], [0.80, 0]],
  Middle: [[0.32, 0], [1.23, 0], [0.82, 0]],
  Ring: [[0.55, 0], [1.00, 0], [0.59, 0]],
  Pinky: [[0.60, -0.09], [1.04, 0], [0.67, 0]],
};
const RELOAD_WRIST = v(-0.101, -0.278, -0.084);
const RELOAD_HAND = handOrientation(v(0.78, 0.55, 0.12), v(0.65, -0.76, 0));
const STOCK = v(...CARRY.stock);
const LINK_MARGIN = 0.018;

function createArm(model, side) {
  const find = name => model.getObjectByName('mixamorig' + side + name);
  const shoulder = find('Shoulder');
  const upper = find('Arm');
  const forearm = find('ForeArm');
  const hand = find('Hand');
  const right = side === 'Right';
  const curls = right ? PISTOL_FINGERS : SUPPORT_FINGERS;
  const fingers = Object.entries(curls).flatMap(([digit, joints]) => joints.map(([bend, spread], index) => {
    const bone = find('Hand' + digit + (index + 1));
    return { bone, pose: bone.quaternion.clone().multiply(q().setFromEuler(new Euler(bend * 0.12, spread, bend, 'ZYX'))) };
  }));
  return {
    shoulder, shoulderRest: shoulder.quaternion.clone(), upper, forearm, hand, fingers,
    upperLength: upper.getWorldPosition(v()).distanceTo(forearm.getWorldPosition(v())),
    lowerLength: forearm.getWorldPosition(v()).distanceTo(hand.getWorldPosition(v())),
    bendSign: right ? 1 : -1, origin: v(), reachTarget: v(),
  };
}

export function setUpBotRifle(bot) {
  bot.magazine = bot.gun.getObjectByName('botMagazine');
  bot.rifle = {
    right: createArm(bot.model, 'Right'), left: createArm(bot.model, 'Left'),
  };
}

const xAxis = v(), yAxis = v(), zAxis = v(), parentQ = q(), jointQ = q(), handX = v(1, 0, 0);
const aim = v(), elbow = v(), bend = v(), normal = v(), twist = v();

function setWorldRotation(bone, rotation) {
  bone.parent.getWorldQuaternion(parentQ);
  bone.quaternion.copy(parentQ.invert()).multiply(rotation);
}

function alignLink(bone, y, x) {
  zAxis.crossVectors(x, y).normalize();
  xAxis.crossVectors(y, zAxis).normalize();
  setWorldRotation(bone, jointQ.setFromRotationMatrix(basis.makeBasis(xAxis, y, zAxis)));
}

// Use the elbow bend plane for the shoulder roll and allow part of the wrist twist into the forearm.
function solveArm(arm, target, rotation, hint) {
  const { origin, upperLength: a, lowerLength: b } = arm;
  aim.subVectors(target, origin);
  const length = clamp(aim.length(), Math.abs(a - b) + 0.015, a + b - 0.003);
  aim.normalize();
  bend.copy(hint).addScaledVector(aim, -hint.dot(aim)).normalize();
  const along = (a * a + length * length - b * b) / (2 * length);
  elbow.copy(origin).addScaledVector(aim, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
  normal.crossVectors(bend, aim).normalize().multiplyScalar(arm.bendSign);
  yAxis.subVectors(elbow, origin).normalize();
  alignLink(arm.upper, yAxis, normal);
  yAxis.copy(origin).addScaledVector(aim, length).sub(elbow).normalize();
  twist.copy(handX).applyQuaternion(rotation);
  twist.addScaledVector(yAxis, -twist.dot(yAxis)).normalize();
  // Maintain the elbow's bend plane as the wrist pronates.
  twist.lerp(normal, 0.62).normalize();
  alignLink(arm.forearm, yAxis, twist);
  setWorldRotation(arm.hand, rotation);
  for (const finger of arm.fingers) finger.bone.quaternion.copy(finger.pose);
}

const chest = v(), forward = v(), lateral = v(), stock = v(), point = v(), correction = v();
const gunPosition = v(), gunRotation = q(), restRotation = q(), tuckRotation = q(), localRotation = q();
const leftLocal = v(), leftRotation = q(), handRotation = q(), rightHint = v(), leftHint = v();
const shotDirection = v(), stockDirection = v(), muzzle = v(), stockPosition = v(), shoulderQ = q(), gaze = q(), currentGaze = q();

function rayClearance(start, cols) {
  shotDirection.subVectors(muzzle, start);
  const length = shotDirection.length();
  shotDirection.multiplyScalar(1 / length);
  const hit = rayBoxes(start.x, start.y, start.z, shotDirection.x, shotDirection.y, shotDirection.z, length + 0.04, cols);
  return Math.min(length, Math.max(0, hit - 0.04)) - length;
}

function muzzleClearance(position, orientation, cols) {
  muzzle.copy(MUZZLE).applyQuaternion(orientation).add(position);
  stockPosition.copy(STOCK).applyQuaternion(orientation).add(position);
  const stockGap = rayClearance(stockPosition, cols);
  stockDirection.copy(shotDirection);
  const chestGap = rayClearance(chest, cols);
  if (stockGap < chestGap) shotDirection.copy(stockDirection);
  return Math.min(stockGap, chestGap);
}

function keepInReach(arm, localTarget) {
  arm.reachTarget.copy(localTarget).applyQuaternion(gunRotation).add(gunPosition);
  correction.subVectors(arm.reachTarget, arm.origin);
  const distance = correction.length();
  const reach = arm.upperLength + arm.lowerLength - LINK_MARGIN;
  if (distance > reach) gunPosition.addScaledVector(correction, (reach - distance) / distance);
}

export function poseBotRifle(bot, dt) {
  const { b, rifle: { right, left } } = bot;
  const a = bot.aim;
  const pitch = clamp(bot.pitch, -0.65, 0.55);
  const yaw = bot.yaw;
  const twist = angDiff(bot.bodyYaw, yaw);
  // The lower-body clips can contribute the hip rhythm. Deliberate spine and clavicle
  // offsets keep the girdle supporting the weapon as the pelvis follows the feet.
  b.spine.rotation.y += twist * 0.27;
  b.spine1.rotation.y += twist * 0.36;
  b.spine2.rotation.y += twist * 0.37 - a * 0.16 + bot.flinch * 0.12;
  b.spine1.rotation.x += -pitch * a * 0.21 + bot.flinch * 0.16 + Math.sin(bot.G.time * 1.7 + bot.idx) * 0.008;
  b.spine2.rotation.x -= pitch * a * 0.21;
  right.shoulder.quaternion.copy(right.shoulderRest).multiply(shoulderQ.setFromEuler(euler.set(0, 0, 0.015 + a * 0.06)));
  left.shoulder.quaternion.copy(left.shoulderRest).multiply(shoulderQ.setFromEuler(euler.set(0, 0, 0.10 + a * 0.14)));
  b.spine.updateWorldMatrix(false, true);
  b.spine2.getWorldPosition(chest);
  right.upper.getWorldPosition(right.origin);
  left.upper.getWorldPosition(left.origin);

  const { grip: reload, magY } = botReloadPose(bot.reloadT);
  bot.magazine.visible = true;
  bot.magazine.position.y = magY;
  point.copy(RELOAD_WRIST);
  point.y += magY;
  leftLocal.fromArray(CARRY.gripL).lerp(point, reload);
  leftRotation.copy(CARRY.leftHand).slerp(RELOAD_HAND, reload);
  forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  lateral.set(-forward.z, 0, forward.x);
  bot.rifleKick = damp(bot.rifleKick, 0, 16, dt);

  // Low ready and shoulder aim share the stock pocket. Pivot there when lowering the
  // muzzle, aiming up a stair, or making room to withdraw the magazine.
  stock.copy(right.origin).lerp(chest, 0.33).addScaledVector(forward, 0.106 - reload * 0.025);
  stock.y -= 0.033 + (1 - a) * 0.132 - reload * 0.055;
  stock.addScaledVector(forward, -bot.rifleKick * 0.021);
  restRotation.setFromEuler(euler.set(-0.47 + reload * 0.55, yaw + Math.PI - 0.19 + reload * 0.21, 0.11 - reload * 0.34));
  gunRotation.setFromEuler(euler.set(pitch + bot.rifleKick * 0.047, yaw + Math.PI, 0));
  gunRotation.copy(restRotation.slerp(gunRotation, smooth(a)));
  gunPosition.copy(STOCK).applyQuaternion(gunRotation).negate().add(stock);

  const clearance = muzzleClearance(gunPosition, gunRotation, bot.nearby);
  const tuck = clamp(-clearance / 0.40, 0, 1);
  bot.gunRaise = damp(bot.gunRaise, tuck, tuck > bot.gunRaise ? 25 : 10, dt);
  if (bot.gunRaise > 0.001 || tuck > 0.025) {
    // A quick transition toward a vertical close-retention pose keeps the stock nearby.
    tuckRotation.setFromEuler(euler.set(-1.22, yaw + Math.PI - 0.18, 0.11));
    gunRotation.slerp(tuckRotation, Math.max(bot.gunRaise, tuck * 0.72));
    gunPosition.copy(STOCK).applyQuaternion(gunRotation).negate().add(stock);
    const penetration = muzzleClearance(gunPosition, gunRotation, bot.nearby);
    gunPosition.addScaledVector(shotDirection, penetration);
  }

  // Fit the weapon to the two arm reach envelopes before handing it to the dominant hand.
  // The scene-level gun copies that hand's transform so the rigid-body drop uses world space.
  const rightLocal = point.fromArray(CARRY.gripR);
  keepInReach(right, rightLocal);
  keepInReach(left, leftLocal);
  keepInReach(right, rightLocal);
  keepInReach(left, leftLocal);
  rightHint.copy(lateral).multiplyScalar(0.72).addScaledVector(forward, -0.17);
  rightHint.y = -0.88;
  leftHint.copy(lateral).multiplyScalar(-0.36).addScaledVector(forward, 0.17);
  leftHint.y = -1;
  right.reachTarget.copy(rightLocal).applyQuaternion(gunRotation).add(gunPosition);
  handRotation.copy(gunRotation).multiply(CARRY.rightHand);
  solveArm(right, right.reachTarget, handRotation, rightHint);
  right.hand.getWorldQuaternion(handRotation);
  bot.gun.quaternion.copy(handRotation).multiply(localRotation.copy(CARRY.rightHand).invert());
  right.hand.getWorldPosition(bot.gun.position);
  bot.gun.position.sub(rightLocal.applyQuaternion(bot.gun.quaternion));
  bot.gun.updateMatrixWorld(true);
  left.reachTarget.copy(leftLocal).applyQuaternion(bot.gun.quaternion).add(bot.gun.position);
  handRotation.copy(bot.gun.quaternion).multiply(leftRotation);
  solveArm(left, left.reachTarget, handRotation, leftHint);
  bot.gunBlocked = clearance < -0.045 || bot.gunRaise > 0.16 ||
    muzzleClearance(bot.gun.position, bot.gun.quaternion, bot.nearby) < -0.015;

  // In the Vanguard rig the helmet's forward axis is +Z. Keep its gaze tied to the
  // sight direction while aiming instead of inheriting neck roll from the stride.
  b.head.getWorldQuaternion(currentGaze);
  gaze.setFromEuler(euler.set(-pitch + 0.17, yaw, -0.045));
  setWorldRotation(b.head, currentGaze.slerp(gaze, a * 0.78));
}
