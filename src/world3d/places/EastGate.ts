import * as THREE from 'three';
import { heightAt } from '../../world/terrainFn.ts';
import {
  addRailing,
  addStairs,
  buildBuildingKit,
  buildCurvedRoofParts,
  buildTerraceWallGeo,
  KitBuilder,
} from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';

export interface EastGatePlaceContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  colliders: ColliderGrid;
  overrides: ModelOverrides;
  onNotice?: (message: string) => void;
  onRingBell?: () => void;
}

export interface BuiltEastGateNear {
  group: THREE.Group;
  stats: MergeStats;
  update(realSeconds: number, dt: number): void;
  setScaffoldingVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Builds the cheap distant silhouette of the East Gate Town (`buildFar()`) — always resident.
 */
export function buildEastGateFar(): THREE.Group {
  const kb = new KitBuilder();

  // Great Gate mass at (64, 140, 0)
  kb.addBox(6, 11, 14, 64, 145.5, 0, 'stone');
  buildCurvedRoofParts(kb, 7, 15, 1.8, 3.2, 0.65, 0.6, 151, false);

  // North & south spur walls + corner towers
  kb.addBox(3.2, 5.5, 110, 64, 142.5, -62, 'stone');
  kb.addBox(3.2, 5.5, 110, 64, 142.5, 62, 'stone');
  kb.addBox(8, 14, 8, 64, 147, -118, 'stone');
  buildCurvedRoofParts(kb, 8.5, 8.5, 1.4, 2.5, 0.6, 0.5, 154, false);
  kb.addBox(8, 14, 8, 64, 147, 118, 'stone');
  buildCurvedRoofParts(kb, 8.5, 8.5, 1.4, 2.5, 0.6, 0.5, 154, false);

  // Upper terrace hall silhouette at (-45, 150, -10)
  kb.addBox(16, 7.5, 12, -45, 153.75, -10, 'plaster');
  buildCurvedRoofParts(kb, 16, 12, 1.6, 2.8, 0.65, 0.55, 157.5, false);

  // Lower court workshop silhouette at (-8, 131, 48)
  kb.addBox(11, 4.5, 9, -8, 133.25, 48, 'timber');
  buildCurvedRoofParts(kb, 11, 9, 1.1, 1.8, 0.6, 0.4, 135.5, false);

  return mergePlaceSpatialChunks(kb.parts, 10, 0, 'east-gate-far', 1).group;
}

/**
 * Builds the full 45-building East Gate Town (`buildNear()` — Prompt 5 Section 4):
 * - Great Gate at (64, 140, 0) with two-tier curved roof, iron-studded double doors, and lock mechanism prop at (62.2, 142, 0)
 * - North & south battlements (140m each side) + corner watchtowers
 * - Seren's guard post pavilion at (56, 140, -6) with brazier, weapon racks, and watch bell
 * - Stepped main street climbing from courtyard (30, 0; 140m) to Upper Terrace (-45, -10; 150m)
 * - 12 Promise-Lantern hooks along the upper terrace railing at (-70 + 5*i, 152.2, -28)
 * - Market at (8, 140, -30) with 12 cloth-canopy stalls
 * - Arched Stone Bridge at (-12, 138, 5) over the stream
 * - Lower Court (-5, 131, 48): Orin's workshop at (-8, 131, 48) with glowing forge, well at (-4, 131, 40), and lower wall with scaffolding
 * - 30 varied 1–2 story contour houses, rooftop cats, chimney smoke, and circling tower birds
 */
export function buildEastGateNear(ctx: EastGatePlaceContext): BuiltEastGateNear {
  const root = new THREE.Group();
  root.name = 'EastGateNear';
  const kb = new KitBuilder();
  const mats = getArchMaterials();

  // ============================================================================
  // 1. THE GREAT GATE AT (64, 140, 0), FACING +X
  // ============================================================================
  // Stone base 6m thick (along X), 14m wide (along Z), 11m tall, with central archway opening (5.4m wide, 6.2m tall)
  const gateX = 64;
  const gateY = 140;
  const gateZ = 0;

  // Left and right stone piers of the gate
  kb.addPart(
    buildTerraceWallGeo(6.0, 6.4, 4.3, 0.08),
    'stone',
    new THREE.Matrix4().setPosition(gateX, gateY + 3.2, gateZ - 4.85)
  );
  kb.addPart(
    buildTerraceWallGeo(6.0, 6.4, 4.3, 0.08),
    'stone',
    new THREE.Matrix4().setPosition(gateX, gateY + 3.2, gateZ + 4.85)
  );
  // Stone lintel & upper gatehouse gallery (y = 146.4 to 149.2)
  kb.addPart(
    buildTerraceWallGeo(6.2, 2.8, 14.4, 0.05),
    'stone',
    new THREE.Matrix4().setPosition(gateX, gateY + 7.8, gateZ)
  );
  // Timber & plaster gatehouse upper pavilion (y = 149.2 to 153.2)
  kb.addBox(5.2, 3.8, 12.6, gateX, gateY + 11.1, gateZ, 'plaster');
  for (let iz = -6; iz <= 6; iz += 3) {
    kb.addCylinder(0.22, 0.25, 4.0, 8, gateX - 2.6, gateY + 11.1, gateZ + iz, 'lacquer');
    kb.addCylinder(0.22, 0.25, 4.0, 8, gateX + 2.6, gateY + 11.1, gateZ + iz, 'lacquer');
  }
  kb.addBox(0.35, 1.5, 8.4, gateX - 2.55, gateY + 11.2, gateZ, 'paperWindow');
  kb.addBox(0.35, 1.5, 8.4, gateX + 2.55, gateY + 11.2, gateZ, 'paperWindow');

  // Two-tier curved roof over the Great Gate (oriented along Z width)
  const gateRoofKb = new KitBuilder();
  buildCurvedRoofParts(gateRoofKb, 14.8, 6.6, 1.65, 2.1, 0.65, 0.55, 0, true);
  buildCurvedRoofParts(gateRoofKb, 12.2, 5.2, 1.45, 2.6, 0.72, 0.65, 2.6, true);
  kb.addChildBuilder(
    gateRoofKb,
    new THREE.Matrix4().makeRotationY(Math.PI * 0.5).setPosition(gateX, gateY + 12.8, gateZ)
  );

  // Heavy double doors + Lock Mechanism prop at (62.2, 142, 0)
  const gateDoorGroup = new THREE.Group();
  gateDoorGroup.position.set(gateX - 1.2, gateY, gateZ);
  const leftDoorPivot = new THREE.Group();
  leftDoorPivot.position.set(0, 0, -2.65);
  const leftDoorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.36, 5.8, 2.6), mats.timber);
  leftDoorLeaf.position.set(0, 2.9, 1.3);
  leftDoorPivot.add(leftDoorLeaf);

  const rightDoorPivot = new THREE.Group();
  rightDoorPivot.position.set(0, 0, 2.65);
  const rightDoorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.36, 5.8, 2.6), mats.timber);
  rightDoorLeaf.position.set(0, 2.9, -1.3);
  rightDoorPivot.add(rightDoorLeaf);

  // Iron studs on gate doors
  for (let row = 0; row < 4; row++) {
    const sy = 1.0 + row * 1.25;
    const studBarL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 2.4), mats.iron);
    studBarL.position.set(0, sy, 1.3);
    leftDoorPivot.add(studBarL);
    const studBarR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 2.4), mats.iron);
    studBarR.position.set(0, sy, -1.3);
    rightDoorPivot.add(studBarR);
  }
  gateDoorGroup.add(leftDoorPivot, rightDoorPivot);
  root.add(gateDoorGroup);

  // Lock Mechanism Prop at (62.2, 142, 0): thick iron bar and lock box
  const lockGroup = new THREE.Group();
  lockGroup.position.set(62.2, 142.0, 0);
  const lockBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.74), mats.iron);
  const lockBar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 3.8), mats.iron);
  lockBar.position.set(-0.08, 0.04, 0);
  lockBar.rotation.x = 0.06; // Slightly crooked ("failing" state initially)
  const lockPin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.45, 8), mats.brass);
  lockPin.position.set(-0.18, 0.1, 0.15);
  lockGroup.add(lockBox, lockBar, lockPin);
  root.add(lockGroup);

  // Two big gate lanterns + Gate brazier
  ctx.lamps.add({
    id: 'gate-lantern-north',
    position: [60.5, 145.2, -3.2],
    size: 1.45,
    state: 'lit',
    hasGroundPool: true,
  });
  ctx.lamps.add({
    id: 'gate-lantern-south',
    position: [60.5, 145.2, 3.2],
    size: 1.45,
    state: 'lit',
    hasGroundPool: true,
  });
  // Gate brazier at (59.5, 140, 4.2)
  kb.addCylinder(0.75, 0.52, 1.15, 10, 59.5, 140.58, 4.2, 'iron');
  kb.addCylinder(0.62, 0.4, 0.25, 10, 59.5, 141.2, 4.2, 'emberCore');
  ctx.lamps.add({
    id: 'gate-brazier',
    position: [59.5, 141.6, 4.2],
    size: 1.35,
    state: 'ember',
    hasGroundPool: true,
  });

  // Spur Battlement Walls running North and South (140m each side) + Corner Towers
  for (const signZ of [-1, 1]) {
    for (let seg = 0; seg < 7; seg++) {
      const z0 = signZ * (10 + seg * 18);
      const z1 = signZ * (10 + (seg + 1) * 18);
      const zm = (z0 + z1) * 0.5;
      const xOff = gateX - seg * 1.8;
      const groundY = Math.max(132, heightAt(xOff, zm));
      kb.addPart(
        buildTerraceWallGeo(2.8, 5.2, 18.4, 0.08),
        'stone',
        new THREE.Matrix4().setPosition(xOff, groundY + 2.6, zm)
      );
      // Crenellations
      for (let c = -3; c <= 3; c += 2) {
        kb.addBox(0.9, 0.85, 1.8, xOff + 0.8, groundY + 5.6, zm + c * 2.2, 'stone');
      }
    }
    // Corner watchtower at end of wall
    const towerZ = signZ * 136;
    const towerX = gateX - 12.6;
    const towerY = Math.max(132, heightAt(towerX, towerZ));
    const towerKb = buildBuildingKit({
      footprint: [7.2, 7.2],
      floors: 3,
      style: 'tower',
      seed: signZ > 0 ? 701 : 702,
    });
    kb.addChildBuilder(towerKb, new THREE.Matrix4().setPosition(towerX, towerY, towerZ));
    ctx.lamps.add({
      position: [towerX, towerY + 11.5, towerZ],
      size: 1.3,
      state: 'lit',
    });
  }

  // ============================================================================
  // 2. COURTYARD (30, 0) & SEREN'S GUARD POST AT (56, 140, -6)
  // ============================================================================
  // Courtyard flagstone paving border
  kb.addBox(28, 0.16, 22, 38, 140.02, 0, 'stone');

  // Seren's Guard Post Pavilion at (56, 140, -6)
  const guardPostKb = buildBuildingKit({
    footprint: [6.4, 5.2],
    floors: 1,
    style: 'pavilion',
    seed: 204,
  });
  // Weapon racks (staves and spears, no swords drawn)
  guardPostKb.addBox(1.8, 1.4, 0.3, -1.8, 1.35, -1.6, 'timber');
  for (let s = -3; s <= 3; s++) {
    guardPostKb.addCylinder(0.03, 0.035, 2.35, 6, -1.8 + s * 0.22, 1.85, -1.6, 'timber');
    guardPostKb.addCylinder(0.04, 0.01, 0.28, 6, -1.8 + s * 0.22, 3.1, -1.6, 'iron');
  }
  // Watch Bell hanging under guard post eave at local (-1.5, 2.3, 1.5) -> world (54.5, 142.3, -4.5)
  guardPostKb.addCylinder(0.28, 0.38, 0.62, 10, -1.5, 2.35, 1.5, 'iron');
  const guardPostContainer = ctx.overrides.wrapWithOverride(
    'guard-post',
    guardPostKb.toMergedGroup('seren-guard-post'),
    [56, 140, -6]
  );
  root.add(guardPostContainer);
  ctx.lamps.add({
    id: 'guard-post-lamp',
    position: [56, 143.1, -3.5],
    size: 1.15,
    state: 'lit',
    hasGroundPool: true,
  });

  // ============================================================================
  // 3. STEPPED MAIN STREET TO UPPER TERRACE (-45, -10; 150 m) & 12 PROMISE HOOKS
  // ============================================================================
  // Broad stepped stair-street 6m wide climbing west from (12, 140, -2) to (-20, 150, -8)
  addStairs(kb, 6.2, 10.0, 32.0, 28, -4, 140.0, -5, Math.PI * 0.5, 'stone');

  // Upper Terrace retaining wall & platform at (-45, -10; y = 150)
  kb.addPart(
    buildTerraceWallGeo(58, 8.5, 3.5, 0.09),
    'stone',
    new THREE.Matrix4().setPosition(-45, 145.8, -28)
  );
  // Upper Terrace Shrine Pavilion at (-45, 150, -10)
  const upperShrineKb = buildBuildingKit({
    footprint: [11.5, 9.2],
    floors: 2,
    style: 'hall',
    seed: 309,
  });
  kb.addChildBuilder(upperShrineKb, new THREE.Matrix4().setPosition(-45, 150, -10));

  // Upper Terrace Railing along z = -28 from x = -72 to x = -13 with 12 Promise-Lantern Hooks
  addRailing(kb, 60, -42.5, 150.0, -28, 0, 'timber');
  for (let i = 0; i < 12; i++) {
    const hx = -70 + 5 * i;
    const hy = 152.2;
    const hz = -28;
    // Carved timber post & bracket for promise hook i
    kb.addBox(0.22, 2.4, 0.22, hx, 151.2, hz, 'lacquer');
    kb.addBox(0.16, 0.16, 0.65, hx, hy + 0.18, hz - 0.25, 'lacquer');

    const hookId = `promise-lantern-${i}`;
    // First 3 promise lanterns start softly lit so the player sees how kept oaths warm the terrace;
    // remaining 9 await future oaths
    ctx.lamps.add({
      id: hookId,
      slotGroup: 'promise',
      position: [hx, hy - 0.15, hz - 0.48],
      size: 0.95,
      state: i < 3 ? 'lit' : 'dim',
      hasGroundPool: i % 3 === 0,
    });
  }

  // ============================================================================
  // 4. MARKET AT (8, 140, -30) — 12 CLOTH-CANOPY STALLS
  // ============================================================================
  const stallClothMats = ['clothIvory', 'clothLacquer', 'clothInk'] as const;
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 6);
    const col = i % 6;
    const sx = -7 + col * 6.0;
    const sz = -25 - row * 9.5;
    const sy = heightAt(sx, sz);

    // 4 timber posts + counter + crates + swaying cloth canopy
    kb.addCylinder(0.08, 0.09, 2.6, 6, sx - 1.8, sy + 1.3, sz - 1.2, 'timber');
    kb.addCylinder(0.08, 0.09, 2.6, 6, sx + 1.8, sy + 1.3, sz - 1.2, 'timber');
    kb.addCylinder(0.08, 0.09, 2.4, 6, sx - 1.8, sy + 1.2, sz + 1.2, 'timber');
    kb.addCylinder(0.08, 0.09, 2.4, 6, sx + 1.8, sy + 1.2, sz + 1.2, 'timber');
    kb.addBox(3.4, 0.82, 1.1, sx, sy + 0.41, sz + 0.6, 'timber');
    kb.addBox(0.75, 0.65, 0.75, sx - 1.1, sy + 0.33, sz - 0.5, 'timber');
    kb.addBox(4.1, 0.12, 3.0, sx, sy + 2.55, sz, stallClothMats[i % 3]);

    if (i % 2 === 0) {
      ctx.lamps.add({
        position: [sx + 1.7, sy + 2.25, sz + 1.2],
        size: 0.85,
        state: 'lit',
      });
    }
  }

  // ============================================================================
  // 5. ARCHED STONE BRIDGE OVER THE STREAM AT (-12, 138, 5)
  // ============================================================================
  const bridgeKb = new KitBuilder();
  const bridgeSpan = 9.4;
  const bridgeW = 4.4;
  const archSegs = 8;
  for (let i = 0; i < archSegs; i++) {
    const t0 = i / archSegs - 0.5;
    const t1 = (i + 1) / archSegs - 0.5;
    const tm = (t0 + t1) * 0.5;
    const xPos = tm * bridgeSpan;
    const archY = Math.cos(tm * Math.PI) * 1.45;
    bridgeKb.addBox(
      bridgeSpan / archSegs + 0.12,
      0.42,
      bridgeW,
      xPos,
      archY,
      0,
      'stone'
    );
    // Parapets on both sides
    bridgeKb.addBox(
      bridgeSpan / archSegs + 0.08,
      0.75,
      0.28,
      xPos,
      archY + 0.55,
      -bridgeW * 0.5 + 0.15,
      'stone'
    );
    bridgeKb.addBox(
      bridgeSpan / archSegs + 0.08,
      0.75,
      0.28,
      xPos,
      archY + 0.55,
      bridgeW * 0.5 - 0.15,
      'stone'
    );
  }
  // Four corner lamp posts on the bridge
  for (const bx of [-bridgeSpan * 0.48, bridgeSpan * 0.48]) {
    for (const bz of [-bridgeW * 0.46, bridgeW * 0.46]) {
      bridgeKb.addBox(0.38, 1.65, 0.38, bx, 1.05, bz, 'stone');
      ctx.lamps.add({
        position: [-12 + bx, 138 + 2.05, 5 + bz],
        size: 0.95,
        state: 'lit',
      });
    }
  }
  const bridgeContainer = ctx.overrides.wrapWithOverride(
    'stone-bridge',
    bridgeKb.toMergedGroup('stone-bridge'),
    [-12, 138, 5]
  );
  root.add(bridgeContainer);

  // ============================================================================
  // 6. LOWER COURT (-5, 131, 48): ORIN'S WORKSHOP (-8, 131, 48), WELL (-4, 131, 40) & WALL
  // ============================================================================
  const workshopKb = buildBuildingKit({
    footprint: [10.4, 8.2],
    floors: 1,
    style: 'workshop',
    seed: 512,
  });
  // Glowing Stone & Iron Forge inside Orin's Workshop
  workshopKb.addBox(2.4, 1.35, 1.9, -2.2, 1.3, -1.8, 'stone');
  workshopKb.addBox(1.5, 2.8, 1.4, -2.2, 3.2, -2.1, 'stone'); // Chimney hood
  workshopKb.addCylinder(0.62, 0.55, 0.35, 10, -2.2, 2.02, -1.6, 'emberCore');
  // Anvil & lumber stacks
  workshopKb.addBox(0.85, 0.72, 0.48, -0.2, 1.0, -0.8, 'iron');
  workshopKb.addBox(2.6, 0.9, 1.2, 2.8, 1.1, -1.5, 'timber');

  const workshopContainer = ctx.overrides.wrapWithOverride(
    'workshop',
    workshopKb.toMergedGroup('orin-workshop'),
    [-8, 131, 48]
  );
  root.add(workshopContainer);
  ctx.lamps.add({
    id: 'orin-forge-lamp',
    position: [-10.2, 133.2, 46.4],
    size: 1.6,
    state: 'ember',
    hasGroundPool: true,
  });

  // Town Well at (-4, 131, 40) — wrapped with Override slot 'well' (loads public/world/models/well.glb if present)
  const wellKb = new KitBuilder();
  wellKb.addCylinder(1.25, 1.35, 0.95, 12, 0, 0.48, 0, 'stone');
  wellKb.addCylinder(0.95, 0.95, 0.85, 12, 0, 0.45, 0, 'iron');
  wellKb.addCylinder(0.1, 0.1, 2.2, 6, -1.05, 1.5, 0, 'timber');
  wellKb.addCylinder(0.1, 0.1, 2.2, 6, 1.05, 1.5, 0, 'timber');
  buildCurvedRoofParts(wellKb, 2.4, 2.0, 0.45, 0.75, 0.55, 0.25, 2.55, false);
  const wellContainer = ctx.overrides.wrapWithOverride(
    'well',
    wellKb.toMergedGroup('lower-court-well'),
    [-4, 131, 40]
  );
  root.add(wellContainer);
  ctx.colliders.addCircle(-4, 40, 1.45, 'well');

  // Lower wall stretching from (20, 134, 40) to (55, 136, 55) with optional scaffolding
  const wallDx = 55 - 20;
  const wallDz = 55 - 40;
  const wallLen = Math.hypot(wallDx, wallDz);
  const wallAngle = Math.atan2(-wallDz, wallDx);
  kb.addPart(
    buildTerraceWallGeo(wallLen, 4.8, 2.4, 0.08),
    'stone',
    new THREE.Matrix4().makeRotationY(wallAngle).setPosition(37.5, 135.2, 47.5)
  );

  // Toggleable timber scaffolding along the lower wall
  const scaffoldingKb = new KitBuilder();
  for (let i = -3; i <= 3; i++) {
    const sx = i * 3.2;
    scaffoldingKb.addCylinder(0.07, 0.08, 4.8, 6, sx, 2.4, 1.55, 'timber');
    scaffoldingKb.addCylinder(0.07, 0.08, 4.8, 6, sx, 2.4, 2.65, 'timber');
    scaffoldingKb.addBox(0.12, 0.12, 1.2, sx, 2.2, 2.1, 'timber');
    scaffoldingKb.addBox(0.12, 0.12, 1.2, sx, 3.8, 2.1, 'timber');
  }
  scaffoldingKb.addBox(20, 0.08, 0.95, 0, 2.26, 2.1, 'timber');
  scaffoldingKb.addBox(20, 0.08, 0.95, 0, 3.86, 2.1, 'timber');
  const scaffoldingGroup = scaffoldingKb.toMergedGroup('lower-wall-scaffolding');
  scaffoldingGroup.position.set(37.5, 133.0, 47.5);
  scaffoldingGroup.rotation.y = wallAngle;
  root.add(scaffoldingGroup);

  // ============================================================================
  // 7. 35 CONTOUR HOUSES, PAVILIONS & LANES ACROSS THE THREE TERRACES (~45 TOTAL)
  // ============================================================================
  const housePlacements: Array<{
    x: number;
    z: number;
    w: number;
    d: number;
    floors: 1 | 2;
    rotY: number;
    style: 'house' | 'hall' | 'pavilion';
  }> = [
    // Courtyard & Main Street North/South flanks (10 buildings)
    { x: 44, z: -18, w: 7.5, d: 6.2, floors: 2, rotY: 0.08, style: 'house' },
    { x: 32, z: -20, w: 8.2, d: 6.5, floors: 2, rotY: -0.05, style: 'house' },
    { x: 20, z: -16, w: 7.0, d: 5.8, floors: 1, rotY: 0.12, style: 'house' },
    { x: 45, z: 18, w: 8.0, d: 6.4, floors: 2, rotY: 3.1, style: 'house' },
    { x: 31, z: 20, w: 7.4, d: 6.0, floors: 1, rotY: 3.18, style: 'house' },
    { x: 18, z: 17, w: 8.6, d: 6.8, floors: 2, rotY: 3.05, style: 'house' },
    { x: 6, z: 16, w: 7.2, d: 5.6, floors: 1, rotY: 2.95, style: 'house' },
    { x: -6, z: -16, w: 7.8, d: 6.2, floors: 2, rotY: 0.15, style: 'house' },
    { x: -18, z: -19, w: 8.4, d: 6.4, floors: 2, rotY: -0.1, style: 'house' },
    { x: -18, z: 16, w: 7.2, d: 5.8, floors: 1, rotY: 2.8, style: 'house' },

    // Market & North Ward perimeter (9 buildings)
    { x: 24, z: -36, w: 8.5, d: 6.5, floors: 2, rotY: -1.45, style: 'house' },
    { x: 14, z: -46, w: 9.2, d: 7.0, floors: 2, rotY: 0.05, style: 'hall' },
    { x: 0, z: -48, w: 7.6, d: 6.2, floors: 1, rotY: -0.08, style: 'house' },
    { x: -14, z: -45, w: 8.0, d: 6.4, floors: 2, rotY: 0.22, style: 'house' },
    { x: -26, z: -36, w: 7.4, d: 5.8, floors: 1, rotY: 1.35, style: 'house' },
    { x: 36, z: -42, w: 7.8, d: 6.0, floors: 1, rotY: -0.6, style: 'house' },
    { x: 48, z: -34, w: 8.2, d: 6.5, floors: 2, rotY: -1.1, style: 'house' },
    { x: 52, z: 32, w: 7.6, d: 6.2, floors: 1, rotY: 2.2, style: 'house' },
    { x: 38, z: 34, w: 8.0, d: 6.4, floors: 2, rotY: 2.6, style: 'house' },

    // Upper Terrace (-45, -10; 150m) contour lane houses (10 buildings)
    { x: -32, z: 10, w: 7.8, d: 6.2, floors: 2, rotY: 2.9, style: 'house' },
    { x: -46, z: 14, w: 8.6, d: 6.6, floors: 2, rotY: 3.14, style: 'house' },
    { x: -60, z: 10, w: 7.5, d: 6.0, floors: 1, rotY: -2.7, style: 'house' },
    { x: -68, z: -4, w: 8.2, d: 6.4, floors: 2, rotY: 1.57, style: 'house' },
    { x: -66, z: -18, w: 7.4, d: 5.8, floors: 1, rotY: 1.2, style: 'house' },
    { x: -30, z: -20, w: 7.6, d: 6.0, floors: 1, rotY: -0.4, style: 'house' },
    { x: -55, z: 24, w: 6.2, d: 6.2, floors: 1, rotY: 0.4, style: 'pavilion' },
    { x: -38, z: 26, w: 7.4, d: 5.8, floors: 1, rotY: 2.8, style: 'house' },
    { x: -74, z: 12, w: 7.2, d: 5.6, floors: 1, rotY: 1.8, style: 'house' },
    { x: -24, z: 24, w: 7.8, d: 6.2, floors: 2, rotY: 2.5, style: 'house' },

    // Lower Court (-5, 131, 48) lane houses (8 buildings)
    { x: 10, z: 46, w: 7.6, d: 6.2, floors: 1, rotY: -1.4, style: 'house' },
    { x: 8, z: 60, w: 8.2, d: 6.4, floors: 2, rotY: 2.9, style: 'house' },
    { x: -6, z: 66, w: 7.8, d: 6.0, floors: 1, rotY: 3.14, style: 'house' },
    { x: -20, z: 60, w: 7.4, d: 5.8, floors: 2, rotY: 1.8, style: 'house' },
    { x: -24, z: 46, w: 8.0, d: 6.2, floors: 1, rotY: 1.45, style: 'house' },
    { x: -22, z: 32, w: 7.2, d: 5.8, floors: 1, rotY: 0.8, style: 'house' },
    { x: 22, z: 56, w: 7.5, d: 6.0, floors: 1, rotY: -2.1, style: 'house' },
    { x: -12, z: 76, w: 6.8, d: 5.4, floors: 1, rotY: 2.9, style: 'house' },
  ];

  for (let i = 0; i < housePlacements.length; i++) {
    const hp = housePlacements[i];
    const hy = heightAt(hp.x, hp.z);
    const bKb = buildBuildingKit({
      footprint: [hp.w, hp.d],
      floors: hp.floors,
      style: hp.style,
      seed: 1000 + i * 37,
    });
    const m = new THREE.Matrix4().makeRotationY(hp.rotY).setPosition(hp.x, hy, hp.z);
    kb.addChildBuilder(bKb, m);
    ctx.colliders.addBox(hp.x, hp.z, hp.w * 0.5, hp.d * 0.5, hp.rotY, `house-${i}`);

    // Register 1 eave lantern per house from its computed lamp socket
    if (bKb.lampPositions.length > 0) {
      const lp = bKb.lampPositions[0].clone().applyMatrix4(m);
      ctx.lamps.add({
        position: lp,
        size: 0.9,
        state: 'lit',
      });
    }
  }

  // Merge all static East Gate geometry into 4 spatial quadrants
  const merged = mergePlaceSpatialChunks(kb.parts, 10, 0, 'east-gate', 4);
  root.add(merged.group);

  // ============================================================================
  // 8. ROOFTOP CATS (2 INSTANCED SILHOUETTES) & CIRCLING TOWER BIRDS (12 INSTANCED)
  // ============================================================================
  const catGeo = new THREE.ConeGeometry(0.18, 0.44, 6);
  const catMesh = new THREE.InstancedMesh(catGeo, mats.clothInk, 4);
  const catAnchors: Array<[number, number, number]> = [
    [44, heightAt(44, -18) + 8.6, -18],
    [31, heightAt(31, 20) + 5.4, 20],
    [-46, heightAt(-46, 14) + 8.8, 14],
    [-8, 136.4, 48],
  ];
  const dummy = new THREE.Object3D();
  catAnchors.forEach(([cx, cy, cz], idx) => {
    dummy.position.set(cx, cy, cz);
    dummy.scale.set(1, 1, 1.35);
    dummy.updateMatrix();
    catMesh.setMatrixAt(idx, dummy.matrix);
  });
  catMesh.instanceMatrix.needsUpdate = true;
  root.add(catMesh);

  const birdCount = 12;
  const birdGeo = new THREE.BufferGeometry();
  const birdVerts = new Float32Array([
    0, 0, 0.18, -0.45, 0.08, -0.08, 0, 0, -0.14,
    0, 0, 0.18, 0, 0, -0.14, 0.45, 0.08, -0.08,
  ]);
  birdGeo.setAttribute('position', new THREE.BufferAttribute(birdVerts, 3));
  birdGeo.computeVertexNormals();
  const birdMesh = new THREE.InstancedMesh(birdGeo, mats.clothInk, birdCount);
  birdMesh.frustumCulled = false;
  root.add(birdMesh);

  // ============================================================================
  // 9. REGISTER INTERACTABLES FOR EAST GATE TOWN (Prompt 5 Section 8)
  // ============================================================================
  let gateDoorOpen = false;
  let gateDoorTargetAngle = 0;
  let gateDoorCurrentAngle = 0;

  ctx.interactables.register({
    id: 'gate-lock',
    kind: 'object',
    position: new THREE.Vector3(62.2, 141.6, 0),
    radius: 3.8,
    prompt: 'Inspect the Gate Lock',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.('The heavy iron crossbar is strained; one brass shear-pin has worked loose.');
    },
  });

  ctx.interactables.register({
    id: 'gate-door',
    kind: 'door',
    position: new THREE.Vector3(61.5, 141.4, 1.4),
    radius: 4.0,
    prompt: 'Shift the Great Gate Doors',
    enabled: () => true,
    onUse: () => {
      gateDoorOpen = !gateDoorOpen;
      gateDoorTargetAngle = gateDoorOpen ? 0.28 : 0.0;
      ctx.onNotice?.(
        gateDoorOpen
          ? 'The iron-studded timber leaves creak open a hand-span toward the mist road.'
          : 'The Great Gate leaves settle back against the stone jamb.'
      );
    },
  });

  ctx.interactables.register({
    id: 'bell',
    kind: 'object',
    position: new THREE.Vector3(54.5, 141.8, -4.5),
    radius: 3.6,
    prompt: 'Ring the Watch Bell',
    enabled: () => true,
    onUse: () => {
      ctx.onRingBell?.();
      ctx.onNotice?.('A clear bronze note rolls across the courtyard and out over the mist.');
    },
  });

  ctx.interactables.register({
    id: 'well',
    kind: 'object',
    position: new THREE.Vector3(-4, 132.0, 40),
    radius: 3.6,
    prompt: 'Draw Water from the Well',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.('Cold mountain water rises from the cistern below the lower court.');
    },
  });

  ctx.interactables.register({
    id: 'lantern',
    kind: 'object',
    position: new THREE.Vector3(-45, 151.5, -28),
    radius: 4.0,
    prompt: 'Inspect the Promise-Lantern Railing',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.('Twelve carved brackets overlook the valley—each hook reserved for a kept oath.');
    },
  });

  return {
    group: root,
    stats: merged.stats,
    setScaffoldingVisible(visible: boolean) {
      scaffoldingGroup.visible = visible;
    },
    update(realSeconds: number, dt: number) {
      // Smoothly animate gate door leaves when toggled
      gateDoorCurrentAngle += (gateDoorTargetAngle - gateDoorCurrentAngle) * Math.min(1, dt * 4.5);
      leftDoorPivot.rotation.y = -gateDoorCurrentAngle;
      rightDoorPivot.rotation.y = gateDoorCurrentAngle;

      // Animate circling birds around the North & South Gate Towers
      for (let i = 0; i < birdCount; i++) {
        const towerCenterZ = i < 6 ? -118 : 118;
        const angle = realSeconds * 0.45 + (i * Math.PI * 2) / 6;
        const r = 14 + (i % 3) * 3.5;
        const bx = 54 + Math.cos(angle) * r;
        const bz = towerCenterZ + Math.sin(angle) * r;
        const by = 162 + Math.sin(realSeconds * 1.4 + i) * 1.8;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, -angle, Math.sin(realSeconds * 6.5 + i * 1.3) * 0.25);
        dummy.scale.setScalar(1.1);
        dummy.updateMatrix();
        birdMesh.setMatrixAt(i, dummy.matrix);
      }
      birdMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      ctx.interactables.unregister('gate-lock');
      ctx.interactables.unregister('gate-door');
      ctx.interactables.unregister('bell');
      ctx.interactables.unregister('well');
      ctx.interactables.unregister('lantern');
      catGeo.dispose();
      birdGeo.dispose();
    },
  };
}
