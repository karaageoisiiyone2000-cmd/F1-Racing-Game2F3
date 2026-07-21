import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  buildTrackData, buildTrackMesh, buildCurbs, buildGround, buildBarriers,
  buildGrandstands, buildTrees, buildSignage, buildPitLane, TRACK_WIDTH,
} from './track.js';
import { createCar, applyDrive, syncCarVisual, TIRE_COMPOUNDS } from './car.js';
import { createAiBrain, updateAiDrive } from './ai.js';
import { SoundEngine } from './audio.js';

const settings = {
  session: 'practice',
  tire: 'medium',
  weather: 'clear',
  difficulty: 'normal',
  aiCount: 4,
  timeOfDay: 'day',
};
const SAVE_KEY = 'apexgp_save_v1';

let scene, camera, renderer, world;
let trackData;
let playerCar, aiCars = [], aiBrains = [], allCars = [];
let barrierBodies = [];
let sunLight, hemiLight;
let clock = new THREE.Clock();
let running = false, paused = false;
let cameraMode = 'chase';
let sound;
let rainSystem = null;
let currentWeather = 'clear';
let raceStartTime = 0;
let sessionOver = false;
let finishIdx = 0, drsZoneStartIdx = 0, drsZoneEndIdx = 0;
let pitLaneData = null;
let flagState = 'GREEN';
let totalLaps = 5;
let qualiTimeLimit = 180;

const keys = {};
const touchState = { steer: 0, accel: false, brake: false, drs: false };

function initThree() {
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function initLights() {
  hemiLight = new THREE.HemisphereLight(0x9ec7ff, 0x2c5a2f, 0.55);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -120;
  sunLight.shadow.camera.right = 120;
  sunLight.shadow.camera.top = 120;
  sunLight.shadow.camera.bottom = -120;
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.bias = -0.0003;
  scene.add(sunLight);
  scene.add(sunLight.target);
}

function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.defaultContactMaterial.friction = 0.9;
  world.solver.iterations = 12;

  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);
}

function buildCircuit() {
  trackData = buildTrackData();
  scene.add(buildGround());
  scene.add(buildTrackMesh(trackData));
  scene.add(buildCurbs(trackData));
  const { mesh: barrierMesh, colliders } = buildBarriers(trackData);
  scene.add(barrierMesh);
  scene.add(buildGrandstands(trackData));
  scene.add(buildTrees(trackData));

  drsZoneStartIdx = Math.round(trackData.samples.length * 0.06);
  drsZoneEndIdx = Math.round(trackData.samples.length * 0.18);
  finishIdx = 0;
  scene.add(buildSignage(trackData, drsZoneStartIdx, finishIdx));

  pitLaneData = buildPitLane(trackData);
  scene.add(pitLaneData.mesh);

  colliders.forEach(c => {
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, 1.0, c.hz)));
    body.position.set(c.x, 1.0, c.z);
    body.quaternion.setFromEuler(0, c.ry, 0);
    world.addBody(body);
    barrierBodies.push(body);
  });
}

function setSky(weather, timeOfDay) {
  let top, bottom, fogColor, sunIntensity, ambient;
  if (timeOfDay === 'night') {
    top = 0x02040a; bottom = 0x0a1220; fogColor = 0x05060a; sunIntensity = 0.25; ambient = 0.18;
  } else if (weather === 'storm') {
    top = 0x333a42; bottom = 0x4a5058; fogColor = 0x3a3f45; sunIntensity = 0.5; ambient = 0.4;
  } else if (weather === 'rain') {
    top = 0x5b6773; bottom = 0x7c8894; fogColor = 0x5f6a75; sunIntensity = 0.75; ambient = 0.5;
  } else if (weather === 'cloudy') {
    top = 0x8fa3b8; bottom = 0xc4d0da; fogColor = 0x9fb0bd; sunIntensity = 1.0; ambient = 0.55;
  } else {
    top = 0x3f8cd6; bottom = 0xbfe0f5; fogColor = 0xbcdcf2; sunIntensity = 1.4; ambient = 0.55;
  }
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  scene.background = tex;
  scene.fog = new THREE.Fog(fogColor, 140, weather === 'storm' ? 420 : 900);
  sunLight.intensity = sunIntensity;
  hemiLight.intensity = ambient;

  if (timeOfDay === 'night') {
    sunLight.position.set(-80, 60, -40);
    sunLight.color.set(0x88a0ff);
  } else {
    sunLight.position.set(120, 140, 60);
    sunLight.color.set(0xfff2df);
  }
  updateStadiumLights(timeOfDay === 'night');
  currentWeather = weather;
  updateRain(weather);
}

