import * as THREE from 'three';
import {
  buildBuildingKit,
  KitBuilder,
} from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides, OverrideModelId } from '../arch/Overrides.ts';
import { U } from '../uniforms.ts';

export interface SkyIslandSpec {
  id: OverrideModelId;
  center: readonly [number, number, number];
  radius: number;
  role: 'landing' | 'shrine' | 'forest' | 'tower' | 'ruin' | 'spire' | 'stepping';
}

export const SKY_ISLAND_SPECS: ReadonlyArray<SkyIslandSpec> = [
  { id: 'island-1', center: [-110, 985, -620], radius: 140, role: 'landing' },
  { id: 'island-2', center: [-300, 1120, -480], radius: 70, role: 'shrine' },
  { id: 'island-3', center: [80, 1210, -760], radius: 90, role: 'forest' },
  { id: 'island-4', center: [-420, 1010, -840], radius: 55, role: 'tower' },
  { id: 'island-5', center: [150, 1340, -540], radius: 110, role: 'ruin' },
  { id: 'island-6', center: [-160, 1450, -980], radius: 60, role: 'spire' },
  { id: 'island-7', center: [-50, 900, -330], radius: 45, role: 'stepping' },
] as const;

export interface SkyRealmsContext {
  lamps: LanternSystem;
  overrides: ModelOverrides;
}

