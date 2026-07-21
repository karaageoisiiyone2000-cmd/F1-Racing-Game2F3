import * as THREE from 'three';

const DIFFICULTY_PRESETS = {
  easy:   { skill: 0.62, aggression: 0.3, lookahead: 9,  reactionNoise: 0.14, maxSpeedMul: 0.86 },
  normal: { skill: 0.76, aggression: 0.5, lookahead: 11, reactionNoise: 0.09, maxSpeedMul: 0.94 },
  hard:   { skill: 0.86, aggression: 0.65, lookahead: 13, reactionNoise: 0.05, maxSpeedMul: 1.0 },
  expert: { skill: 0.94, aggression: 0.8, lookahead: 15, reactionNoise: 0.03, maxSpeedMul: 1.04 },
  legend: { skill: 1.0,  aggression: 0.92, lookahead: 17, reactionNoise: 0.01, maxSpeedMul: 1.08 },
};

export function createAiBrain(difficulty, seed = Math.random()) {
  const preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
  return {
    ...preset,
    seed,
    personalOffset: (seed - 0.5) * 3.2,
    overtakeBias: (seed - 0.5) * 2,
    pitPlanned: 0.35 + seed * 0.5,
    hasPitted: false,
  };
}

export function updateAiDrive(brain, carState, trackData, allCars, dt, weather) {
  const { samples, normals, tangents, curvature } = trackData;
  const n = samples.length;
  const pos = carState.chassisBody.position;

  let idx = carState.trackIndex || 0;
  let bestD = Infinity, bestI = idx;
  const searchWindow = 40;
  for (let off = -searchWindow; off <= searchWindow; off++) {
    const i = ((idx + off) % n + n) % n;
    const dx = samples[i].x - pos.x, dz = samples[i].z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  carState.trackIndex = bestI;

  const lookaheadCount = Math.round(brain.lookahead);
  const targetIdx = (bestI + lookaheadCount) % n;
  const targetP = samples[targetIdx];
  const targetNormal = normals[targetIdx];

  let lateralOffset = brain.personalOffset;

  let carAhead = null, minGap = Infinity;
  for (const other of allCars) {
    if (other === carState) continue;
    const dx = other.chassisBody.position.x - pos.x;
    const dz = other.chassisBody.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const fwd = tangents[bestI];
    const dot = dx * fwd.x + dz * fwd.z;
    if (dot > 0 && dist < 14 && dist < minGap) { minGap = dist; carAhead = other; }
  }
  if (carAhead) {
    const wantOvertake = brain.aggression > 0.4 && minGap < 10;
    const side = brain.overtakeBias >= 0 ? 1 : -1;
    if (wantOvertake) lateralOffset += side * 3.2;
    else lateralOffset += side * 1.2;
  }

  const desired = new THREE.Vector3(
    targetP.x + targetNormal.x * lateralOffset,
    0,
    targetP.z + targetNormal.z * lateralOffset
  );

  const q = carState.chassisBody.quaternion;
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  const toTarget = new THREE.Vector3(desired.x - pos.x, 0, desired.z - pos.z).normalize();
  let angle = Math.atan2(forward.x * toTarget.z - forward.z * toTarget.x, forward.x * toTarget.x + forward.z * toTarget.z);
  angle += (Math.random() - 0.5) * brain.reactionNoise;

  const steer = THREE.MathUtils.clamp(-angle * 1.6, -1, 1);

  let maxCurveAhead = 0;
  for (let k = 0; k < 26; k++) {
    const i = (bestI + k) % n;
    maxCurveAhead = Math.max(maxCurveAhead, curvature[i]);
  }
  const cornerSlow = THREE.MathUtils.clamp(1 - maxCurveAhead * 2.1, 0.35, 1);
  const weatherMul = weather === 'storm' ? 0.62 : weather === 'rain' ? 0.8 : 1;
  const targetSpeed = 320 * brain.maxSpeedMul * cornerSlow * weatherMul * brain.skill;

  let throttle = 1, brake = 0;
  if (carState.speedKmh > targetSpeed) {
    throttle = 0;
    brake = THREE.MathUtils.clamp((carState.speedKmh - targetSpeed) / 40, 0.15, 1);
  } else {
    throttle = THREE.MathUtils.clamp((targetSpeed - carState.speedKmh) / 30, 0.4, 1) * brain.skill;
  }

  if (carAhead && minGap < 5.5) {
    throttle *= 0.3;
    brake = Math.max(brake, 0.5);
  }

  carState.drsAllowed = carState.inDrsZone === true;
  carState.drsOpen = carState.drsAllowed && minGap > 0 && minGap < 40 && carAhead && brain.aggression > 0.3;
  if (!carAhead) carState.drsOpen = carState.drsAllowed;

  const ersDeploy = maxCurveAhead < 0.05 && carState.ers > 0.2;
  if (ersDeploy) { throttle = Math.min(1, throttle * 1.1); carState.ers = Math.max(0, carState.ers - dt * 0.12); }
  else { carState.ers = Math.min(1, carState.ers + dt * 0.08); }

  carState.wantsWetTires = (weather === 'rain' || weather === 'storm') && carState.compound !== 'inter' && carState.compound !== 'wet';
  carState.wantsSlickTires = (weather === 'clear' || weather === 'cloudy') && (carState.compound === 'inter' || carState.compound === 'wet');

  const raceProgress = carState.raceProgress || 0;
  if (!brain.hasPitted && raceProgress > brain.pitPlanned && carState.trackIndex > 5 && carState.trackIndex < n - 30) {
    carState.wantsPit = true;
  }

  return { throttle, brake, steer, handbrake: false };
}
