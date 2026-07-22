import * as THREE from 'three';

export const CONTROL_POINTS = [
  [0, 0], [0, 140], [26, 245], [78, 292], [128, 268], [150, 210],
  [128, 165], [168, 128], [214, 148], [252, 190], [296, 172],
  [326, 128], [316, 66], [268, 34], [226, 62], [236, 122],
  [222, 210], [196, 292], [138, 336], [78, 322], [40, 272],
  [58, 214], [104, 186], [86, 128], [40, 108], [2, 86],
];

export const TRACK_WIDTH = 15;
export const PIT_LANE_WIDTH = 8;

function toVec3Array(points) {
  return points.map(p => new THREE.Vector3(p[0], 0, p[1]));
}

export function buildTrackData() {
  const rawPoints = toVec3Array(CONTROL_POINTS);
  const curve = new THREE.CatmullRomCurve3(rawPoints, true, 'catmullrom', 0.5);
  const SAMPLES = 480;
  const samples = curve.getSpacedPoints(SAMPLES);
  const tangents = [];
  const normals = [];
  const curvature = [];
  let length = 0;
  const cumLen = [0];

  for (let i = 0; i < samples.length; i++) {
    const p0 = samples[(i - 1 + samples.length) % samples.length];
    const p1 = samples[(i + 1) % samples.length];
    const tangent = new THREE.Vector3().subVectors(p1, p0).normalize();
    tangents.push(tangent);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    normals.push(normal);
  }
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].distanceTo(samples[i - 1]);
    length += d;
    cumLen.push(length);
  }
  length += samples[0].distanceTo(samples[samples.length - 1]);
  cumLen.push(length);

  for (let i = 0; i < samples.length; i++) {
    const t0 = tangents[(i - 3 + tangents.length) % tangents.length];
    const t1 = tangents[(i + 3) % tangents.length];
    const angle = t0.angleTo(t1);
    curvature.push(angle);
  }

  return { samples, tangents, normals, curvature, cumLen, length, curve };
}

function makeAsphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2e33';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    const v = 30 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v + 10},${v + 10},${v + 12},${0.15 + Math.random() * 0.2})`;
    const x = Math.random() * 256, y = Math.random() * 256;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeCurbTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#d81c1c' : '#f2f2f2';
    ctx.fillRect(0, i * 8, 64, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.rotation = Math.PI / 2;
  return tex;
}

function makeGrassTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2c5a2f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const v = Math.random() * 30;
    ctx.fillStyle = `rgba(${30 + v},${90 + v},${40 + v},0.3)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  return tex;
}

export function buildTrackMesh(trackData) {
  const { samples, normals } = trackData;
  const n = samples.length;
  const positions = [];
  const uvs = [];
  const indices = [];
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const p = samples[idx];
    const nor = normals[idx];
    const left = new THREE.Vector3().copy(p).addScaledVector(nor, half);
    const right = new THREE.Vector3().copy(p).addScaledVector(nor, -half);
    positions.push(left.x, 0.02, left.z, right.x, 0.02, right.z);
    const v = (i / 18) % 1;
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: makeAsphaltTexture(), roughness: 0.95, metalness: 0.0,
    side: THREE.DoubleSide,
  });
  mat.map.repeat.set(1, Math.round(trackData.length / 8));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildCurbs(trackData) {
  const { samples, normals, curvature } = trackData;
  const n = samples.length;
  const group = new THREE.Group();
  const curbTex = makeCurbTexture();
  const positionsOut = [], positionsIn = [], uvsOut = [], uvsIn = [];
  const curbWidth = 1.6;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const p = samples[idx];
    const nor = normals[idx];
    const isCorner = curvature[idx] > 0.05;
    const w = isCorner ? curbWidth : 0.0001;
    const o1 = new THREE.Vector3().copy(p).addScaledVector(nor, half);
    const o2 = new THREE.Vector3().copy(p).addScaledVector(nor, half + w);
    positionsOut.push(o1.x, 0.03, o1.z, o2.x, 0.03, o2.z);
    const i1 = new THREE.Vector3().copy(p).addScaledVector(nor, -half);
    const i2 = new THREE.Vector3().copy(p).addScaledVector(nor, -half - w);
    positionsIn.push(i1.x, 0.03, i1.z, i2.x, 0.03, i2.z);
    const v = i * 0.6;
    uvsOut.push(0, v, 1, v);
    uvsIn.push(0, v, 1, v);
  }
  function buildSide(positions, uvArr) {
    const indices = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
  group.add(buildSide(positionsOut, uvsOut));
  group.add(buildSide(positionsIn, uvsIn));
  return group;
}

export function buildGround() {
  const geo = new THREE.PlaneGeometry(4000, 4000);
  const mat = new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildBarriers(trackData) {
  const { samples, normals } = trackData;
  const n = samples.length;
  const group = new THREE.Group();
  const tireGeo = new THREE.TorusGeometry(0.42, 0.22, 6, 10);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const barrierColliders = [];
  const step = 3;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i += step) {
    const p = samples[i];
    const nor = normals[i];
    const tangent = trackData.tangents[i];
    const ry = Math.atan2(tangent.x, tangent.z);
    const nearPitEntry = i < 45 || i > n - 15;
    [1, -1].forEach(side => {
      if (side === 1 && nearPitEntry) return;
      const offset = (half + 3.2) * side;
      const pos = new THREE.Vector3().copy(p).addScaledVector(nor, offset);
      const stack = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(tireGeo, tireMat);
        t.rotation.x = Math.PI / 2;
        t.position.set(k * 0.85 - 0.85, 0.42, 0);
        t.castShadow = true;
        stack.add(t);
      }
      stack.position.copy(pos);
      stack.rotation.y = ry;
      group.add(stack);
      barrierColliders.push({ x: pos.x, z: pos.z, hx: 2.0, hz: 0.9, ry });
    });
  }
  return { mesh: group, colliders: barrierColliders };
}

export function buildGrandstands(trackData) {
  const { samples, normals } = trackData;
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(18, 6, 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x33414f, roughness: 0.9 });
  const roofGeo = new THREE.BoxGeometry(19, 0.6, 6);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1c2530 });
  const spots = [40, 120, 210, 300, 380, 440];
  spots.forEach(i => {
    const idx = i % samples.length;
    const p = samples[idx];
    const nor = normals[idx];
    const offset = TRACK_WIDTH / 2 + 14;
    const stand = new THREE.Group();
    const box = new THREE.Mesh(geo, mat); box.position.y = 3; box.castShadow = true;
    const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.y = 6.4;
    stand.add(box, roof);
    stand.position.set(p.x + nor.x * offset, 0, p.z + nor.z * offset);
    const t = trackData.tangents[idx];
    stand.rotation.y = Math.atan2(t.x, t.z);
    group.add(stand);
  });
  return group;
}

export function buildTrees(trackData) {
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.32, 2.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.6, 3.4, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4229 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34 });
  const count = 160;
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, count);
  trunkMesh.castShadow = true; leafMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  const { samples, normals } = trackData;
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i / count) * samples.length);
    const p = samples[idx];
    const nor = normals[idx];
    const side = Math.random() > 0.5 ? 1 : -1;
    const dist = TRACK_WIDTH / 2 + 22 + Math.random() * 60;
    const jitter = (Math.random() - 0.5) * 14;
    const t = trackData.tangents[idx];
    const x = p.x + nor.x * side * dist + t.x * jitter;
    const z = p.z + nor.z * side * dist + t.z * jitter;
    const s = 0.7 + Math.random() * 0.8;
    dummy.position.set(x, 1.2 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 2.6 * s + 1.2, z);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(i, dummy.matrix);
  }
  const group = new THREE.Group();
  group.add(trunkMesh, leafMesh);
  return group;
}

export function buildSignage(trackData, drsStartIdx, finishIdx) {
  const group = new THREE.Group();
  function makeSign(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px Rajdhani, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(8, 2);
    return new THREE.Mesh(geo, mat);
  }
  function place(idx, text, color, height = 5) {
    const p = trackData.samples[idx % trackData.samples.length];
    const nor = trackData.normals[idx % trackData.samples.length];
    const t = trackData.tangents[idx % trackData.samples.length];
    const sign = makeSign(text, color);
    const offset = TRACK_WIDTH / 2 + 6;
    sign.position.set(p.x + nor.x * offset, height, p.z + nor.z * offset);
    sign.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, height, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(sign.position.x, height / 2, sign.position.z);
    group.add(sign, pole);
  }
  place(drsStartIdx, 'DRS ZONE', '#00b8d9');
  place(finishIdx, 'APEX GP', '#e10600', 6);
  return group;
}

export function buildPitLane(trackData) {
  const startIdx = 0;
  const group = new THREE.Group();
  const pitPoints = [];
  const n = trackData.samples.length;
  const span = 40;
  for (let i = -10; i < span; i++) {
    const idx = ((startIdx + i) % n + n) % n;
    const p = trackData.samples[idx];
    const nor = trackData.normals[idx];
    const offset = TRACK_WIDTH / 2 + 9;
    pitPoints.push(new THREE.Vector3(p.x + nor.x * offset, 0.015, p.z + nor.z * offset));
  }
  const positions = [];
  const half = PIT_LANE_WIDTH / 2;
  for (let i = 0; i < pitPoints.length; i++) {
    const p = pitPoints[i];
    const p2 = pitPoints[Math.min(i + 1, pitPoints.length - 1)];
    const dir = new THREE.Vector3().subVectors(p2, p).normalize();
    const nor = new THREE.Vector3(-dir.z, 0, dir.x);
    if (nor.lengthSq() < 0.0001) nor.set(1, 0, 0);
    positions.push(p.x + nor.x * half, 0.015, p.z + nor.z * half, p.x - nor.x * half, 0.015, p.z - nor.z * half);
  }
  const indices = [];
  for (let i = 0; i < pitPoints.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);

  const garageGeo = new THREE.BoxGeometry(6, 5, 8);
  const garageMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.6 });
  for (let i = 0; i < 8; i++) {
    const idx = ((startIdx - 4 + i * 4) % n + n) % n;
    const p = trackData.samples[idx];
    const nor = trackData.normals[idx];
    const offset = TRACK_WIDTH / 2 + 18;
    const garage = new THREE.Mesh(garageGeo, garageMat);
    garage.position.set(p.x + nor.x * offset, 2.5, p.z + nor.z * offset);
    const t = trackData.tangents[idx];
    garage.rotation.y = Math.atan2(t.x, t.z);
    garage.castShadow = true;
    group.add(garage);
  }
  return { mesh: group, points: pitPoints };
}

export function nearestOnTrack(trackData, x, z) {
  const { samples } = trackData;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const dx = samples[i].x - x, dz = samples[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, distance: Math.sqrt(bestD) };
}
