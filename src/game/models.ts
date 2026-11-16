import * as THREE from 'three';
import type { RatSex, ToolType } from './types';

const sharedGeo = {
  ratTorso: new THREE.SphereGeometry(0.18, 14, 12),
  ratHaunch: new THREE.SphereGeometry(0.165, 12, 10),
  ratHead: new THREE.SphereGeometry(0.135, 12, 10),
  ratSnout: new THREE.ConeGeometry(0.082, 0.15, 10),
  ratNose: new THREE.SphereGeometry(0.026, 8, 8),
  ratEar: new THREE.CylinderGeometry(0.072, 0.072, 0.024, 12),
  ratEarInner: new THREE.CylinderGeometry(0.045, 0.045, 0.026, 10),
  ratEye: new THREE.SphereGeometry(0.024, 8, 8),
  ratWhisker: new THREE.CylinderGeometry(0.004, 0.002, 0.14, 4),
  ratPaw: new THREE.SphereGeometry(0.034, 8, 8),
  ratTail1: new THREE.CylinderGeometry(0.022, 0.015, 0.2, 8),
  ratTail2: new THREE.CylinderGeometry(0.015, 0.007, 0.2, 8),
  ratShadow: new THREE.PlaneGeometry(0.56, 0.56),
  statusRing: new THREE.RingGeometry(0.24, 0.29, 20),
  cloudPuff: new THREE.DodecahedronGeometry(0.24, 1),
  cloudBase: new THREE.PlaneGeometry(0.88, 0.88),
};

let cachedPoisonSignTex: THREE.CanvasTexture | null = null;

