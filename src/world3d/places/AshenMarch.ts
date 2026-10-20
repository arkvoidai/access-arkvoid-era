import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import { buildTerraceWallGeo, KitBuilder } from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import type { ColliderGrid } from '../life/Colliders.ts';
import { U } from '../uniforms.ts';

export interface AshenMarchContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  colliders: ColliderGrid;
  overrides: ModelOverrides;
  isLawSealLifted: () => boolean;
  onNotice?: (msg: string) => void;
}

export interface BuiltAshenMarchNear {
  group: THREE.Group;
  stats: MergeStats;
  update(playerPos: THREE.Vector3, realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the distant silhouette of the Ashen March Fortress Ruin & Lava Basin (`buildFar()`).
 */
export function buildAshenMarchFar(): THREE.Group {
  const kb = new KitBuilder();
  const [fx, fy, fz] = LANDMARKS.fortressRuin; // [-1250, 200, 520]
  kb.addBox(160, 28, 36, fx, fy + 14, fz, 'blackStone', 0.45);
  kb.addBox(24, 48, 24, fx - 55, fy + 24, fz - 22, 'blackStone', 0.45);
  kb.addBox(24, 42, 24, fx + 55, fy + 21, fz + 22, 'blackStone', 0.45);
  return mergePlaceSpatialChunks(kb.parts, fx, fz, 'ashen-march-far', 1).group;
}

/**
 * Builds The Ashen March (`AshenMarch.ts` — Prompt 5 Section 7):
 * - Lava Lake at (-1100, 58, 600), radius 220 m with domain-warped flow shader (`mats.lava`),
 *   dark crust plates, glowing ember cracks, bright vents, and `uNightLamp`-independent glow
 * - Colossal Black Stone Fortress Ruin at (-1250, 200, 520): 160 m long, bastions, broken towers,
 *   collapsed great gate, ember window slits
 * - The Law Seal at ravine entrance (-760, 120, 380): translucent wall of concentric geometric
 *   glyph rings (no letters, no Chinese characters) in ember on near-black, slowly turning and pulsing;
 *   acts as a physical barrier gently pushing the player back until Realm >= 5 (or Preview mode).
 */
export function buildAshenMarchNear(ctx: AshenMarchContext): BuiltAshenMarchNear {
  const root = new THREE.Group();
  root.name = 'AshenMarchNear';
  const kb = new KitBuilder();
  const mats = getArchMaterials();

  const [bx, , bz] = LANDMARKS.ashenBasin.center; // [-1100, 60, 600]
  const lavaY = LANDMARKS.ashenBasin.lavaLevel; // 58
  const lavaRadius = LANDMARKS.ashenBasin.lavaRadius; // 220

  // 1. Lava Lake disc (radius 220 m at y = 58)
  const lavaGeo = new THREE.CircleGeometry(lavaRadius, 36);
  lavaGeo.rotateX(-Math.PI * 0.5);
  const lavaMesh = new THREE.Mesh(lavaGeo, mats.lava);
  lavaMesh.position.set(bx, lavaY, bz);
  root.add(lavaMesh);

  // 2. Colossal Black Stone Fortress Ruin at (-1250, 200, 520) — 160 m long
  const [fx, fy, fz] = LANDMARKS.fortressRuin;
  const fortKb = new KitBuilder();
  // Main 160 m curtain wall with collapsed central gate breach
  fortKb.addPart(
    buildTerraceWallGeo(68, 28, 14, 0.1),
    'blackStone',
    new THREE.Matrix4().setPosition(-46, 14, 0)
  );
  fortKb.addPart(
    buildTerraceWallGeo(68, 26, 14, 0.1),
    'blackStone',
    new THREE.Matrix4().setPosition(46, 13, 0)
  );
  // Fallen gate lintel blocks in the breach
  fortKb.addBox(14, 8, 12, -4, 4, 4, 'blackStone', 0.35);
  fortKb.addBox(12, 7, 10, 8, 3.5, -3, 'blackStone', -0.28);

  // 4 Massive Bastions & Broken Towers along the 160 m ridge
  const towerOffsets = [-74, -26, 26, 74];
  towerOffsets.forEach((tx, idx) => {
    const th = 36 + (idx % 2) * 14;
    fortKb.addPart(
      buildTerraceWallGeo(22, th, 22, 0.08),
      'blackStone',
      new THREE.Matrix4().setPosition(tx, th * 0.5, 4)
    );
    // Jagged broken crown battlements
    fortKb.addBox(7, 9, 7, tx - 6, th + 4.5, 4 - 6, 'blackStone');
    fortKb.addBox(8, 6, 7, tx + 5, th + 3.0, 4 + 5, 'blackStone');
    // Glowing ember window slits
    fortKb.addBox(1.2, 6.5, 22.4, tx, th * 0.55, 4, 'emberCore');
  });

  const fortGroup = fortKb.toMergedGroup('fortress-ruin');
  const fortContainer = ctx.overrides.wrapWithOverride(
    'fortress-ruin',
    fortGroup,
    [fx, fy - 12, fz],
    0.48
  );
  root.add(fortContainer);

  const merged = mergePlaceSpatialChunks(kb.parts, bx, bz, 'ashen-march', 1);
  root.add(merged.group);

  // 3. The Law Seal at ravine entrance (-760, 120, 380): concentric geometric glyph rings
  const [sx, sy, sz] = LANDMARKS.lawSeal; // [-760, 120, 380]
  const sealGeo = new THREE.PlaneGeometry(36, 28);
  const sealMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = (uv - 0.5) * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float a = atan(vUv.y, vUv.x);

        // Purely geometric concentric rings and radial ticks (no letters, no characters)
        float ringOuter = smoothstep(0.025, 0.0, abs(r - 0.92));
        float ringMid   = smoothstep(0.02, 0.0, abs(r - 0.64));
        float ringInner = smoothstep(0.02, 0.0, abs(r - 0.34));

        float ticks1 = step(0.65, sin(a * 12.0 + uTime * 0.55)) * smoothstep(0.05, 0.0, abs(r - 0.78));
        float ticks2 = step(0.55, cos(a * 8.0 - uTime * 0.42)) * smoothstep(0.045, 0.0, abs(r - 0.49));
        float octagram = smoothstep(0.02, 0.0, abs(r - (0.34 + 0.12 * cos(a * 8.0 + uTime * 0.25))));

        float glyph = clamp(ringOuter + ringMid + ringInner + ticks1 + ticks2 + octagram, 0.0, 1.0);
        float field = (1.0 - r * r) * 0.28;
        float pulse = 0.82 + 0.18 * sin(uTime * 2.1);

        vec3 nearBlack = vec3(0.07, 0.05, 0.05);
        vec3 ember = vec3(0.984, 0.337, 0.027) * 1.85 * pulse; // #FB5607
        vec3 gold  = vec3(1.0, 0.74, 0.48) * 1.5;

        vec3 col = mix(nearBlack, mix(ember, gold, glyph * 0.45), glyph);
        float alpha = clamp(field + glyph * 0.88, 0.0, 0.94);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const sealMesh = new THREE.Mesh(sealGeo, sealMat);
  sealMesh.rotation.y = 0.62;
  const sealContainer = ctx.overrides.wrapWithOverride(
    'law-seal',
    sealMesh,
    [sx, sy + 11.0, sz]
  );
  root.add(sealContainer);

  ctx.interactables.register({
    id: 'law-seal',
    kind: 'object',
    position: new THREE.Vector3(sx, sy + 2.0, sz),
    radius: 6.5,
    prompt: 'Inspect the Law Seal',
    enabled: () => true,
    onUse: () => {
      const lifted = ctx.isLawSealLifted();
      ctx.onNotice?.(
        lifted
          ? 'The geometric rings of the Law Seal part before your realm resonance.'
          : 'Concentric rings of old law hum across the ravine, barring passage until Realm 5.'
      );
    },
  });

  return {
    group: root,
    stats: {
      chunkCount: 1,
      drawCalls: merged.stats.drawCalls + 4,
      triangles: merged.stats.triangles + 620,
    },
    update(playerPos: THREE.Vector3) {
      const lifted = ctx.isLawSealLifted();
      sealContainer.visible = !lifted;

      // Physical barrier: gently push player back if within 5.5 m of the active Law Seal
      if (!lifted) {
        const dx = playerPos.x - sx;
        const dz = playerPos.z - sz;
        const dist = Math.hypot(dx, dz);
        if (dist < 6.0 && dist > 0.001 && Math.abs(playerPos.y - sy) < 24) {
          const push = (6.0 - dist) * 0.45;
          playerPos.x += (dx / dist) * push;
          playerPos.z += (dz / dist) * push;
        }
      }
    },
    dispose() {
      ctx.interactables.unregister('law-seal');
      lavaGeo.dispose();
      sealGeo.dispose();
      sealMat.dispose();
    },
  };
}