export interface BuiltSkyRealmsNear {
  group: THREE.Group;
  stats: MergeStats;
  update(realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the tapering inverted rock cone + terraced cap geometry for a floating Sky Island.
 */
function buildIslandMassGeo(radius: number, depth: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(radius, depth, 18, 4);
  // Flip cone so flat base is on top (y = 0) and point tapers downward (y = -depth)
  geo.rotateX(Math.PI);
  geo.translate(0, -depth * 0.5, 0);

  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const angle = Math.atan2(vz, vx);
    const r = Math.hypot(vx, vz);
    const crag =
      Math.sin(angle * 5.0 + seed) * 0.12 +
      Math.cos(angle * 9.0 - seed * 1.7) * 0.07;

    if (vy > -1.0) {
      // Terraced top surface
      const terrace = Math.floor((1.0 - r / Math.max(1, radius)) * 3.0) * 1.4;
      pos.setY(i, vy + Math.max(0, terrace));
      pos.setX(i, vx * (1.0 + crag * 0.4));
      pos.setZ(i, vz * (1.0 + crag * 0.4));
    } else {
      // Stalactite crags along underside
      pos.setX(i, vx * (1.0 + crag));
      pos.setZ(i, vz * (1.0 + crag));
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the 38 m wooden airship (`airship`) with twin masts, swaying cloth sails, and stern lantern.
 */
function buildAirshipGroup(): THREE.Group {
  const kb = new KitBuilder();
  // 38 m timber hull + keel + raised stern deck
  kb.addBox(6.8, 3.6, 38.0, 0, 0, 0, 'timber');
  kb.addBox(4.2, 2.2, 42.0, 0, -2.1, 0, 'timber');
  kb.addBox(7.4, 2.4, 10.5, 0, 2.6, -13.5, 'lacquer');
  // Twin masts (fore and main)
  kb.addCylinder(0.28, 0.36, 18.0, 8, 0, 9.5, 6.5, 'timber');
  kb.addCylinder(0.28, 0.36, 16.0, 8, 0, 8.5, -5.5, 'timber');
  // Yardarms & big swaying cloth sails
  kb.addBox(14.0, 11.5, 0.18, 0, 10.2, 6.8, 'clothIvory');
  kb.addBox(12.0, 10.0, 0.18, 0, 9.2, -5.2, 'clothIvory');
  // Lateral outrigger fins
  kb.addBox(16.0, 0.22, 4.2, 0, 0.6, -2.0, 'clothLacquer');
  return kb.toMergedGroup('wooden-airship');
}

/**
 * Builds the always-resident distant silhouette of the 7 Sky Islands (`buildFar()`)
 * so they hang in the sky above the valley and Overlook from the very start.
 */
export function buildSkyRealmsFar(): THREE.Group {
  const kb = new KitBuilder();
  for (let i = 0; i < SKY_ISLAND_SPECS.length; i++) {
    const spec = SKY_ISLAND_SPECS[i];
    const [cx, cy, cz] = spec.center;
    const depth = spec.radius * 0.72;
    const massGeo = buildIslandMassGeo(spec.radius, depth, 40 + i * 13);
    kb.addPart(massGeo, 'stone', new THREE.Matrix4().setPosition(cx, cy, cz));

    // Silhouette crown structures
    if (spec.role === 'landing') {
      kb.addBox(22, 12, 18, cx, cy + 8, cz, 'lacquer');
    } else if (spec.role === 'tower' || spec.role === 'spire') {
      kb.addCylinder(4.5, 6.5, 36, 8, cx, cy + 18, cz, 'stone');
    } else if (spec.role === 'shrine') {
      kb.addBox(14, 10, 14, cx, cy + 6, cz, 'timber');
    }
  }
  return mergePlaceSpatialChunks(kb.parts, -110, -620, 'sky-realms-far', 2).group;
}

/**
 * Builds the full Sky Realms (`SkyRealms.ts` — Prompt 5 Section 7):
 * - 7 Floating Islands with terraced tops, stalactites, ember root veins, and architecture:
 *   1 Landing (-110, 985, -620) r 140: pavilion complex, small lake, edge waterfalls
 *   2 (-300, 1120, -480) r 70: shrine with giant bell
 *   3 (80, 1210, -760) r 90: pine forest island
 *   4 (-420, 1010, -840) r 55: tall tower on bare rock
 *   5 (150, 1340, -540) r 110: ruin with great waterfall
 *   6 (-160, 1450, -980) r 60: high spire with ring of lanterns
 *   7 (-50, 900, -330) r 45: stepping-stone island close to the Overlook
 * - Sky Bridges connecting 7->1, 1->2, 1->3, 3->5
 * - 3 Wooden Airships (38m long, twin masts, swaying sails) circling on splines at r = 300..400m
 */
export function buildSkyRealmsNear(ctx: SkyRealmsContext): BuiltSkyRealmsNear {
  const root = new THREE.Group();
  root.name = 'SkyRealmsNear';
  const kb = new KitBuilder();

  for (let i = 0; i < SKY_ISLAND_SPECS.length; i++) {
    const spec = SKY_ISLAND_SPECS[i];
    const [cx, cy, cz] = spec.center;
    const r = spec.radius;
    const depth = r * 0.78;

    // 1. Displaced island rock mass + underside stalactites + faint ember root veins
    const massGeo = buildIslandMassGeo(r, depth, 100 + i * 19);
    kb.addPart(massGeo, 'stone', new THREE.Matrix4().setPosition(cx, cy, cz));

    // Faint ember root veins on underside
    for (let v = 0; v < 4; v++) {
      const va = (v / 4) * Math.PI * 2 + i;
      const vx = cx + Math.cos(va) * r * 0.35;
      const vz = cz + Math.sin(va) * r * 0.35;
      kb.addCylinder(0.18, 0.05, depth * 0.55, 5, vx, cy - depth * 0.45, vz, 'emberCore');
    }

    // 2. Role-specific island architecture
    if (spec.role === 'landing') {
      // Pavilion complex + small sky lake + edge lanterns
      const mainHall = buildBuildingKit({
        footprint: [18, 14],
        floors: 2,
        style: 'hall',
        seed: 801,
      });
      kb.addChildBuilder(mainHall, new THREE.Matrix4().setPosition(cx, cy + 2.8, cz - 18));

      const eastPav = buildBuildingKit({
        footprint: [9, 9],
        floors: 1,
        style: 'pavilion',
        seed: 802,
      });
      kb.addChildBuilder(eastPav, new THREE.Matrix4().setPosition(cx + 32, cy + 1.4, cz + 12));

      const westPav = buildBuildingKit({
        footprint: [9, 9],
        floors: 1,
        style: 'pavilion',
        seed: 803,
      });
      kb.addChildBuilder(westPav, new THREE.Matrix4().setPosition(cx - 32, cy + 1.4, cz + 12));

      for (let l = 0; l < 8; l++) {
        const la = (l / 8) * Math.PI * 2;
        ctx.lamps.add({
          position: [cx + Math.cos(la) * 48, cy + 3.2, cz + Math.sin(la) * 48],
          size: 1.25,
          state: 'lit',
        });
      }
    } else if (spec.role === 'shrine') {
      // Island 2: Shrine with a giant bronze bell
      const shrine = buildBuildingKit({
        footprint: [12, 12],
        floors: 1,
        style: 'pavilion',
        seed: 810,
      });
      kb.addChildBuilder(shrine, new THREE.Matrix4().setPosition(cx, cy + 2.2, cz));
      kb.addCylinder(1.35, 1.85, 3.4, 12, cx, cy + 4.4, cz, 'brass');
      ctx.lamps.add({
        position: [cx, cy + 3.5, cz + 6.5],
        size: 1.3,
        state: 'lit',
      });
    } else if (spec.role === 'forest') {
      // Island 3: Pine grove & stone lantern shrine
      for (let t = 0; t < 18; t++) {
        const ta = (t / 18) * Math.PI * 2 + (t % 3) * 0.3;
        const tr = 14 + (t % 4) * 14;
        const tx = cx + Math.cos(ta) * tr;
        const tz = cz + Math.sin(ta) * tr;
        kb.addCylinder(0.28, 0.42, 7.5, 6, tx, cy + 4.5, tz, 'timber');
        kb.addCylinder(0.2, 3.4, 8.5, 7, tx, cy + 9.5, tz, 'clothInk');
      }
    } else if (spec.role === 'tower') {
      // Island 4: One tall tower on bare rock
      const tower = buildBuildingKit({
        footprint: [10, 10],
        floors: 3,
        style: 'tower',
        seed: 840,
      });
      kb.addChildBuilder(tower, new THREE.Matrix4().setPosition(cx, cy + 2.0, cz));
    } else if (spec.role === 'ruin') {
      // Island 5: Ancient colonnade ruin with great waterfall
      for (let c = 0; c < 10; c++) {
        const ca = (c / 10) * Math.PI * 2;
        const colH = 6.0 + (c % 3) * 3.5;
        kb.addCylinder(
          0.75,
          0.85,
          colH,
          10,
          cx + Math.cos(ca) * 34,
          cy + 2.0 + colH * 0.5,
          cz + Math.sin(ca) * 34,
          'stone'
        );
      }
    } else if (spec.role === 'spire') {
      // Island 6: High spire with a ring of 12 lanterns
      kb.addCylinder(2.2, 6.8, 46.0, 10, cx, cy + 23.0, cz, 'stone');
      for (let l = 0; l < 10; l++) {
        const la = (l / 10) * Math.PI * 2;
        ctx.lamps.add({
          position: [cx + Math.cos(la) * 18, cy + 12.0, cz + Math.sin(la) * 18],
          size: 1.25,
          state: 'ember',
        });
      }
    } else if (spec.role === 'stepping') {
      // Island 7: Low stepping-stone island close to Overlook
      kb.addCylinder(8.0, 9.0, 1.4, 12, cx, cy + 1.8, cz, 'stone');
      ctx.lamps.add({
        position: [cx, cy + 3.4, cz],
        size: 1.2,
        state: 'lit',
      });
    }
  }

  // 3. Rope and Stone-Arch Bridges: 7->1, 1->2, 1->3, 3->5
  const bridgePairs: Array<[number, number]> = [
    [6, 0], // 7 to 1
    [0, 1], // 1 to 2
    [0, 2], // 1 to 3
    [2, 4], // 3 to 5
  ];
  for (const [idxA, idxB] of bridgePairs) {
    const a = SKY_ISLAND_SPECS[idxA];
    const b = SKY_ISLAND_SPECS[idxB];
    const p0 = new THREE.Vector3(a.center[0], a.center[1] + 1.5, a.center[2]);
    const p1 = new THREE.Vector3(b.center[0], b.center[1] + 1.5, b.center[2]);
    const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
    p0.addScaledVector(dir, a.radius * 0.78);
    p1.addScaledVector(dir, -b.radius * 0.78);

    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    mid.y -= 9.5; // Catenary sag
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
    const tubeGeo = new THREE.TubeGeometry(curve, 18, 1.15, 6, false);
    kb.addPart(tubeGeo, 'timber', new THREE.Matrix4());
  }

  const merged = mergePlaceSpatialChunks(kb.parts, -110, -620, 'sky-realms', 4);
  root.add(merged.group);

  // 4. Waterfalls pouring off Island 1 (Landing) and Island 5 (Ruin) into the clouds
  const fallGeo = new THREE.CylinderGeometry(2.6, 5.8, 190, 10, 1, true);
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
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
        float streak = sin(vUv.x * 24.0) * 0.5 + 0.5;
        float cascade = fract(vUv.y * 5.0 + uTime * 0.9);
        float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float alpha = fade * (0.28 + 0.22 * streak * cascade);
        vec3 ivoryMist = vec3(0.92, 0.87, 0.78);
        gl_FragColor = vec4(ivoryMist, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const fall1 = new THREE.Mesh(fallGeo, fallMat);
  fall1.position.set(-110, 985 - 95, -620 + 132);
  const fall2 = new THREE.Mesh(fallGeo, fallMat);
  fall2.position.set(150, 1340 - 95, -540 + 102);
  root.add(fall1, fall2);

  // 5. Three Wooden Airships (38 m long) circling the islands on splines at radius 300..400m
  const airshipTemplate = buildAirshipGroup();
  const airships: THREE.Group[] = [];
  for (let a = 0; a < 3; a++) {
    const ship = ctx.overrides.wrapWithOverride(
      'airship',
      airshipTemplate.clone(true)
    );
    root.add(ship);
    airships.push(ship);
  }

  return {
    group: root,
    stats: {
      chunkCount: merged.stats.chunkCount,
      drawCalls: merged.stats.drawCalls + 14,
      triangles: merged.stats.triangles + 1450,
    },
    update(realSeconds: number) {
      for (let i = 0; i < 3; i++) {
        const radius = 320 + i * 42;
        const speed = 0.032 - i * 0.004;
        const angle = realSeconds * speed + (i * Math.PI * 2) / 3;
        const sx = -110 + Math.cos(angle) * radius;
        const sz = -620 + Math.sin(angle) * radius;
        const sy = 1045 + i * 115 + Math.sin(realSeconds * 0.75 + i * 2.0) * 4.5;

        const ship = airships[i];
        ship.position.set(sx, sy, sz);
        ship.rotation.y = -angle;
        ship.rotation.z = Math.sin(realSeconds * 1.1 + i) * 0.045;
        ship.rotation.x = Math.cos(realSeconds * 0.85 + i) * 0.03;
      }
    },
    dispose() {
      fallGeo.dispose();
      fallMat.dispose();
    },
  };
}