function getPoisonWarningTexture(): THREE.CanvasTexture {
  if (cachedPoisonSignTex) return cachedPoisonSignTex;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  // Yellow warning triangle with thick rounded black border (matching reference)
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const topX = 128;
  const topY = 24;
  const rightX = 234;
  const rightY = 216;
  const leftX = 22;
  const leftY = 216;

  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.lineTo(rightX, rightY);
  ctx.lineTo(leftX, leftY);
  ctx.closePath();
  ctx.fillStyle = '#facc15';
  ctx.fill();
  ctx.lineWidth = 22;
  ctx.strokeStyle = '#111827';
  ctx.stroke();

  // Inner yellow triangle fill to crisp up inner edge
  ctx.beginPath();
  ctx.moveTo(topX, topY + 12);
  ctx.lineTo(rightX - 10, rightY - 6);
  ctx.lineTo(leftX + 10, leftY - 6);
  ctx.closePath();
  ctx.fillStyle = '#facc15';
  ctx.fill();

  // Crossed bones behind skull
  const cx = 128;
  const cy = 152;
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 13;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx - 52, cy + dir * 24);
    ctx.lineTo(cx + 52, cy - dir * 24);
    ctx.stroke();
    // Bone knobs
    for (const [bx, by] of [
      [cx - 52, cy + dir * 24],
      [cx + 52, cy - dir * 24],
    ]) {
      ctx.beginPath();
      ctx.arc(bx - 3, by - 4, 6, 0, Math.PI * 2);
      ctx.arc(bx + 3, by + 4, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#111827';
      ctx.fill();
    }
  }

  // Skull cranium
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 7;

  ctx.beginPath();
  ctx.arc(cx, 128, 28, Math.PI * 0.85, Math.PI * 2.15);
  ctx.lineTo(cx + 18, 158);
  ctx.lineTo(cx - 18, 158);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Eye sockets
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(cx - 11, 130, 6.5, 0, Math.PI * 2);
  ctx.arc(cx + 11, 130, 6.5, 0, Math.PI * 2);
  ctx.fill();

  // Nose cavity
  ctx.beginPath();
  ctx.moveTo(cx, 137);
  ctx.lineTo(cx - 4.5, 146);
  ctx.lineTo(cx + 4.5, 146);
  ctx.closePath();
  ctx.fill();

  // Jaw teeth bar
  ctx.fillRect(cx - 13, 150, 26, 6);
  ctx.fillStyle = '#facc15';
  for (const tx of [-8, -2, 4]) {
    ctx.fillRect(cx + tx, 151, 2.5, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedPoisonSignTex = tex;
  return tex;
}

export interface RatMeshRefs {
  group: THREE.Group;
  actor: THREE.Group;
  torso: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  skinMat: THREE.MeshStandardMaterial;
  tailPivot: THREE.Group;
  paws: THREE.Mesh[];
  statusRing: THREE.Mesh;
}

export function getRatPalette(sex: RatSex, isBaby: boolean, infected: boolean, sterile: boolean) {
  if (infected) {
    return { fur: 0x658330, skin: 0x9ca38f };
  }
  if (isBaby) {
    return { fur: 0xf1e8d6, skin: 0xe6b8b8 };
  }
  if (sex === 'M') {
    return { fur: 0x2563eb, skin: 0xd9c2be };
  }
  return {
    fur: sterile ? 0x9d647b : 0xdb2777,
    skin: sterile ? 0x9ca38f : 0xf2b8cc,
  };
}

export function createRatModel(
  sex: RatSex,
  isBaby: boolean,
  infected: boolean,
  contactShadowTex: THREE.Texture,
): RatMeshRefs {
  const group = new THREE.Group();
  const pal = getRatPalette(sex, isBaby, infected, false);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: pal.fur,
    roughness: 0.88,
    metalness: 0.0,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: pal.skin,
    roughness: 0.82,
    metalness: 0.0,
  });

  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.4,
    metalness: 0.0,
  });

  const whiskerMat = new THREE.MeshStandardMaterial({
    color: 0x3b3530,
    roughness: 0.9,
    metalness: 0.0,
  });

  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(sharedGeo.ratShadow, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.014;
  group.add(shadowPlane);

  const statusRingMat = new THREE.MeshBasicMaterial({
    color: 0xc81e4a,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const statusRing = new THREE.Mesh(sharedGeo.statusRing, statusRingMat);
  statusRing.rotation.x = -Math.PI / 2;
  statusRing.position.y = 0.021;
  statusRing.visible = infected;
  if (infected) statusRingMat.color.setHex(0x658330);
  group.add(statusRing);

  const actor = new THREE.Group();
  if (isBaby) actor.scale.setScalar(0.58);
  group.add(actor);

  const torso = new THREE.Mesh(sharedGeo.ratTorso, bodyMat);
  torso.scale.set(0.98, 0.86, 1.32);
  torso.position.set(0, 0.155, -0.02);
  torso.castShadow = true;
  actor.add(torso);

  const haunch = new THREE.Mesh(sharedGeo.ratHaunch, bodyMat);
  haunch.scale.set(1.08, 0.95, 1.08);
  haunch.position.set(0, 0.155, -0.15);
  haunch.castShadow = true;
  actor.add(haunch);

  const head = new THREE.Mesh(sharedGeo.ratHead, bodyMat);
  head.scale.set(0.96, 0.88, 1.06);
  head.position.set(0, 0.175, 0.18);
  head.castShadow = true;
  actor.add(head);

  const snout = new THREE.Mesh(sharedGeo.ratSnout, bodyMat);
  snout.rotation.x = Math.PI / 2.08;
  snout.position.set(0, 0.155, 0.295);
  snout.castShadow = true;
  actor.add(snout);

  const nose = new THREE.Mesh(sharedGeo.ratNose, skinMat);
  nose.position.set(0, 0.15, 0.375);
  actor.add(nose);

  const earL = new THREE.Mesh(sharedGeo.ratEar, bodyMat);
  earL.rotation.set(Math.PI * 0.38, 0, -0.4);
  earL.position.set(-0.105, 0.275, 0.13);
  earL.castShadow = true;
  actor.add(earL);

  const earLIn = new THREE.Mesh(sharedGeo.ratEarInner, skinMat);
  earLIn.rotation.copy(earL.rotation);
  earLIn.position.set(-0.104, 0.274, 0.134);
  actor.add(earLIn);

  const earR = new THREE.Mesh(sharedGeo.ratEar, bodyMat);
  earR.rotation.set(Math.PI * 0.38, 0, 0.4);
  earR.position.set(0.105, 0.275, 0.13);
  earR.castShadow = true;
  actor.add(earR);

  const earRIn = new THREE.Mesh(sharedGeo.ratEarInner, skinMat);
  earRIn.rotation.copy(earR.rotation);
  earRIn.position.set(0.104, 0.274, 0.134);
  actor.add(earRIn);

  const eyeL = new THREE.Mesh(sharedGeo.ratEye, eyeMat);
  eyeL.position.set(-0.072, 0.205, 0.265);
  actor.add(eyeL);

  const eyeR = new THREE.Mesh(sharedGeo.ratEye, eyeMat);
  eyeR.position.set(0.072, 0.205, 0.265);
  actor.add(eyeR);

  for (const side of [-1, 1]) {
    const w1 = new THREE.Mesh(sharedGeo.ratWhisker, whiskerMat);
    w1.rotation.z = side * (Math.PI * 0.44);
    w1.rotation.y = side * 0.22;
    w1.position.set(side * 0.085, 0.155, 0.32);
    actor.add(w1);

    const w2 = new THREE.Mesh(sharedGeo.ratWhisker, whiskerMat);
    w2.rotation.z = side * (Math.PI * 0.52);
    w2.rotation.y = side * -0.1;
    w2.position.set(side * 0.085, 0.14, 0.315);
    actor.add(w2);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.11, -0.27);
  const tail1 = new THREE.Mesh(sharedGeo.ratTail1, skinMat);
  tail1.rotation.x = Math.PI * 0.56;
  tail1.position.set(0, 0.02, -0.09);
  tailPivot.add(tail1);

  const tail2 = new THREE.Mesh(sharedGeo.ratTail2, skinMat);
  tail2.rotation.x = Math.PI * 0.44;
  tail2.position.set(0, 0.055, -0.24);
  tailPivot.add(tail2);
  actor.add(tailPivot);

  const pawCoords: Array<[number, number, number]> = [
    [-0.1, 0.034, 0.12],
    [0.1, 0.034, 0.12],
    [-0.11, 0.034, -0.14],
    [0.11, 0.034, -0.14],
  ];
  const paws = pawCoords.map(([x, y, z]) => {
    const paw = new THREE.Mesh(sharedGeo.ratPaw, skinMat);
    paw.position.set(x, y, z);
    actor.add(paw);
    return paw;
  });

  return { group, actor, torso, bodyMat, skinMat, tailPivot, paws, statusRing };
}

export function createWhiteGasCloudMesh(): { group: THREE.Group; mat: THREE.MeshLambertMaterial } {
  // Classic fluffy white/light-gray cloud puffs matching the original Rats! gas sprite
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({
    color: 0xf1f5f9,
    transparent: true,
    opacity: 0.86,
  });

  const offsets: Array<[number, number, number, number]> = [
    [0, 0.28, 0, 1.05],
    [-0.22, 0.22, 0.16, 0.82],
    [0.22, 0.24, -0.14, 0.85],
    [-0.16, 0.2, -0.2, 0.78],
    [0.18, 0.2, 0.18, 0.78],
  ];

  for (const [ox, oy, oz, sc] of offsets) {
    const puff = new THREE.Mesh(sharedGeo.cloudPuff, mat);
    puff.position.set(ox, oy, oz);
    puff.scale.setScalar(sc);
    puff.rotation.set(ox * 2, oy * 3, oz * 2);
    group.add(puff);
  }

  return { group, mat };
}

export function createTunnelModel(hexColor: number): {
  group: THREE.Group;
  ring: THREE.Mesh;
} {
  const group = new THREE.Group();

  const stoneRim = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.07, 0.84),
    new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.9,
      metalness: 0.0,
    }),
  );
  stoneRim.position.y = 0.035;
  stoneRim.receiveShadow = true;
  group.add(stoneRim);

  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 18),
    new THREE.MeshBasicMaterial({ color: 0x09090b }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.073;
  group.add(core);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.34, 16),
    new THREE.MeshBasicMaterial({
      color: hexColor,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.076;
  group.add(ring);

  return { group, ring };
}

export function createWallTunnelModel(
  hexColor: number,
  exitDirX: number,
  exitDirZ: number,
): {
  group: THREE.Group;
  ring: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.rotation.y = Math.atan2(exitDirX, exitDirZ);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d24,
    roughness: 0.9,
    metalness: 0.0,
  });

  const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.14), frameMat);
  leftPillar.position.set(-0.22, 0.21, 0.45);
  group.add(leftPillar);

  const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.14), frameMat);
  rightPillar.position.set(0.22, 0.21, 0.45);
  group.add(rightPillar);

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.16), frameMat);
  lintel.position.set(0, 0.45, 0.45);
  group.add(lintel);

  const hole = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.38, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x050507 }),
  );
  hole.position.set(0, 0.19, 0.44);
  group.add(hole);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.25, 4),
    new THREE.MeshBasicMaterial({
      color: hexColor,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.PI / 4;
  ring.position.set(0, 0.74, 0);
  group.add(ring);

  const threshold = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.14),
    new THREE.MeshBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    }),
  );
  threshold.rotation.x = -Math.PI / 2;
  threshold.position.set(0, 0.025, 0.56);
  group.add(threshold);

  return { group, ring };
}

