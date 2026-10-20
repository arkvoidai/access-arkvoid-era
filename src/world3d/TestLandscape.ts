import * as THREE from 'three';
import { CHARACTERS, CHARACTER_ORDER } from '../config/app.config.ts';
import type { CharacterId, LocationId, WorldState } from '../engine/types.ts';
import { LANDMARKS, PLACES } from '../world/bible.ts';
import { patchMaterial } from './fog.ts';
import { disposeObject3D } from './loaders.ts';
import { groundHeightAt } from './terrainMath.ts';

export interface TestLandscapeResult {
  root: THREE.Group;
  interactables: THREE.Object3D[];
  npcWorldPositions: THREE.Vector3[];
  update: (dt: number, realSeconds: number, worldState: WorldState, camPos: THREE.Vector3) => void;
  dispose: () => void;
}

/**
 * Builds the 5 articulated NPC character figures and ember spark pool.
 * (All 8 architectural places, gates, bridges, halls, sky islands, and lanterns are managed by `PlacesRegistry`.)
 */
export function buildTestLandscape(_renderer: THREE.WebGLRenderer): TestLandscapeResult {
  const root = new THREE.Group();
  root.name = 'ArkvoidActorsRoot';
  const interactables: THREE.Object3D[] = [];
  const npcWorldPositions: THREE.Vector3[] = CHARACTER_ORDER.map(() => new THREE.Vector3());

  // 1. EMBER SPARK MOTES AT THE EAST GATE BRAZIER & ARCH LANTERNS
  const { points: emberSparks, updateSparks } = buildEmberSparkPool();
  root.add(emberSparks);

  // 2. COMPOSITE CHARACTER FIGURES (Seren, Ione, Veyra, Mirel, Orin)
  const characterFigures: Record<CharacterId, THREE.Group> = {
    seren: buildCharacterFigure('seren'),
    ione: buildCharacterFigure('ione'),
    veyra: buildCharacterFigure('veyra'),
    mirel: buildCharacterFigure('mirel'),
    orin: buildCharacterFigure('orin'),
  };
  for (const cid of CHARACTER_ORDER) {
    const fig = characterFigures[cid];
    root.add(fig);
    interactables.push(fig);
  }

  const update = (
    dt: number,
    realSeconds: number,
    worldState: WorldState,
    camPos: THREE.Vector3
  ) => {
    const insideHallCell = camPos.x > 5800 && camPos.z > 5800;

    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      const cid = CHARACTER_ORDER[i];
      const fig = characterFigures[cid];
      const placeId: LocationId = worldState.npcPlace[cid];
      const [tx, ty, tz] = resolveCharacterAnchor(cid, placeId, i, insideHallCell);
      fig.position.set(tx, ty, tz);
      npcWorldPositions[i].set(tx, ty, tz);

      // Gently face toward the player when within 28m
      const dx = camPos.x - tx;
      const dz = camPos.z - tz;
      if (dx * dx + dz * dz < 28 * 28) {
        const targetAngle = Math.atan2(dx, dz);
        fig.rotation.y = targetAngle;
      }

      // Subtle breathing motion on torso
      const breath = Math.sin(realSeconds * 2.1 + i * 1.3) * 0.015;
      fig.scale.set(1, 1 + breath, 1);
    }

    updateSparks(dt, realSeconds);
  };

  const dispose = () => {
    disposeObject3D(root);
  };

  return { root, interactables, npcWorldPositions, update, dispose };
}

export function resolveCharacterAnchor(
  cid: CharacterId,
  placeId: LocationId,
  indexOffset: number,
  insideHallCell = false
): [number, number, number] {
  if (cid === 'mirel' && (insideHallCell || placeId === 'hall-of-records')) {
    if (insideHallCell) {
      return [
        LANDMARKS.mirelAnchor[0],
        LANDMARKS.mirelAnchor[1],
        LANDMARKS.mirelAnchor[2],
      ];
    }
  }
  if (placeId === 'east-gate') {
    if (cid === 'seren') {
      return [53.5, groundHeightAt(53.5, -2.0), -2.0];
    }
    if (cid === 'mirel') {
      return [52.0, groundHeightAt(52.0, 2.2), 2.2];
    }
    if (cid === 'orin') {
      const [ox, oz] = LANDMARKS.lowerCourt.orinWorkshop;
      return [ox, groundHeightAt(ox, oz), oz];
    }
  }
  if (cid === 'ione' && placeId === 'lantern-terrace') {
    const [tx, ty, tz] = LANDMARKS.terraceCottage;
    return [tx + 2.5, ty, tz + 1.8];
  }
  if (cid === 'veyra' && placeId === 'beast-ridge') {
    const [vx, , vz] = LANDMARKS.veyraAnchor;
    return [vx, groundHeightAt(vx, vz), vz];
  }
  const base = PLACES[placeId]?.anchor ?? PLACES['east-gate'].anchor;
  const angle = indexOffset * 1.25;
  const rx = base[0] + Math.cos(angle) * 4.5;
  const rz = base[2] + Math.sin(angle) * 4.5;
  if (placeId === 'sky-realms' || placeId === 'open-cosmos') {
    return [rx, base[1], rz];
  }
  return [rx, groundHeightAt(rx, rz), rz];
}

/**
 * Builds an 8-part articulated character figure with contact shadow and ember lantern.
 */
