import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import {
  addRailing,
  addStairs,
  buildBuildingKit,
  KitBuilder,
} from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';

export interface LanternTerraceContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  colliders: ColliderGrid;
  overrides: ModelOverrides;
  onNotice?: (msg: string) => void;
}

export interface BuiltLanternTerraceNear {
  group: THREE.Group;
  stats: MergeStats;
  update(realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the distant silhouette of Lantern Terrace (`buildFar()`) at (-262, 96, 214).
 */
export function buildLanternTerraceFar(): THREE.Group {
  const [cx, cy, cz] = LANDMARKS.terraceCottage;
  const kb = new KitBuilder();
  kb.addBox(24, 1.2, 16, cx, cy - 0.6, cz, 'timber');
  const cottage = buildBuildingKit({
    footprint: [12, 9],
    floors: 1,
    style: 'house',
    seed: 910,
  });
  kb.addChildBuilder(cottage, new THREE.Matrix4().setPosition(cx - 3, cy, cz - 2));
  return mergePlaceSpatialChunks(kb.parts, cx, cz, 'lantern-terrace-far', 1).group;
}

/**
 * Builds Ione's Lantern Terrace (`LanternTerrace.ts` — Prompt 5 Section 5) at (-262, 96, 214):
 * - Timber cottage on stilts (12 × 9 m)
 * - Wide wooden deck (24 × 16 m) with railings over the valley mist shelf
 * - The Still: copper/brass vessels, glass/ember retort with warm glow, herb drying racks, raised herb beds, crates & jars
 * - 40 hanging lanterns on a catenary rope net above the deck (tuned for dusk)
 * - 30 m rope footbridge spanning to an outcrop with a stone seat
 * - Wooden stairs descending the ledge toward the valley floor
 */
export function buildLanternTerraceNear(ctx: LanternTerraceContext): BuiltLanternTerraceNear {
  const [cx, cy, cz] = LANDMARKS.terraceCottage; // [-262, 96, 214]
  const root = new THREE.Group();
  root.name = 'LanternTerraceNear';
  const kb = new KitBuilder();

  // 1. Wide wooden deck (24 × 16 m) supported on tall timber stilts over the cliff drop
  kb.addBox(24, 0.45, 16, cx, cy - 0.22, cz, 'timber');
  for (let ix = -11; ix <= 11; ix += 4.4) {
    for (let iz = -7; iz <= 7; iz += 4.6) {
      kb.addCylinder(0.22, 0.26, 14.0, 8, cx + ix, cy - 7.0, cz + iz, 'timber');
    }
  }
  // Perimeter deck railings
  addRailing(kb, 24, cx, cy, cz - 7.8, 0, 'timber');
  addRailing(kb, 18, cx - 3, cy, cz + 7.8, 0, 'timber');
  addRailing(kb, 16, cx - 11.8, cy, cz, Math.PI * 0.5, 'timber');

  // 2. Timber Cottage on stilts (12 × 9 m) at (cx - 4, cy, cz - 2)
  const cottageKb = buildBuildingKit({
    footprint: [12, 9],
    floors: 1,
    style: 'house',
    seed: 912,
  });
  const cottageContainer = ctx.overrides.wrapWithOverride(
    'terrace-cottage',
    cottageKb.toMergedGroup('terrace-cottage'),
    [cx - 4, cy, cz - 2]
  );
  root.add(cottageContainer);
  ctx.colliders.addBox(cx - 4, cz - 2, 6.2, 4.7, 0, 'terrace-cottage');

  // 3. The Still (copper/brass vessels, ember glass retort, herb drying racks, raised herb beds)
  const stillKb = new KitBuilder();
  stillKb.addBox(3.4, 0.9, 1.8, 0, 0.45, 0, 'stone'); // Worktable
  stillKb.addCylinder(0.48, 0.56, 1.25, 12, -0.8, 1.5, 0, 'brass'); // Primary copper alembic boiler
  stillKb.addCylinder(0.18, 0.42, 0.55, 10, -0.8, 2.35, 0, 'brass'); // Alembic dome
  stillKb.addCylinder(0.05, 0.05, 1.6, 8, 0.0, 2.45, 0, 'brass'); // Condenser coil arm
  stillKb.addCylinder(0.34, 0.28, 0.95, 10, 0.85, 1.38, 0, 'emberCore'); // Glowing ember retort vessel
  const stillContainer = ctx.overrides.wrapWithOverride(
    'still',
    stillKb.toMergedGroup('ione-still'),
    [cx + 6.5, cy, cz - 3.2]
  );
  root.add(stillContainer);
  ctx.lamps.add({
    id: 'ione-still-glow',
    position: [cx + 7.3, cy + 1.5, cz - 3.2],
    size: 1.25,
    state: 'ember',
    hasGroundPool: true,
  });

  // Herb drying racks & raised herb beds on the deck and lower step
  for (let r = 0; r < 3; r++) {
    const rx = cx + 5.2 + r * 2.1;
    const rz = cz + 2.8;
    kb.addCylinder(0.06, 0.06, 2.2, 6, rx, cy + 1.1, rz - 0.8, 'timber');
    kb.addCylinder(0.06, 0.06, 2.2, 6, rx, cy + 1.1, rz + 0.8, 'timber');
    kb.addBox(0.12, 0.08, 1.8, rx, cy + 1.9, rz, 'timber');
    kb.addBox(0.35, 0.65, 1.4, rx, cy + 1.4, rz, 'clothLacquer');
  }
  // Raised herb planter beds
  for (let b = 0; b < 4; b++) {
    const bx = cx - 8 + b * 3.8;
    const bz = cz + 5.2;
    kb.addBox(2.6, 0.55, 1.4, bx, cy + 0.28, bz, 'timber');
    kb.addBox(2.3, 0.35, 1.1, bx, cy + 0.65, bz, 'clothIvory');
  }

  // 4. 40 Hanging Lanterns on an overhead rope net above the deck (8 × 5 catenary grid)
  // Support poles at the 4 deck corners
  for (const px of [cx - 11.4, cx + 11.4]) {
    for (const pz of [cz - 7.4, cz + 7.4]) {
      kb.addCylinder(0.14, 0.16, 6.2, 8, px, cy + 3.1, pz, 'timber');
    }
  }
  for (let gx = 0; gx < 8; gx++) {
    const u = gx / 7;
    const lx = cx - 10.2 + u * 20.4;
    // Rope stringer along Z
    kb.addBox(0.05, 0.05, 14.4, lx, cy + 5.4, cz, 'timber');
    for (let gz = 0; gz < 5; gz++) {
      const v = gz / 4;
      const lz = cz - 6.2 + v * 12.4;
      const sag = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.85;
      const ly = cy + 5.5 - sag;
      ctx.lamps.add({
        id: `terrace-net-lamp-${gx}-${gz}`,
        position: [lx, ly, lz],
        size: 0.92 + ((gx + gz) % 3) * 0.12,
        state: 'lit',
        hasGroundPool: (gx + gz) % 4 === 0,
      });
    }
  }

  // 5. 30 m Rope Footbridge to a small outcrop at (cx - 42, cy - 1.5, cz + 12) with a Stone Seat
  const bridgeLen = 30.0;
  const bridgeAngle = 0.32;
  const bridgeCenterX = cx - 26;
  const bridgeCenterZ = cz + 5;
  const bridgeKb = new KitBuilder();
  const planks = 26;
  for (let i = 0; i < planks; i++) {
    const t = i / (planks - 1) - 0.5;
    const px = t * bridgeLen;
    const sag = (1.0 - 4.0 * t * t) * -1.15;
    bridgeKb.addBox(0.85, 0.12, 1.8, px, sag, 0, 'timber');
    if (i % 3 === 0) {
      bridgeKb.addCylinder(0.05, 0.05, 1.05, 6, px, sag + 0.52, -0.85, 'timber');
      bridgeKb.addCylinder(0.05, 0.05, 1.05, 6, px, sag + 0.52, 0.85, 'timber');
    }
  }
  // Handrail ropes
  bridgeKb.addBox(bridgeLen, 0.06, 0.06, 0, 0.45, -0.85, 'timber');
  bridgeKb.addBox(bridgeLen, 0.06, 0.06, 0, 0.45, 0.85, 'timber');
  kb.addChildBuilder(
    bridgeKb,
    new THREE.Matrix4().makeRotationY(bridgeAngle).setPosition(bridgeCenterX, cy - 0.2, bridgeCenterZ)
  );

  // Outcrop stone platform & Stone Seat at the end of the rope footbridge
  const outcropX = cx - 40.5;
  const outcropZ = cz + 9.8;
  kb.addCylinder(4.6, 3.2, 6.5, 10, outcropX, cy - 3.4, outcropZ, 'stone');
  kb.addBox(2.1, 0.55, 0.85, outcropX - 1.2, cy + 0.28, outcropZ, 'stone');
  ctx.lamps.add({
    position: [outcropX + 1.4, cy + 1.6, outcropZ - 1.2],
    size: 1.1,
    state: 'lit',
    hasGroundPool: true,
  });

  // 6. Wooden stairs down the eastern ledge toward the valley floor
  addStairs(kb, 2.8, 9.5, 16.0, 22, cx + 11.5, cy - 9.5, cz + 4.0, -Math.PI * 0.5, 'timber');

  const merged = mergePlaceSpatialChunks(kb.parts, cx, cz, 'lantern-terrace', 2);
  root.add(merged.group);

  ctx.interactables.register({
    id: 'terrace-still',
    kind: 'object',
    position: new THREE.Vector3(cx + 6.5, cy + 1.2, cz - 3.2),
    radius: 3.6,
    prompt: 'Inspect the Copper Still',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.('Warm mountain-herb distillate condenses drop by drop inside the glass retort.');
    },
  });

  return {
    group: root,
    stats: merged.stats,
    update() {
      // Lanterns and wind-swayed herb cloths are driven by shared GPU uniforms
    },
    dispose() {
      ctx.interactables.unregister('terrace-still');
    },
  };
}
