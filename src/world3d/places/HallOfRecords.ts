import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import {
  addStairs,
  buildTerraceWallGeo,
  KitBuilder,
} from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';
import { U } from '../uniforms.ts';

export interface HallOfRecordsContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  colliders: ColliderGrid;
  overrides: ModelOverrides;
  onEnterInterior: () => void;
  onLeaveInterior: () => void;
  onNotice?: (msg: string) => void;
}

export interface BuiltHallOfRecordsNear {
  group: THREE.Group;
  stats: MergeStats;
  isInteriorMounted(): boolean;
  mountInterior(): MergeStats;
  unmountInterior(): void;
  update(realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the distant monumental cliff facade silhouette of the Hall of Records (`buildFar()`).
 */
export function buildHallOfRecordsFar(): THREE.Group {
  const kb = new KitBuilder();
  // Colossal 46m wide, 60m tall cliff gate at (70, 150, -340)
  kb.addBox(14, 60, 12, 70 - 16, 180, -340, 'stone');
  kb.addBox(14, 60, 12, 70 + 16, 180, -340, 'stone');
  kb.addBox(46, 16, 14, 70, 202, -340, 'stone');
  kb.addBox(34, 22, 32, 70, 139, -304, 'stone');
  return mergePlaceSpatialChunks(kb.parts, 70, -330, 'hall-of-records-far', 1).group;
}

/**
 * Builds the Hall of Records (`HallOfRecords.ts` — Prompt 5 Section 6):
 * - Exterior: Colossal carved cliff gate (46m wide, 60m high) at z = -340, coiled serpentine beast relief
 *   swept along a looping spline above the portal, two 40m guardian pillars, 34m wide ceremonial stair
 *   climbing from y = 128 to (70, 150, -322), braziers, swaying banners, and human-sized entrance door
 *   at (70, 150, -338) (`hall-door`).
 * - Interior (lazy-mounted at (6000, 0, 6000), 70m × 26m × 100m, disposed on exit):
 *   Double rows of 8 massive pillars, 18m tall shelf modules with ladders & walkways, 12,000 scrolls in
 *   a single InstancedMesh, 4 volumetric light shafts from high windows, entrance door at (6000, 0, 5952),
 *   Mirel's anchor at (6000, 0, 6030), and the Third Shelf with a new brass lock at (5984, 0, 6046) (`third-shelf`).
 */
export function buildHallOfRecordsNear(ctx: HallOfRecordsContext): BuiltHallOfRecordsNear {
  const root = new THREE.Group();
  root.name = 'HallOfRecordsNear';
  const kb = new KitBuilder();
  const mats = getArchMaterials();

  const cx = 70;
  const cy = 150;
  const cliffZ = LANDMARKS.hallDoor.cliffZ; // -340

  // ============================================================================
  // 1. EXTERIOR MONUMENTAL CLIFF ARCH (46 m WIDE, 60 m HIGH)
  // ============================================================================
  // Left & Right colossal cliff jambs
  kb.addPart(
    buildTerraceWallGeo(13.0, 60.0, 14.0, 0.08),
    'stone',
    new THREE.Matrix4().setPosition(cx - 16.5, cy + 30.0, cliffZ)
  );
  kb.addPart(
    buildTerraceWallGeo(13.0, 60.0, 14.0, 0.08),
    'stone',
    new THREE.Matrix4().setPosition(cx + 16.5, cy + 30.0, cliffZ)
  );
  // Entablature & carved lintel crown (46 m wide)
  kb.addPart(
    buildTerraceWallGeo(48.0, 16.0, 16.0, 0.06),
    'stone',
    new THREE.Matrix4().setPosition(cx, cy + 52.0, cliffZ + 1.0)
  );
  // Recessed great sealed stone valves inside the 20m opening
  kb.addBox(20.0, 44.0, 4.0, cx, cy + 22.0, cliffZ - 1.5, 'blackStone');
  // Small human-sized timber & bronze entrance door at (70, 150, -338)
  kb.addBox(3.4, 4.8, 1.2, cx, cy + 2.4, -338.2, 'stone');
  kb.addBox(2.4, 3.8, 0.6, cx, cy + 1.9, -338.0, 'timber');
  kb.addBox(2.5, 0.18, 0.7, cx, cy + 2.1, -337.9, 'brass');

  // Two 40 m Guardian Pillars flanking the entrance platform
  kb.addCylinder(2.1, 2.5, 40.0, 12, cx - 13.5, cy + 20.0, -328, 'stone');
  kb.addCylinder(2.1, 2.5, 40.0, 12, cx + 13.5, cy + 20.0, -328, 'stone');
  kb.addBox(5.4, 2.4, 5.4, cx - 13.5, cy + 40.5, -328, 'stone');
  kb.addBox(5.4, 2.4, 5.4, cx + 13.5, cy + 40.5, -328, 'stone');

  // Hanging lacquer & ink banners on the guardian pillars
  kb.addBox(1.8, 18.0, 0.12, cx - 13.5, cy + 22.0, -325.4, 'clothLacquer');
  kb.addBox(1.8, 18.0, 0.12, cx + 13.5, cy + 22.0, -325.4, 'clothLacquer');

  // Wide Ceremonial Stair (34 m wide) climbing from plaza at y = 128 to entrance platform (70, 150, -322)
  kb.addPart(
    buildTerraceWallGeo(38.0, 8.0, 22.0, 0.06),
    'stone',
    new THREE.Matrix4().setPosition(cx, cy - 4.0, -329)
  );
  addStairs(kb, 34.0, 22.0, 36.0, 36, cx, 128.0, -300.0, Math.PI, 'stone');

  // Braziers flanking the ceremonial stair and entrance platform
  for (const bx of [cx - 10.5, cx + 10.5]) {
    for (const [bz, by] of [
      [-322, 150],
      [-304, 139],
      [-284, 128],
    ] as const) {
      kb.addCylinder(0.85, 0.6, 1.3, 10, bx, by + 0.65, bz, 'iron');
      kb.addCylinder(0.7, 0.5, 0.25, 10, bx, by + 1.35, bz, 'emberCore');
      ctx.lamps.add({
        position: [bx, by + 1.75, bz],
        size: 1.4,
        state: 'ember',
        hasGroundPool: true,
      });
    }
  }

  // Coiled Serpentine Beast Relief (swept tube along a looping spline above the portal)
  const reliefPoints: THREE.Vector3[] = [];
  const coils = 28;
  for (let i = 0; i <= coils; i++) {
    const t = i / coils;
    const angle = t * Math.PI * 3.5;
    const rx = cx + Math.sin(angle) * (13.5 - t * 6.5) + (t - 0.5) * 18.0;
    const ry = cy + 16.0 + Math.cos(angle) * 7.5 + Math.sin(t * Math.PI) * 14.0;
    const rz = -337.2 + Math.sin(angle * 2.0) * 1.1;
    reliefPoints.push(new THREE.Vector3(rx, ry, rz));
  }
  // Rest the serpentine head right above the human-sized portal at (70, 159.5, -336.5)
  reliefPoints.push(new THREE.Vector3(cx, cy + 9.5, -336.5));
  const reliefCurve = new THREE.CatmullRomCurve3(reliefPoints);
  const reliefGeo = new THREE.TubeGeometry(reliefCurve, 44, 1.15, 8, false);
  kb.addPart(reliefGeo, 'bone', new THREE.Matrix4());
  // Serpent head crest above the door
  kb.addBox(2.6, 2.1, 3.2, cx, cy + 9.5, -336.2, 'bone');

  const exteriorMerged = mergePlaceSpatialChunks(kb.parts, cx, -320, 'hall-exterior', 2);
  const facadeContainer = ctx.overrides.wrapWithOverride(
    'hall-facade',
    exteriorMerged.group
  );
  root.add(facadeContainer);

  // Register exterior Hall Door interactable at (70, 150, -338)
  ctx.interactables.register({
    id: 'hall-door',
    kind: 'door',
    position: new THREE.Vector3(70, 151.4, -338),
    radius: 4.2,
    prompt: 'Enter the Hall of Records',
    enabled: () => true,
    onUse: () => {
      ctx.onEnterInterior();
    },
  });

  // ============================================================================
  // 2. LAZY-MOUNTED INTERIOR CELL AT (6000, 0, 6000) — 70 m × 26 m × 100 m
  // ============================================================================
  let interiorGroup: THREE.Group | null = null;
  let interiorScrollMesh: THREE.InstancedMesh | null = null;
  let interiorShaftMat: THREE.ShaderMaterial | null = null;
  let interiorStats: MergeStats = { chunkCount: 0, drawCalls: 0, triangles: 0 };

  function buildInteriorCell(): MergeStats {
    if (interiorGroup) return interiorStats;

    interiorGroup = new THREE.Group();
    interiorGroup.name = 'HallOfRecordsInterior';
    const ikb = new KitBuilder();

    const [ix, iy, iz] = LANDMARKS.hallDoor.interiorCell.center; // [6000, 0, 6000]
    const w = LANDMARKS.hallDoor.interiorCell.width; // 70
    const h = LANDMARKS.hallDoor.interiorCell.height; // 26
    const len = LANDMARKS.hallDoor.interiorCell.length; // 100 (z: 5950 .. 6050)

    // Polished stone floor, coffered ceiling, and perimeter walls
    ikb.addBox(w, 0.8, len, ix, iy - 0.4, iz, 'stone');
    ikb.addBox(w, 1.0, len, ix, iy + h + 0.5, iz, 'timber');
    ikb.addBox(1.5, h, len, ix - w * 0.5, iy + h * 0.5, iz, 'stone');
    ikb.addBox(1.5, h, len, ix + w * 0.5, iy + h * 0.5, iz, 'stone');
    ikb.addBox(w, h, 1.5, ix, iy + h * 0.5, iz - len * 0.5, 'stone');
    ikb.addBox(w, h, 1.5, ix, iy + h * 0.5, iz + len * 0.5, 'stone');

    // Interior entrance door at (6000, 0, 5952)
    ikb.addBox(3.4, 5.2, 0.8, 6000, 2.6, 5951.2, 'lacquer');
    ikb.addBox(2.6, 4.4, 0.9, 6000, 2.2, 5951.3, 'timber');

    // Double rows of 8 massive pillars (x = 5988 and x = 6012)
    for (let p = 0; p < 8; p++) {
      const pz = 5960 + p * 11.5;
      for (const px of [5988, 6012]) {
        ikb.addCylinder(0.95, 1.15, h, 10, px, iy + h * 0.5, pz, 'lacquer');
        ikb.addBox(2.6, 0.8, 2.6, px, iy + 0.4, pz, 'stone');
      }
      // Long reading tables between pillars with ember desk lamps
      if (p % 2 === 1) {
        ikb.addBox(5.2, 0.85, 2.2, 6000, 0.43, pz, 'timber');
        ctx.lamps.add({
          id: `hall-table-lamp-${p}`,
          position: [6000, 1.25, pz],
          size: 1.1,
          state: 'ember',
          hasGroundPool: true,
        });
      }
    }

    // Walls of shelves 18 m high (repeated 3 m modules along West x = 5983 and East x = 6017)
    // plus two upper timber walkway galleries at y = 6 m and y = 12 m
    for (const side of [-1, 1]) {
      const sx = 6000 + side * 16.5;
      // Walkway galleries
      ikb.addBox(2.4, 0.28, 92, sx - side * 1.4, 6.0, 6000, 'timber');
      ikb.addBox(2.4, 0.28, 92, sx - side * 1.4, 12.0, 6000, 'timber');

      // 28 shelf modules per side (3 m wide, 18 m tall)
      for (let m = 0; m < 28; m++) {
        const mz = 5956 + m * 3.2;
        ikb.addBox(0.9, 18.0, 0.18, sx, 9.0, mz - 1.5, 'timber');
        for (let tier = 1; tier <= 6; tier++) {
          ikb.addBox(0.85, 0.12, 3.1, sx, tier * 2.8, mz, 'timber');
        }
        // Ladders every 4th module
        if (m % 4 === 0) {
          ikb.addBox(0.1, 18.0, 0.65, sx - side * 0.55, 9.0, mz, 'timber');
        }
      }
    }

    // The Third Shelf at (5984, 0, 6046) on the west wall near the far end, with a new brass lock
    ikb.addBox(1.1, 2.4, 1.8, 5984.0, 1.2, 6046.0, 'lacquer');
    ikb.addBox(0.32, 0.42, 0.36, 5984.55, 1.35, 6046.0, 'brass');

    const mergedInt = mergePlaceSpatialChunks(ikb.parts, 6000, 6000, 'hall-interior', 2);
    interiorGroup.add(mergedInt.group);

    // 12,000 Scrolls in 1 InstancedMesh (slightly varied length, tone and tie colour)
    const scrollCount = 12000;
    const scrollGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 5, 1);
    scrollGeo.rotateZ(Math.PI * 0.5);
    const scrollMat = mats.bone;
    interiorScrollMesh = new THREE.InstancedMesh(scrollGeo, scrollMat, scrollCount);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < scrollCount; i++) {
      const side = i < 6000 ? -1 : 1;
      const localIdx = i % 6000;
      const shelfRow = localIdx % 18; // 18 horizontal shelf tiers
      const zSlot = Math.floor(localIdx / 18); // ~333 slots along 90m wall
      const sx = 6000 + side * 16.35;
      const sy = 0.65 + shelfRow * 0.96 + ((i * 17) % 3) * 0.08;
      const sz = 5955.5 + (zSlot / 334) * 90.0;

      dummy.position.set(sx, sy, sz);
      dummy.rotation.set(0, ((i * 13) % 7) * 0.04 - 0.12, 0);
      const lenScale = 0.82 + ((i * 29) % 11) * 0.035;
      dummy.scale.set(lenScale, 1, 1);
      dummy.updateMatrix();
      interiorScrollMesh.setMatrixAt(i, dummy.matrix);

      // Warm parchment ivory, aged ochre, and occasional lacquer-red scroll ties
      const tone = 0.72 + ((i * 31) % 10) * 0.025;
      if (i % 19 === 0) {
        color.setRGB(0.55, 0.24, 0.14);
      } else {
        color.setRGB(tone, tone * 0.93, tone * 0.81);
      }
      interiorScrollMesh.setColorAt(i, color);
    }
    interiorScrollMesh.instanceMatrix.needsUpdate = true;
    if (interiorScrollMesh.instanceColor) {
      interiorScrollMesh.instanceColor.needsUpdate = true;
    }
    interiorGroup.add(interiorScrollMesh);

    // Four Shafts of Light from high windows (additive noisy cone meshes)
    const shaftGeo = new THREE.ConeGeometry(4.8, 24.0, 12, 1, true);
    interiorShaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float beam = sin(vUv.x * 18.84 + uTime * 0.35) * 0.15 + 0.85;
          float verticalFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
          float alpha = verticalFade * beam * 0.14;
          vec3 warmRay = vec3(1.0, 0.86, 0.68);
          gl_FragColor = vec4(warmRay, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    for (let s = 0; s < 4; s++) {
      const shaft = new THREE.Mesh(shaftGeo, interiorShaftMat);
      shaft.position.set(5997, 13.0, 5968 + s * 20);
      shaft.rotation.z = -0.22;
      interiorGroup.add(shaft);
    }

    root.add(interiorGroup);

    // Register interior interactables: Exit Door & Third Shelf Brass Lock
    ctx.interactables.register({
      id: 'hall-exit-door',
      kind: 'door',
      position: new THREE.Vector3(6000, 1.6, 5952),
      radius: 4.2,
      prompt: 'Leave the Hall of Records',
      enabled: () => interiorGroup !== null,
      onUse: () => {
        ctx.onLeaveInterior();
      },
    });

    ctx.interactables.register({
      id: 'third-shelf',
      kind: 'object',
      position: new THREE.Vector3(5984, 1.4, 6046),
      radius: 3.8,
      prompt: 'Inspect the Third Shelf Lock',
      enabled: () => interiorGroup !== null,
      onUse: () => {
        ctx.onNotice?.(
          'A newly fitted brass lock seals the third ledger shelf on the west wall; the metal has no patina yet.'
        );
      },
    });

    interiorStats = {
      chunkCount: mergedInt.stats.chunkCount,
      drawCalls: mergedInt.stats.drawCalls + 5,
      triangles: mergedInt.stats.triangles + scrollCount * 10 + 48,
    };
    return interiorStats;
  }

  function unmountInterior(): void {
    if (!interiorGroup) return;
    ctx.interactables.unregister('hall-exit-door');
    ctx.interactables.unregister('third-shelf');
    root.remove(interiorGroup);
    if (interiorScrollMesh) {
      interiorScrollMesh.geometry.dispose();
      interiorScrollMesh = null;
    }
    if (interiorShaftMat) {
      interiorShaftMat.dispose();
      interiorShaftMat = null;
    }
    interiorGroup = null;
  }

  return {
    group: root,
    stats: exteriorMerged.stats,
    isInteriorMounted() {
      return interiorGroup !== null;
    },
    mountInterior: buildInteriorCell,
    unmountInterior,
    update() {
      // Volumetric shafts and lamps animate via shared uTime / uNightLamp
    },
    dispose() {
      unmountInterior();
      ctx.interactables.unregister('hall-door');
    },
  };
}