function buildCharacterFigure(cid: CharacterId): THREE.Group {
  const meta = CHARACTERS[cid];
  const group = new THREE.Group();
  group.name = `Character_${cid}`;
  group.userData = { characterId: cid, characterName: meta.name };

  const robePrimaryColors: Record<CharacterId, string> = {
    seren: '#231D1A',
    ione: '#3A312A',
    veyra: '#2D241E',
    mirel: '#1F1A17',
    orin: '#423328',
  };

  const robeMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: robePrimaryColors[cid],
      roughness: 0.76,
      metalness: 0.05,
    })
  );
  const ivoryTrimMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: '#EAE0CF',
      roughness: 0.62,
      metalness: 0.04,
    })
  );
  const skinMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: '#DFC7AE',
      roughness: 0.58,
      metalness: 0.02,
    })
  );
  const sashMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: cid === 'mirel' ? '#4A1D96' : '#D94400',
      roughness: 0.48,
      metalness: 0.12,
    }),
    { enableEmberGlow: cid !== 'mirel' }
  );
  const emberMat = new THREE.MeshBasicMaterial({ color: '#FB5607', fog: false });

  // 1. Soft ground contact shadow disc (offset +0.02m above ground)
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 20),
    new THREE.MeshBasicMaterial({
      color: '#14110E',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      fog: false,
    })
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.02;
  group.add(shadowDisc);

  // 2. Subtle ember presence ring on the ground
  const auraRing = new THREE.Mesh(
    new THREE.RingGeometry(0.66, 0.72, 24),
    new THREE.MeshBasicMaterial({
      color: '#FB5607',
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.025;
  group.add(auraRing);

  // 3. Lower robe skirt
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, 0.92, 14), robeMat);
  skirt.position.y = 0.46;
  skirt.castShadow = true;
  skirt.userData = { characterId: cid };
  group.add(skirt);

  // 4. Upper tunic torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.56, 14), ivoryTrimMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  torso.userData = { characterId: cid };
  group.add(torso);

  // 5. Waist sash
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.14, 14), sashMat);
  sash.position.y = 0.92;
  sash.userData = { characterId: cid };
  group.add(sash);

  // 6. Wide shoulder mantle
  const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.22, 14), robeMat);
  mantle.position.y = 1.34;
  mantle.castShadow = true;
  mantle.userData = { characterId: cid };
  group.add(mantle);

  // 7. Head & topknot/hat
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skinMat);
  head.position.y = 1.58;
  head.castShadow = true;
  head.userData = { characterId: cid };
  group.add(head);

  const hat = new THREE.Mesh(
    cid === 'seren' || cid === 'veyra'
      ? new THREE.ConeGeometry(0.34, 0.18, 14)
      : new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10),
    robeMat
  );
  hat.position.y = 1.74;
  hat.userData = { characterId: cid };
  group.add(hat);

  // 8. Handheld warm ember lantern
  const lanternStaff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.35, 8),
    robeMat
  );
  lanternStaff.position.set(0.34, 0.72, 0.16);
  group.add(lanternStaff);

  const lanternOrb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), emberMat);
  lanternOrb.position.set(0.34, 1.34, 0.28);
  group.add(lanternOrb);

  return group;
}

/**
 * Pooled zero-GC ember spark particle emitter above the East Gate brazier and lanterns.
 */
function buildEmberSparkPool(): {
  points: THREE.Points;
  updateSparks: (dt: number, realSeconds: number) => void;
} {
  const count = 32;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    phases[i] = (i / count) * Math.PI * 2;
    resetParticle(i, positions, 0);
  }

  const spriteSize = 32;
  const spriteData = new Uint8Array(spriteSize * spriteSize * 4);
  for (let y = 0; y < spriteSize; y++) {
    for (let x = 0; x < spriteSize; x++) {
      const dx = (x + 0.5) / spriteSize - 0.5;
      const dy = (y + 0.5) / spriteSize - 0.5;
      const d = Math.hypot(dx, dy) * 2;
      const a = Math.max(0, 1 - d * d);
      const idx = (y * spriteSize + x) * 4;
      spriteData[idx] = 255;
      spriteData[idx + 1] = Math.round(130 * a + 50);
      spriteData[idx + 2] = Math.round(25 * a);
      spriteData[idx + 3] = Math.round(255 * a * a);
    }
  }
  const sparkTex = new THREE.DataTexture(spriteData, spriteSize, spriteSize, THREE.RGBAFormat);
  sparkTex.colorSpace = THREE.SRGBColorSpace;
  sparkTex.needsUpdate = true;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: '#FB5607',
    map: sparkTex,
    size: 0.28,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const updateSparks = (dt: number, realSeconds: number) => {
    const attr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let px = attr.getX(i);
      let py = attr.getY(i);
      let pz = attr.getZ(i);

      py += dt * (0.65 + (i % 5) * 0.12);
      px += Math.sin(realSeconds * 1.8 + phases[i]) * dt * 0.25;
      pz += Math.cos(realSeconds * 1.5 + phases[i]) * dt * 0.18;

      if (py > 146.2) {
        resetParticle(i, positions, realSeconds);
      } else {
        attr.setXYZ(i, px, py, pz);
      }
    }
    attr.needsUpdate = true;
  };

  return { points, updateSparks };
}

function resetParticle(i: number, positions: Float32Array, seedOffset: number): void {
  const isBrazier = i % 2 === 0;
  const baseX = isBrazier ? 59.5 : 60.5;
  const baseY = isBrazier ? 141.6 : 145.0;
  const baseZ = isBrazier ? 4.2 : i % 4 === 1 ? -3.2 : 3.2;

  const a = i * 1.7 + seedOffset;
  positions[i * 3] = baseX + Math.cos(a) * 0.35;
  positions[i * 3 + 1] = baseY + (i % 7) * 0.45;
  positions[i * 3 + 2] = baseZ + Math.sin(a) * 0.35;
}