let stadiumLights = [];
function updateStadiumLights(on) {
  stadiumLights.forEach(l => scene.remove(l));
  stadiumLights = [];
  if (!on) return;
  const spots = [60, 180, 300, 420];
  spots.forEach(i => {
    const idx = i % trackData.samples.length;
    const p = trackData.samples[idx];
    const light = new THREE.SpotLight(0xffffff, 260, 220, Math.PI / 5, 0.4, 1.4);
    light.position.set(p.x, 34, p.z);
    light.target.position.set(p.x, 0, p.z);
    scene.add(light, light.target);
    stadiumLights.push(light);
  });
}

function updateRain(weather) {
  if (rainSystem) { scene.remove(rainSystem); rainSystem = null; }
  if (weather !== 'rain' && weather !== 'storm') return;
  const count = weather === 'storm' ? 5000 : 2200;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 260;
    positions[i * 3 + 1] = Math.random() * 60;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 260;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xaac4dd, size: 0.18, transparent: true, opacity: 0.6 });
  rainSystem = new THREE.Points(geo, mat);
  rainSystem.userData.speed = weather === 'storm' ? 62 : 42;
  scene.add(rainSystem);
}

function animateRain(dt) {
  if (!rainSystem || !playerCar) return;
  const pos = rainSystem.geometry.attributes.position;
  const speed = rainSystem.userData.speed;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i) - speed * dt;
    if (y < 0) y = 60;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  rainSystem.position.set(playerCar.chassisBody.position.x, 0, playerCar.chassisBody.position.z);
}

const TEAM_COLORS = [0xe10600, 0x00d2ff, 0xff8700, 0x2f6bff, 0x1e5c33, 0xffd400, 0x9b2fff, 0xffffff, 0x00a86b, 0xff2d95];

function gridPosition(index) {
  const n = trackData.samples.length;
  const idx = ((finishIdx - index * 4 - 6) % n + n) % n;
  const p = trackData.samples[idx];
  const nor = trackData.normals[idx];
  const t = trackData.tangents[idx];
  const side = index % 2 === 0 ? 1 : -1;
  const lateral = side * 2.6;
  return {
    x: p.x + nor.x * lateral, z: p.z + nor.z * lateral,
    ry: Math.atan2(t.x, t.z), idx,
  };
}

function setupCars() {
  allCars = [];
  const gp = gridPosition(0);
  playerCar = createCar({ world, scene, teamColor: TEAM_COLORS[0], number: '1', compound: settings.tire, isPlayer: true });
  placeCarAtGrid(playerCar, gp);
  allCars.push(playerCar);

  aiCars = []; aiBrains = [];
  for (let i = 0; i < settings.aiCount; i++) {
    const g = gridPosition(i + 1);
    const car = createCar({ world, scene, teamColor: TEAM_COLORS[(i + 1) % TEAM_COLORS.length], number: String(i + 2), compound: settings.tire, isPlayer: false });
    placeCarAtGrid(car, g);
    aiCars.push(car);
    aiBrains.push(createAiBrain(settings.difficulty, Math.random()));
    allCars.push(car);
  }
}

function placeCarAtGrid(car, g) {
  car.chassisBody.position.set(g.x, 0.7, g.z);
  const q = new CANNON.Quaternion();
  q.setFromEuler(0, g.ry, 0);
  car.chassisBody.quaternion.copy(q);
  car.chassisBody.velocity.set(0, 0, 0);
  car.chassisBody.angularVelocity.set(0, 0, 0);
  car.trackIndex = g.idx;
}

