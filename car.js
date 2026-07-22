import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const TIRE_COMPOUNDS = {
  soft:   { grip: 1.12, wearRate: 1.6, color: 0xff2d2d, label: 'S' },
  medium: { grip: 1.00, wearRate: 1.0, color: 0xffd400, label: 'M' },
  hard:   { grip: 0.90, wearRate: 0.6, color: 0xffffff, label: 'H' },
  inter:  { grip: 0.80, wearRate: 0.9, color: 0x2fbf4f, label: 'I' },
  wet:    { grip: 0.72, wearRate: 0.7, color: 0x2f6fbf, label: 'W' },
};

const CHASSIS_HALF = { x: 0.95, y: 0.32, z: 2.7 };
const WHEEL_RADIUS = 0.34;

function makeCarBodyMesh(teamColor, numberText) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor, metalness: 0.4, roughness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x101215, metalness: 0.2, roughness: 0.6 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.6, roughness: 0.25 });

  const monoGeo = new THREE.BoxGeometry(CHASSIS_HALF.x * 1.5, CHASSIS_HALF.y * 1.6, CHASSIS_HALF.z * 1.55);
  const mono = new THREE.Mesh(monoGeo, bodyMat);
  mono.position.y = 0.05;
  mono.castShadow = true;
  group.add(mono);

  const noseGeo = new THREE.ConeGeometry(0.32, 1.6, 8);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.02, CHASSIS_HALF.z + 0.6);
  nose.castShadow = true;
  group.add(nose);

  const cockpitGeo = new THREE.CapsuleGeometry(0.34, 0.5, 4, 8);
  const cockpit = new THREE.Mesh(cockpitGeo, darkMat);
  cockpit.rotation.z = Math.PI / 2;
  cockpit.position.set(0, 0.42, 0.2);
  group.add(cockpit);

  const haloGeo = new THREE.TorusGeometry(0.42, 0.05, 6, 12, Math.PI);
  const halo = new THREE.Mesh(haloGeo, carbonMat);
  halo.rotation.x = Math.PI / 2;
  halo.rotation.z = Math.PI;
  halo.position.set(0, 0.62, 0.55);
  group.add(halo);

  const fwGeo = new THREE.BoxGeometry(1.9, 0.06, 0.5);
  const fw = new THREE.Mesh(fwGeo, carbonMat);
  fw.position.set(0, -0.22, CHASSIS_HALF.z + 1.25);
  fw.castShadow = true;
  fw.name = 'frontWing';
  group.add(fw);

  const rwPost = new THREE.Group();
  const rwGeo = new THREE.BoxGeometry(1.5, 0.06, 0.42);
  const rw = new THREE.Mesh(rwGeo, carbonMat);
  rwPost.add(rw);
  rwPost.position.set(0, 0.66, -CHASSIS_HALF.z - 0.15);
  rwPost.name = 'drsWing';
  group.add(rwPost);

  const podGeo = new THREE.BoxGeometry(0.5, 0.3, 1.5);
  [-0.7, 0.7].forEach(sx => {
    const pod = new THREE.Mesh(podGeo, bodyMat);
    pod.position.set(sx, 0.05, -0.2);
    pod.castShadow = true;
    group.add(pod);
  });

  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.font = 'bold 90px Rajdhani, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(numberText, 64, 68);
  const numTex = new THREE.CanvasTexture(c);
  const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true });
  const numGeo = new THREE.PlaneGeometry(0.5, 0.5);
  [-0.76, 0.76].forEach(sx => {
    const plane = new THREE.Mesh(numGeo, numMat);
    plane.position.set(sx * 0.98, 0.4, -0.5);
    plane.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(plane);
  });

  return group;
}