export interface TempBarrierRefs {
  group: THREE.Group;
  signPivot: THREE.Group;
  redMat: THREE.MeshStandardMaterial;
  whiteMat: THREE.MeshStandardMaterial;
  cracks: THREE.Mesh[];
  bites: THREE.Mesh[];
}

export function createTempBarrierModel(): TempBarrierRefs {
  // Classic circular Red & White "No Entry" (Divieto di Accesso) sign
  const group = new THREE.Group();

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.85,
    metalness: 0.1,
  });
  const basePlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.06, 16),
    postMat,
  );
  basePlate.position.y = 0.03;
  basePlate.receiveShadow = true;
  group.add(basePlate);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.08, 0.2, 12),
    postMat,
  );
  post.position.y = 0.13;
  post.castShadow = true;
  group.add(post);

  const signPivot = new THREE.Group();
  signPivot.position.set(0, 0.27, 0);
  signPivot.rotation.x = 0.24; // Angled slightly toward camera for clear 3D readability
  group.add(signPivot);

  const redMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.78,
    metalness: 0.0,
  });

  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.78,
    metalness: 0.0,
  });

  const crackMat = new THREE.MeshBasicMaterial({
    color: 0x111827,
    side: THREE.DoubleSide,
  });

  // Round red disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.41, 0.41, 0.16, 26),
    redMat,
  );
  disc.castShadow = true;
  disc.receiveShadow = true;
  signPivot.add(disc);

  // Subtle white circular border ring on top face
  const borderRing = new THREE.Mesh(
    new THREE.RingGeometry(0.355, 0.405, 26),
    whiteMat,
  );
  borderRing.rotation.x = -Math.PI / 2;
  borderRing.position.y = 0.083;
  signPivot.add(borderRing);

  // Bold horizontal white No-Entry bar
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.172, 0.13),
    whiteMat,
  );
  bar.position.y = 0.002;
  signPivot.add(bar);

  // Progressive jagged dark cracks revealed as barrier HP drops
  const crackSpecs: Array<{ x: number; z: number; len: number; wid: number; rotY: number }> = [
    { x: -0.14, z: -0.14, len: 0.26, wid: 0.032, rotY: 0.65 },
    { x: 0.16, z: 0.12, len: 0.28, wid: 0.034, rotY: -0.55 },
    { x: 0.04, z: -0.18, len: 0.3, wid: 0.036, rotY: 1.35 },
    { x: -0.18, z: 0.16, len: 0.32, wid: 0.038, rotY: -1.15 },
    { x: 0.0, z: 0.02, len: 0.44, wid: 0.042, rotY: 0.32 },
    { x: -0.05, z: 0.0, len: 0.48, wid: 0.045, rotY: -0.82 },
    { x: 0.08, z: -0.04, len: 0.46, wid: 0.048, rotY: 1.85 },
  ];

  const cracks = crackSpecs.map((spec) => {
    const crack = new THREE.Mesh(
      new THREE.BoxGeometry(spec.len, 0.178, spec.wid),
      crackMat,
    );
    crack.position.set(spec.x, 0.003, spec.z);
    crack.rotation.y = spec.rotY;
    crack.visible = false;
    signPivot.add(crack);
    return crack;
  });

  // Edge chip/bite marks revealed at damage milestones
  const biteSpecs: Array<{ x: number; z: number; r: number; rotY: number }> = [
    { x: 0.34, z: -0.14, r: 0.11, rotY: 0.4 },
    { x: -0.33, z: 0.16, r: 0.12, rotY: 1.2 },
    { x: 0.14, z: 0.34, r: 0.13, rotY: 0.8 },
    { x: -0.18, z: -0.33, r: 0.13, rotY: 2.1 },
  ];

  const bites = biteSpecs.map((spec) => {
    const bite = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.r, spec.r * 0.85, 0.182, 5),
      crackMat,
    );
    bite.position.set(spec.x, 0.002, spec.z);
    bite.rotation.y = spec.rotY;
    bite.visible = false;
    signPivot.add(bite);
    return bite;
  });

  return { group, signPivot, redMat, whiteMat, cracks, bites };
}

