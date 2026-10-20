import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import { heightAt } from '../../world/terrainFn.ts';
import { KitBuilder } from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';

export interface BeastRidgeContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  colliders: ColliderGrid;
  overrides: ModelOverrides;
  onNotice?: (msg: string) => void;
}

export interface BuiltBeastRidgeNear {
  group: THREE.Group;
  stats: MergeStats;
  update(realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the distant silhouette of Beast Ridge (`buildFar()`) around (508, 262, -70).
 */
export function buildBeastRidgeFar(): THREE.Group {
  const kb = new KitBuilder();
  kb.addBox(16, 12, 5, 520, 268, -82, 'stone');
  kb.addCylinder(4.5, 5.0, 1.4, 10, 545, 254.7, -92, 'timber');
  return mergePlaceSpatialChunks(kb.parts, 520, -80, 'beast-ridge-far', 1).group;
}

/**
 * Builds Beast Ridge (`BeastRidge.ts` — Prompt 5 Section 7):
 * - Crest meadow at (508, 262, -70) with weathered rock arches
 * - Empty Nest at (545, 254, -92): woven mass of branches and bleached bones, 9 m across,
 *   swept clean (`nest-site` interactable), claw gouges in the stone, scattered feathers (instanced)
 * - Stone corral with harness racks
 * - Veyra's camp: hide tent, fire pit with embers, drying racks, bone wind-chime
 * - Two enormous winged creatures circling far away at 600–900 m altitude on slow splines with wing flap
 */
export function buildBeastRidgeNear(ctx: BeastRidgeContext): BuiltBeastRidgeNear {
  const root = new THREE.Group();
  root.name = 'BeastRidgeNear';
  const kb = new KitBuilder();
  const mats = getArchMaterials();

  const [vx, vy, vz] = LANDMARKS.veyraAnchor; // [508, 262, -70]
  const [nx, ny, nz] = LANDMARKS.nestLedge; // [545, 254, -92]

  // 1. Weathered natural rock arches along the ridge crest
  for (let a = 0; a < 2; a++) {
    const ax = vx + 14 + a * 18;
    const az = vz - 12 - a * 8;
    const ay = heightAt(ax, az);
    kb.addBox(3.4, 11.0, 4.2, ax - 5.5, ay + 5.5, az, 'stone', 0.25);
    kb.addBox(3.4, 11.0, 4.2, ax + 5.5, ay + 5.5, az, 'stone', -0.25);
    kb.addBox(14.5, 3.2, 4.6, ax, ay + 10.2, az, 'stone', 0.08);
  }

  // 2. Veyra's Camp at (508, 262, -70): hide tent, fire pit with embers, drying racks, bone wind-chime
  // Hide tent (angled clothIvory canopy over timber ridge poles)
  kb.addCylinder(0.12, 0.14, 3.8, 6, vx - 4.5, vy + 1.9, vz - 3.0, 'timber');
  kb.addCylinder(0.12, 0.14, 3.8, 6, vx - 4.5, vy + 1.9, vz + 1.0, 'timber');
  kb.addBox(4.8, 3.2, 4.4, vx - 4.5, vy + 1.5, vz - 1.0, 'clothIvory', 0.18);
  // Campfire pit with glowing embers
  kb.addCylinder(1.1, 1.25, 0.35, 10, vx + 1.5, vy + 0.18, vz - 0.8, 'stone');
  kb.addCylinder(0.75, 0.65, 0.25, 8, vx + 1.5, vy + 0.35, vz - 0.8, 'emberCore');
  ctx.lamps.add({
    id: 'veyra-campfire',
    position: [vx + 1.5, vy + 0.85, vz - 0.8],
    size: 1.35,
    state: 'ember',
    hasGroundPool: true,
  });
  // Bone wind-chime rack
  kb.addCylinder(0.08, 0.09, 2.8, 6, vx + 3.8, vy + 1.4, vz - 3.2, 'timber');
  kb.addBox(1.4, 0.1, 0.1, vx + 3.8, vy + 2.6, vz - 3.2, 'timber');
  for (let b = -2; b <= 2; b++) {
    kb.addCylinder(0.03, 0.04, 0.65, 5, vx + 3.8 + b * 0.22, vy + 2.2, vz - 3.2, 'bone');
  }

  // Stone corral with harness racks at (vx - 12, vy, vz + 10)
  const cx = vx - 12;
  const cz = vz + 10;
  const cy = heightAt(cx, cz);
  kb.addBox(12.0, 1.1, 0.65, cx, cy + 0.55, cz - 5.0, 'stone');
  kb.addBox(12.0, 1.1, 0.65, cx, cy + 0.55, cz + 5.0, 'stone');
  kb.addBox(0.65, 1.1, 10.0, cx - 6.0, cy + 0.55, cz, 'stone');
  kb.addBox(3.5, 1.5, 0.4, cx + 3.0, cy + 0.75, cz - 4.2, 'timber');

  // 3. The Empty Nest at (545, 254, -92) — 9 m across woven mass of branches and bones, swept clean
  const nestKb = new KitBuilder();
  const rimSegs = 20;
  const nestRadius = 4.5; // 9 m across
  for (let i = 0; i < rimSegs; i++) {
    const a = (i / rimSegs) * Math.PI * 2;
    const rx = Math.cos(a) * nestRadius;
    const rz = Math.sin(a) * nestRadius;
    nestKb.addBox(2.4, 0.95, 1.1, rx, 0.48, rz, i % 3 === 0 ? 'bone' : 'timber', -a + 0.3);
    nestKb.addCylinder(0.12, 0.06, 2.8, 6, rx * 0.92, 0.75, rz * 0.92, 'bone', a + 0.8);
  }
  // Swept clean stone floor & deep claw gouges in the stone
  nestKb.addCylinder(4.1, 4.4, 0.22, 16, 0, 0.11, 0, 'stone');
  for (let g = -2; g <= 2; g++) {
    nestKb.addBox(3.4, 0.06, 0.14, g * 0.45, 0.23, g * 0.3, 'clothInk', 0.42);
  }

  const nestContainer = ctx.overrides.wrapWithOverride(
    'nest',
    nestKb.toMergedGroup('beast-nest'),
    [nx, ny, nz]
  );
  root.add(nestContainer);

  // Scattered feathers around the nest ledge (24 instanced)
  const featherGeo = new THREE.ConeGeometry(0.12, 0.55, 4);
  featherGeo.rotateX(Math.PI * 0.48);
  const featherMesh = new THREE.InstancedMesh(featherGeo, mats.bone, 24);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + (i % 3) * 0.4;
    const r = 3.2 + (i % 5) * 1.1;
    dummy.position.set(nx + Math.cos(a) * r, ny + 0.12, nz + Math.sin(a) * r);
    dummy.rotation.set(0, a * 1.7, 0);
    dummy.updateMatrix();
    featherMesh.setMatrixAt(i, dummy.matrix);
  }
  featherMesh.instanceMatrix.needsUpdate = true;
  root.add(featherMesh);

  // 4. Two enormous winged creatures circling far away at 600–900 m altitude
  const creatureGroups: THREE.Group[] = [];
  const leftWings: THREE.Mesh[] = [];
  const rightWings: THREE.Mesh[] = [];
  for (let c = 0; c < 2; c++) {
    const cg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.8, 16.0, 6), mats.clothInk);
    body.rotation.x = Math.PI * 0.5;
    cg.add(body);