function clearCars() {
  allCars.forEach(c => {
    world.removeBody(c.chassisBody);
    c.vehicle.removeFromWorld(world);
    scene.remove(c.carGroup);
    c.wheelMeshes.forEach(w => scene.remove(w));
  });
  allCars = []; aiCars = []; aiBrains = []; playerCar = null;
}

function initInput() {
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  const wheelZone = document.getElementById('wheelZone');
  const wheelStick = document.getElementById('wheelStick');
  let dragging = false, wheelCenter = { x: 0, y: 0 };
  function wheelPointer(e) {
    const rect = wheelZone.getBoundingClientRect();
    wheelCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - wheelCenter.x;
    const maxR = rect.width / 2 - 20;
    const clampedX = Math.max(-maxR, Math.min(maxR, dx));
    wheelStick.style.transform = `translate(calc(-50% + ${clampedX}px), -50%)`;
    touchState.steer = Math.max(-1, Math.min(1, dx / maxR));
  }
  wheelZone.addEventListener('touchstart', e => { dragging = true; wheelPointer(e); e.preventDefault(); }, { passive: false });
  wheelZone.addEventListener('touchmove', e => { if (dragging) wheelPointer(e); e.preventDefault(); }, { passive: false });
  wheelZone.addEventListener('touchend', () => { dragging = false; touchState.steer = 0; wheelStick.style.transform = 'translate(-50%,-50%)'; });

  function bindHold(id, key) {
    const el = document.getElementById(id);
    const set = v => e => { touchState[key] = v; e.preventDefault(); };
    el.addEventListener('touchstart', set(true), { passive: false });
    el.addEventListener('touchend', set(false));
    el.addEventListener('touchcancel', set(false));
  }
  bindHold('btnAccel', 'accel');
  bindHold('btnBrake', 'brake');
  bindHold('btnDrs', 'drs');

  if ('ontouchstart' in window) document.getElementById('touchControls').classList.add('show');

  document.querySelectorAll('.camBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.camBtn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      cameraMode = btn.dataset.c;
    });
  });

  window.addEventListener('keydown', e => {
    if (e.code === 'Digit1') setCam('chase');
    if (e.code === 'Digit2') setCam('cockpit');
    if (e.code === 'Digit3') setCam('tcam');
    if (e.code === 'Digit4') setCam('heli');
    if (e.code === 'Escape') togglePause();
  });

  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  document.getElementById('resumeBtn').addEventListener('click', togglePause);
  document.getElementById('restartBtn').addEventListener('click', () => { togglePause(); startSession(); });
  document.getElementById('quitBtn').addEventListener('click', () => { togglePause(); backToTitle(); });
}

function setCam(mode) {
  cameraMode = mode;
  document.querySelectorAll('.camBtn').forEach(b => b.classList.toggle('on', b.dataset.c === mode));
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  document.getElementById('pauseMenu').classList.toggle('show', paused);
}

function getPlayerInput() {
  let steer = 0, throttle = 0, brake = 0, drsReq = false, handbrake = false;
  if (keys['KeyA'] || keys['ArrowLeft']) steer -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) steer += 1;
  if (keys['KeyW'] || keys['ArrowUp']) throttle = 1;
  if (keys['KeyS'] || keys['ArrowDown']) brake = 1;
  if (keys['ShiftLeft'] || keys['ShiftRight']) drsReq = true;
  if (keys['Space']) handbrake = true;

  if (touchState.steer) steer += touchState.steer;
  if (touchState.accel) throttle = 1;
  if (touchState.brake) brake = 1;
  if (touchState.drs) drsReq = true;

  steer = Math.max(-1, Math.min(1, steer));
  return { steer, throttle, brake, drsReq, handbrake };
}

function updateTireAndFuel(car, dt, throttle, brake, steerAbs) {
  const wearRate = TIRE_COMPOUNDS[car.compound].wearRate;
  const load = 0.004 * wearRate * (0.4 + throttle * 0.4 + brake * 0.5 + steerAbs * 0.6) * (car.speedKmh / 200 + 0.2);
  car.tireWear = Math.max(0, car.tireWear - load * dt * 6);
  car.tireTemp += ((70 + throttle * 40 + steerAbs * 20) - car.tireTemp) * dt * 0.5;
  car.fuel = Math.max(0, car.fuel - dt * 0.0028 * (0.3 + throttle * 0.9));
}