export function createToolModel(type: ToolType): {
  group: THREE.Group;
  accentMesh?: THREE.Mesh;
} {
  const group = new THREE.Group();

  if (type === 'bomb') {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.75,
        metalness: 0.15,
      }),
    );
    sphere.position.y = 0.25;
    sphere.castShadow = true;
    group.add(sphere);

    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.09, 10),
      new THREE.MeshStandardMaterial({
        color: 0xb45309,
        roughness: 0.65,
        metalness: 0.15,
      }),
    );
    collar.position.y = 0.48;
    group.add(collar);

    const fuseTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xea580c,
        roughness: 0.5,
      }),
    );
    fuseTip.position.y = 0.57;
    group.add(fuseTip);

    const dangerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.39, 18),
      new THREE.MeshBasicMaterial({
        color: 0xea580c,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    dangerRing.rotation.x = -Math.PI / 2;
    dangerRing.position.y = 0.025;
    group.add(dangerRing);

    return { group, accentMesh: fuseTip };
  }

  if (type === 'gas') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.4, 0.32),
      new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.8,
        metalness: 0.05,
      }),
    );
    body.position.y = 0.2;
    body.castShadow = true;
    group.add(body);

    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.75,
      }),
    );
    band.position.y = 0.24;
    group.add(band);

    return { group, accentMesh: band };
  }

  if (type === 'poison') {
    // Yellow Skull & Crossbones toxic warning triangle sign (matching reference image)
    const signGroup = new THREE.Group();
    signGroup.position.set(0, 0.08, 0);
    signGroup.rotation.x = 0.18;
    group.add(signGroup);

    const backingBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.44, 0.08, 3),
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        roughness: 0.85,
      }),
    );
    backingBase.rotation.y = Math.PI;
    backingBase.position.set(0, 0.02, 0.05);
    backingBase.scale.set(0.95, 1, 0.9);
    backingBase.castShadow = true;
    signGroup.add(backingBase);

    const signPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.86),
      new THREE.MeshBasicMaterial({
        map: getPoisonWarningTexture(),
        transparent: true,
        alphaTest: 0.15,
        side: THREE.DoubleSide,
      }),
    );
    signPlane.rotation.x = -Math.PI / 2;
    signPlane.position.set(0, 0.072, 0.02);
    signGroup.add(signPlane);

    return { group, accentMesh: signPlane };
  }

  if (type === 'nuclear') {
    // Radioactive Waste Drum with steel rims, hazard band, green ooze, and trefoil
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.52, 16),
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.72,
        metalness: 0.08,
      }),
    );
    drum.position.y = 0.26;
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.65,
      metalness: 0.25,
    });
    for (const ry of [0.04, 0.26, 0.49]) {
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.255, 0.255, ry === 0.26 ? 0.1 : 0.045, 16),
        rimMat,
      );
      rim.position.y = ry;
      group.add(rim);
    }

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.03, 14),
      new THREE.MeshStandardMaterial({
        color: 0x65a30d,
        roughness: 0.55,
      }),
    );
    core.position.y = 0.525;
    group.add(core);

    // Classic 3-blade radioactive trefoil on lid
    const trefoilMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
    const centerDot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), trefoilMat);
    centerDot.position.y = 0.545;
    group.add(centerDot);
    for (let k = 0; k < 3; k++) {
      const ang = (k * Math.PI * 2) / 3;
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.025, 0.018, 3),
        trefoilMat,
      );
      blade.position.set(Math.sin(ang) * 0.1, 0.545, Math.cos(ang) * 0.1);
      blade.rotation.y = ang;
      group.add(blade);
    }

    return { group, accentMesh: core };
  }

  if (type === 'tempWall') {
    const barrier = createTempBarrierModel();
    return { group: barrier.group };
  }

  if (type === 'permWall') {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.7, 0.92),
      new THREE.MeshStandardMaterial({
        color: 0x52525b,
        roughness: 0.88,
        metalness: 0.05,
      }),
    );
    block.position.y = 0.35;
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);

    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.16, 0.96),
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.75,
      }),
    );
    brace.position.y = 0.64;
    group.add(brace);

    return { group, accentMesh: brace };
  }

  // Mutagen: 3D DNA Double-Helix Symbol on circular pedestal
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.35, 0.05, 18),
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.85,
    }),
  );
  disc.position.y = 0.025;
  disc.receiveShadow = true;
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.3, 18),
    new THREE.MeshBasicMaterial({
      color: 0xdb2777,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.053;
  group.add(ring);

  const dnaPivot = new THREE.Group();
  dnaPivot.position.set(0, 0.27, 0);
  dnaPivot.rotation.set(0.55, 0, -0.45); // Angled clearly so both strands & rungs read as DNA from top-down
  group.add(dnaPivot);

  const pinkMat = new THREE.MeshStandardMaterial({ color: 0xdb2777, roughness: 0.55 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 });
  const rungMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  const beadGeo = new THREE.SphereGeometry(0.048, 8, 8);
  const rungGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6);

  const steps = 7;
  const radius = 0.11;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1) - 0.5;
    const y = t * 0.44;
    const ang = t * Math.PI * 2.1;
    const px = Math.cos(ang) * radius;
    const pz = Math.sin(ang) * radius;

    const beadA = new THREE.Mesh(beadGeo, pinkMat);
    beadA.position.set(px, y, pz);
    beadA.castShadow = true;
    dnaPivot.add(beadA);

    const beadB = new THREE.Mesh(beadGeo, blueMat);
    beadB.position.set(-px, y, -pz);
    beadB.castShadow = true;
    dnaPivot.add(beadB);

    const rung = new THREE.Mesh(rungGeo, rungMat);
    rung.position.set(0, y, 0);
    rung.rotation.z = Math.PI / 2;
    rung.rotation.y = -ang;
    dnaPivot.add(rung);
  }

  return { group };
}