    const wingGeo = new THREE.BoxGeometry(18.0, 0.35, 5.2);
    const lw = new THREE.Mesh(wingGeo, mats.clothInk);
    lw.position.set(-9.0, 0, 0);
    const rw = new THREE.Mesh(wingGeo, mats.clothInk);
    rw.position.set(9.0, 0, 0);
    cg.add(lw, rw);

    creatureGroups.push(cg);
    leftWings.push(lw);
    rightWings.push(rw);
    root.add(cg);
  }

  const merged = mergePlaceSpatialChunks(kb.parts, vx, vz, 'beast-ridge', 2);
  root.add(merged.group);

  ctx.interactables.register({
    id: 'nest-site',
    kind: 'object',
    position: new THREE.Vector3(nx, ny + 0.8, nz),
    radius: 4.5,
    prompt: 'Examine the Empty Nest',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.(
        'A nine-metre ring of bleached bone and ironwood boughs—swept clean, with fresh claw gouges scoring the eastern rim.'
      );
    },
  });

  return {
    group: root,
    stats: {
      chunkCount: merged.stats.chunkCount,
      drawCalls: merged.stats.drawCalls + 8,
      triangles: merged.stats.triangles + 320,
    },
    update(realSeconds: number) {
      for (let c = 0; c < 2; c++) {
        const angle = realSeconds * (0.045 + c * 0.012) + c * Math.PI;
        const radius = 380 + c * 90;
        const wx = 680 + Math.cos(angle) * radius;
        const wz = -140 + Math.sin(angle) * radius;
        const wy = (c === 0 ? 680 : 820) + Math.sin(realSeconds * 0.3 + c) * 18;
        const cg = creatureGroups[c];
        cg.position.set(wx, wy, wz);
        cg.rotation.y = -angle;
        const flap = Math.sin(realSeconds * 1.9 + c * 2.1) * 0.28;
        leftWings[c].rotation.z = flap;
        rightWings[c].rotation.z = -flap;
      }
    },
    dispose() {
      ctx.interactables.unregister('nest-site');
      featherGeo.dispose();
    },
  };
}