function checkOffTrack(car) {
  const { samples, normals } = trackData;
  const idx = car.trackIndex;
  const p = samples[idx];
  const nor = normals[idx];
  const pos = car.chassisBody.position;
  const dx = pos.x - p.x, dz = pos.z - p.z;
  const lateral = dx * nor.x + dz * nor.z;
  const offAmount = Math.abs(lateral) - TRACK_WIDTH / 2;
  car.offTrack = offAmount > 0.3;
  return offAmount;
}

function updateLapProgress(car, dt, now) {
  const n = trackData.samples.length;
  const prevIdx = car.trackIndex;
  let best = -1, bestD = Infinity;
  const { samples } = trackData;
  const searchStart = prevIdx || 0;
  for (let off = -50; off <= 50; off++) {
    const i = ((searchStart + off) % n + n) % n;
    const dx = samples[i].x - car.chassisBody.position.x;
    const dz = samples[i].z - car.chassisBody.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const wrapped = prevIdx > n * 0.8 && best < n * 0.2;
  if (wrapped) {
    car.lap += 1;
    const lapTime = now - car.lapStartTime;
    car.lastLapTime = lapTime;
    if (!car.bestLapTime || lapTime < car.bestLapTime) car.bestLapTime = lapTime;
    car.lapStartTime = now;
  }
  car.trackIndex = best;
  car.raceProgress = (car.lap + best / n) / totalLaps;
  car.inDrsZone = best >= drsZoneStartIdx && best <= drsZoneEndIdx;
}

function rankCars() {
  const ranked = [...allCars].sort((a, b) => (b.lap + b.trackIndex / trackData.samples.length) - (a.lap + a.trackIndex / trackData.samples.length));
  ranked.forEach((c, i) => { c.position = i + 1; });
  return ranked;
}

function handlePitLogic(car, dt) {
  if (!pitLaneData) return;
  const pos = car.chassisBody.position;
  let nearestD = Infinity;
  pitLaneData.points.forEach(p => {
    const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
    if (d < nearestD) nearestD = d;
  });
  const inPitLane = nearestD < 36;
  if (car.isPlayer) {
    document.getElementById('pitPrompt').style.display = inPitLane ? 'block' : 'none';
  }
  if (inPitLane && car.speedKmh < 80) {
    car.pit.timer += dt;
    if (car.pit.timer > 2.2 && !car.pit.servicing) {
      car.pit.servicing = true;
      car.tireWear = 1.0;
      car.tireTemp = 70;
      car.damage = { front: 0, rear: 0, side: 0, susp: 0, engine: 0 };
      if (car.wantsWetTires) car.compound = currentWeather === 'storm' ? 'wet' : 'inter';
      else if (car.wantsSlickTires) car.compound = settings.tire;
      sound && sound.playPitBeep();
    }
  } else {
    car.pit.timer = 0;
    car.pit.servicing = false;
  }
}

function handleCollisions(dt) {
  for (let i = 0; i < allCars.length; i++) {
    for (let j = i + 1; j < allCars.length; j++) {
      const a = allCars[i], b = allCars[j];
      const pa = a.chassisBody.position, pb = b.chassisBody.position;
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 2.6 && dist > 0.001) {
        const push = (2.6 - dist) * 0.5;
        const nx = dx / dist, nz = dz / dist;
        a.chassisBody.velocity.x -= nx * push * 3;
        a.chassisBody.velocity.z -= nz * push * 3;
        b.chassisBody.velocity.x += nx * push * 3;
        b.chassisBody.velocity.z += nz * push * 3;
        const impact = Math.abs(a.chassisBody.velocity.x - b.chassisBody.velocity.x) + Math.abs(a.chassisBody.velocity.z - b.chassisBody.velocity.z);
        if (impact > 6 && a.crashCooldown <= 0 && b.crashCooldown <= 0) {
          a.damage.side = Math.min(1, a.damage.side + 0.15);
          b.damage.side = Math.min(1, b.damage.side + 0.15);
          a.crashCooldown = 1; b.crashCooldown = 1;
          if (a.isPlayer || b.isPlayer) sound && sound.playCrash();
          triggerYellowFlag();
        }
      }
    }
    if (allCars[i].crashCooldown > 0) allCars[i].crashCooldown -= dt;
  }
}