function makeWheelMesh(compoundColor) {
  const group = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.34, 18);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 });
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.36, 10);
  const rimMat = new THREE.MeshStandardMaterial({ color: compoundColor, metalness: 0.7, roughness: 0.3 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.z = Math.PI / 2;
  group.add(rim);
  return group;
}

export function createCar({ world, scene, teamColor = 0xe10600, number = '1', compound = 'medium', isPlayer = false }) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS_HALF.x, CHASSIS_HALF.y, CHASSIS_HALF.z));
  const chassisBody = new CANNON.Body({ mass: 720 });
  chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.15, 0));
  chassisBody.position.set(0, 0.6, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.linearDamping = 0.02;
  chassisBody.angularDamping = 0.5;

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const baseWheelOptions = {
    radius: WHEEL_RADIUS,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 42,
    suspensionRestLength: 0.28,
    frictionSlip: 2.6,
    dampingRelaxation: 2.6,
    dampingCompression: 4.2,
    maxSuspensionForce: 100000,
    rollInfluence: 0.02,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    maxSuspensionTravel: 0.22,
    customSlidingRotationalSpeed: -34,
    useCustomSlidingRotationalSpeed: true,
  };

  const wx = CHASSIS_HALF.x - 0.05;
  const wzF = CHASSIS_HALF.z - 0.55;
  const wzR = -CHASSIS_HALF.z + 0.65;
  const wheelPositions = [
    [wx, -0.05, wzF], [-wx, -0.05, wzF],
    [wx, -0.05, wzR], [-wx, -0.05, wzR],
  ];
  // 各ホイールごとに新しい Vec3 を生成して渡す(接続点の使い回しによる
  // 事故を避けるための防御的な書き方)
  wheelPositions.forEach(p => {
    const options = {
      ...baseWheelOptions,
      chassisConnectionPointLocal: new CANNON.Vec3(p[0], p[1], p[2]),
    };
    vehicle.addWheel(options);
  });
  vehicle.addToWorld(world);

  const carGroup = makeCarBodyMesh(teamColor, number);
  carGroup.castShadow = true;
  scene.add(carGroup);

  const compoundColor = TIRE_COMPOUNDS[compound].color;
  const wheelMeshes = vehicle.wheelInfos.map(() => {
    const w = makeWheelMesh(compoundColor);
    scene.add(w);
    return w;
  });

  const drsWing = carGroup.getObjectByName('drsWing');

  const state = {
    vehicle, chassisBody, carGroup, wheelMeshes, drsWing,
    isPlayer,
    compound,
    tireWear: 1.0,
    tireTemp: 70,
    fuel: 1.0,
    ers: 1.0,
    drsOpen: false,
    drsAllowed: false,
    damage: { front: 0, rear: 0, side: 0, susp: 0, engine: 0 },
    steerValue: 0,
    throttle: 0,
    brake: 0,
    lap: 0,
    lapStartTime: 0,
    lastLapTime: null,
    bestLapTime: null,
    trackIndex: 0,
    totalDistance: 0,
    finished: false,
    pit: { inPit: false, timer: 0 },
    speedKmh: 0,
    gear: 1,
    rpm: 0,
    crashCooldown: 0,
  };
  return state;
}

const MAX_ENGINE_FORCE = 4600;
const MAX_BRAKE_FORCE = 260;
const MAX_STEER = 0.55;

export function applyDrive(carState, { throttle, brake, steer, handbrake }) {
  const { vehicle, damage, tireWear, fuel } = carState;
  const engineHealth = 1 - damage.engine * 0.7;
  const gripFactor = Math.max(0.35, tireWear) * TIRE_COMPOUNDS[carState.compound].grip;
  const drsBoost = carState.drsOpen ? 1.12 : 1.0;

  const force = throttle * MAX_ENGINE_FORCE * engineHealth * drsBoost * Math.max(0.2, fuel * 0.4 + 0.6);
  vehicle.applyEngineForce(-force, 2);
  vehicle.applyEngineForce(-force, 3);

  const brakeForce = handbrake ? MAX_BRAKE_FORCE * 2 : brake * MAX_BRAKE_FORCE;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brakeForce, i);

  const steerClamped = -THREE.MathUtils.clamp(steer, -1, 1) * MAX_STEER * (1 - damage.front * 0.3);
  vehicle.setSteeringValue(steerClamped, 0);
  vehicle.setSteeringValue(steerClamped, 1);

  for (let i = 0; i < 4; i++) {
    vehicle.wheelInfos[i].frictionSlip = 2.6 * gripFactor * (1 - (carState.damage.side || 0) * 0.2);
  }
  carState.steerValue = steerClamped;
  carState.throttle = throttle;
  carState.brake = brake;
}

export function syncCarVisual(carState, dt) {
  const { vehicle, carGroup, wheelMeshes, chassisBody } = carState;
  carGroup.position.copy(chassisBody.position);
  carGroup.quaternion.copy(chassisBody.quaternion);

  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    const mesh = wheelMeshes[i];
    mesh.position.copy(t.position);
    mesh.quaternion.copy(t.quaternion);
  }

  const v = chassisBody.velocity;
  const speedMs = Math.sqrt(v.x * v.x + v.z * v.z);
  carState.speedKmh = speedMs * 3.6;

  const gearSpeeds = [0, 45, 85, 125, 165, 205, 250, 320];
  let gear = 1;
  for (let g = gearSpeeds.length - 1; g >= 1; g--) {
    if (carState.speedKmh >= gearSpeeds[g - 1]) { gear = g; break; }
  }
  carState.gear = gear;
  const bandLow = gearSpeeds[gear - 1] || 0;
  const bandHigh = gearSpeeds[gear] || bandLow + 40;
  carState.rpm = THREE.MathUtils.clamp((carState.speedKmh - bandLow) / (bandHigh - bandLow), 0, 1) * 0.7 + carState.throttle * 0.3;

  const targetRoll = -carState.steerValue * 0.12 * Math.min(1, speedMs / 20);
  carGroup.rotation.z += (targetRoll - carGroup.rotation.z) * Math.min(1, dt * 6);

  if (carState.drsWing) {
    const target = carState.drsOpen ? 0.55 : 0;
    carState.drsWing.rotation.x += (target - carState.drsWing.rotation.x) * Math.min(1, dt * 8);
  }
}