let yellowTimer = 0;
function triggerYellowFlag() {
  flagState = 'YELLOW';
  yellowTimer = 4;
}

const camTmp = new THREE.Vector3();
function updateCamera(dt) {
  if (!playerCar) return;
  const body = playerCar.chassisBody;
  const carPos = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
  const q = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

  if (cameraMode === 'chase') {
    const desired = carPos.clone().addScaledVector(forward, -9).addScaledVector(new THREE.Vector3(0, 1, 0), 3.4);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camTmp.copy(carPos).addScaledVector(forward, 4).y += 1.0;
    camera.lookAt(camTmp);
  } else if (cameraMode === 'cockpit') {
    const desired = carPos.clone().addScaledVector(forward, 0.3).addScaledVector(new THREE.Vector3(0, 1, 0), 0.75);
    camera.position.lerp(desired, Math.min(1, dt * 14));
    camTmp.copy(carPos).addScaledVector(forward, 20).y += 0.7;
    camera.lookAt(camTmp);
  } else if (cameraMode === 'tcam') {
    const desired = carPos.clone().addScaledVector(forward, 1.2).addScaledVector(new THREE.Vector3(0, 1, 0), 1.7);
    camera.position.lerp(desired, Math.min(1, dt * 10));
    camTmp.copy(carPos).addScaledVector(forward, 15).y += 1.2;
    camera.lookAt(camTmp);
  } else if (cameraMode === 'heli') {
    const desired = carPos.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 32).addScaledVector(forward, -14);
    camera.position.lerp(desired, Math.min(1, dt * 2.2));
    camera.lookAt(carPos);
  }
}

function fmtTime(ms) {
  if (ms == null) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`;
}

const minimapCanvas = document.getElementById('minimap');
const mmCtx = minimapCanvas.getContext('2d');
function drawMinimap() {
  const w = minimapCanvas.width, h = minimapCanvas.height;
  mmCtx.clearRect(0, 0, w, h);
  const pts = trackData.samples;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  pts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
  const pad = 10;
  const sx = (w - pad * 2) / (maxX - minX);
  const sz = (h - pad * 2) / (maxZ - minZ);
  const s = Math.min(sx, sz);
  const project = p => [pad + (p.x - minX) * s, pad + (p.z - minZ) * s];
  mmCtx.strokeStyle = 'rgba(255,255,255,.5)';
  mmCtx.lineWidth = 3;
  mmCtx.beginPath();
  pts.forEach((p, i) => { const [x, y] = project(p); if (i === 0) mmCtx.moveTo(x, y); else mmCtx.lineTo(x, y); });
  mmCtx.closePath(); mmCtx.stroke();

  allCars.forEach(c => {
    const [x, y] = project(c.chassisBody.position);
    mmCtx.fillStyle = c.isPlayer ? '#00e5ff' : '#e10600';
    mmCtx.beginPath(); mmCtx.arc(x, y, c.isPlayer ? 4 : 2.6, 0, Math.PI * 2); mmCtx.fill();
  });
}

function showMessage(big, small, ms) {
  const el = document.getElementById('msgCenter');
  document.getElementById('msgBig').textContent = big;
  document.getElementById('msgSmall').textContent = small || '';
  el.style.opacity = 1;
  clearTimeout(showMessage._t);
  if (ms) showMessage._t = setTimeout(() => { el.style.opacity = 0; }, ms);
}

function updateHud() {
  if (!playerCar) return;
  document.getElementById('speedVal').textContent = Math.round(playerCar.speedKmh);
  document.getElementById('gearVal').textContent = playerCar.speedKmh < 3 ? 'N' : playerCar.gear;
  document.getElementById('rpmFill').style.width = `${Math.round(playerCar.rpm * 100)}%`;
  document.getElementById('tireBar').style.width = `${Math.round(playerCar.tireWear * 100)}%`;
  document.getElementById('fuelBar').style.width = `${Math.round(playerCar.fuel * 100)}%`;
  document.getElementById('compoundVal').textContent = TIRE_COMPOUNDS[playerCar.compound].label;
  document.getElementById('drsChip').textContent = playerCar.drsOpen ? 'OPEN' : (playerCar.inDrsZone ? 'READY' : 'STANDBY');
  document.getElementById('drsChip').classList.toggle('on', playerCar.drsOpen);
  document.getElementById('ersChip').textContent = `${Math.round(playerCar.ers * 100)}%`;
  document.getElementById('ersChip').classList.toggle('on', playerCar.ers > 0.6);
  document.getElementById('posVal').innerHTML = `${playerCar.position || 1}<span>/ ${allCars.length}</span>`;
  const lapShown = Math.min(playerCar.lap + 1, totalLaps);
  document.getElementById('lapVal').textContent = settings.session === 'qualifying' ? `LAP ${playerCar.lap + 1}` : `LAP ${lapShown}/${totalLaps}`;
  document.getElementById('lastLap').textContent = fmtTime(playerCar.lastLapTime);
  document.getElementById('bestLap').textContent = fmtTime(playerCar.bestLapTime);

  const ranked = rankCars();
  const myIdx = ranked.indexOf(playerCar);
  if (myIdx > 0) {
    const ahead = ranked[myIdx - 1];
    const gapDist = ((ahead.lap + ahead.trackIndex / trackData.samples.length) - (playerCar.lap + playerCar.trackIndex / trackData.samples.length)) * trackData.length;
    const gapTime = gapDist / Math.max(10, playerCar.speedKmh / 3.6);
    document.getElementById('gapVal').textContent = `-${gapTime.toFixed(1)}s`;
  } else {
    document.getElementById('gapVal').textContent = 'LEADER';
  }

  document.getElementById('weatherLabel').textContent = { clear: 'CLEAR', cloudy: 'CLOUDY', rain: 'RAIN', storm: 'STORM' }[currentWeather] || 'CLEAR';
  document.getElementById('weatherIcon').textContent = { clear: '☀', cloudy: '☁', rain: '🌧', storm: '⛈' }[currentWeather] || '☀';

  const flagEl = document.getElementById('flagState');
  const stripEl = document.getElementById('flagStrip');
  const flagColors = { GREEN: 'var(--green)', YELLOW: 'var(--amber)', RED: 'var(--f1red)', CHECKERED: '#fff', SC: 'var(--amber)' };
  flagEl.textContent = flagState + ' FLAG';
  stripEl.style.background = flagColors[flagState] || 'var(--green)';

  drawMinimap();
}

function step() {
  requestAnimationFrame(step);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!running || paused) { renderer.render(scene, camera); return; }

  const now = performance.now();

  if (yellowTimer > 0) { yellowTimer -= dt; if (yellowTimer <= 0) flagState = 'GREEN'; }

  world.step(1 / 60, dt, 5);

  const input = getPlayerInput();
  playerCar.drsAllowed = playerCar.inDrsZone;
  playerCar.drsOpen = input.drsReq && playerCar.inDrsZone;
  applyDrive(playerCar, { throttle: input.throttle, brake: input.brake, steer: input.steer, handbrake: input.handbrake });
  updateTireAndFuel(playerCar, dt, input.throttle, input.brake, Math.abs(input.steer));
  checkOffTrack(playerCar);
  syncCarVisual(playerCar, dt);
  updateLapProgress(playerCar, dt, now);
  handlePitLogic(playerCar, dt);

  aiCars.forEach((car, i) => {
    const brain = aiBrains[i];
    const cmd = updateAiDrive(brain, car, trackData, allCars, dt, currentWeather);
    applyDrive(car, cmd);
    updateTireAndFuel(car, dt, cmd.throttle, cmd.brake, Math.abs(cmd.steer));
    checkOffTrack(car);
    syncCarVisual(car, dt);
    updateLapProgress(car, dt, now);
    handlePitLogic(car, dt);
    if (car.wantsPit && car.pit.servicing) { brain.hasPitted = true; car.wantsPit = false; }
  });

  handleCollisions(dt);
  rankCars();
  updateCamera(dt);
  animateRain(dt);

  if (sound) {
    sound.updateEngine('player', playerCar.rpm, playerCar.speedKmh, true);
    aiCars.forEach((c, i) => sound.updateEngine('ai' + i, c.rpm, c.speedKmh, false));
  }

  checkSessionEnd(now);
  updateHud();

  renderer.render(scene, camera);
}

function checkSessionEnd(now) {
  if (sessionOver) return;
  if (settings.session === 'qualifying') {
    const remain = qualiTimeLimit - (now - raceStartTime) / 1000;
    if (remain <= 0) {
      sessionOver = true;
      showMessage('SESSION FINISHED', playerCar.bestLapTime ? `BEST LAP ${fmtTime(playerCar.bestLapTime)}` : 'NO TIME SET');
      flagState = 'CHECKERED';
      saveBest();
    }
  } else if (settings.session !== 'practice') {
    if (playerCar.lap >= totalLaps) {
      sessionOver = true;
      flagState = 'CHECKERED';
      const ranked = rankCars();
      const pos = ranked.indexOf(playerCar) + 1;
      showMessage('RACE FINISHED', `FINISHED P${pos}`);
      saveBest();
    }
  }
}

function saveBest() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    if (playerCar.bestLapTime && (!data.bestLap || playerCar.bestLapTime < data.bestLap)) {
      data.bestLap = playerCar.bestLapTime;
    }
    data.settings = settings;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function loadBest() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    if (data.bestLap) {
      document.getElementById('bestLapDisplay').textContent = `過去のベストラップ: ${fmtTime(data.bestLap)}`;
    }
  } catch (e) {}
}

function startSession() {
  document.getElementById('start').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('loading').style.display = 'none';

  if (playerCar) clearCars();
  setupCars();
  setSky(currentWeather, settings.timeOfDay);

  totalLaps = settings.session === 'sprint' ? 8 : settings.session === 'gp' ? 15 : 999;
  sessionOver = false;
  flagState = 'GREEN';
  raceStartTime = performance.now();
  playerCar.lapStartTime = raceStartTime;
  aiCars.forEach(c => c.lapStartTime = raceStartTime);

  showMessage('LIGHTS OUT', settings.session === 'qualifying' ? 'アタックラップ開始!' : 'レーススタート!', 2500);
  running = true;
  paused = false;
  if (sound) sound.start();
}

function backToTitle() {
  running = false;
  document.getElementById('hud').style.display = 'none';
  document.getElementById('start').style.display = 'flex';
  loadBest();
}

function initStartUI() {
  function bindGroup(id, key, cast = v => v) {
    document.querySelectorAll(`#${id} .opt`).forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll(`#${id} .opt`).forEach(o => o.classList.remove('sel'));
        opt.classList.add('sel');
        settings[key] = cast(opt.dataset.v);
      });
    });
  }
  bindGroup('sessionOpts', 'session');
  bindGroup('tireOpts', 'tire');
  bindGroup('weatherOpts', 'weather');
  bindGroup('diffOpts', 'difficulty');
  bindGroup('aiCountOpts', 'aiCount', v => parseInt(v, 10));
  bindGroup('todOpts', 'timeOfDay');

  document.getElementById('goBtn').addEventListener('click', () => {
    currentWeather = settings.weather === 'random'
      ? ['clear', 'cloudy', 'rain', 'storm'][Math.floor(Math.random() * 4)]
      : settings.weather;
    startSession();
  });
}

function boot() {
  initThree();
  initLights();
  initPhysics();
  buildCircuit();
  initInput();
  initStartUI();
  sound = new SoundEngine();
  window.addEventListener('pointerdown', () => sound && sound.start(), { once: true });
  window.addEventListener('touchstart', () => sound && sound.start(), { once: true });

  loadBest();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('start').style.display = 'flex';

  clock.start();
  requestAnimationFrame(step);
}

boot();
