import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import { addRailing, KitBuilder } from '../arch/Kit.ts';
import type { LanternSystem } from '../arch/Lamps.ts';
import { getArchMaterials } from '../arch/Materials.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import type { InteractableRegistry } from '../Interactables.ts';
import { U } from '../uniforms.ts';

export interface OverlookContext {
  lamps: LanternSystem;
  interactables: InteractableRegistry;
  overrides: ModelOverrides;
  getPlayerRealm: () => number;
  onNotice?: (msg: string) => void;
  onSitBench?: () => void;
}

export interface BuiltOverlookNear {
  group: THREE.Group;
  stats: MergeStats;
  setBreathGlow(intensity01: number): void;
  update(realSeconds: number, dt: number): void;
  dispose(): void;
}

/**
 * Builds the distant silhouette of the Overlook summit platform (`buildFar()`) at (-120, 432, -560).
 */
export function buildOverlookFar(): THREE.Group {
  const [cx, cy, cz] = LANDMARKS.overlookPlatform.center;
  const kb = new KitBuilder();
  kb.addCylinder(14, 15.2, 2.4, 16, cx, cy - 1.2, cz, 'stone');
  return mergePlaceSpatialChunks(kb.parts, cx, cz, 'overlook-far', 1).group;
}

/**
 * Builds The Overlook (`Overlook.ts` — Prompt 5 Section 7) at (-120, 432, -560):
 * - Flat stone disc 28 m across (radius 14 m) with concentric engraved ink rings and an ember core
 *   at the centre (glows during breath practice)
 * - Partial stone balustrade and a stone bench (`overlook-bench`)
 * - Spirit Root plants (`spirit-root`) at (-112, 432, -566) among the Hero Maple's roots (pale ivory roots with slow ember pulses)
 * - The Ascent Column (`ascentColumn`): slow rising column of mist and pale light into the sky,
 *   stronger when player's realm >= 4
 */
export function buildOverlookNear(ctx: OverlookContext): BuiltOverlookNear {
  const [cx, cy, cz] = LANDMARKS.overlookPlatform.center; // [-120, 432, -560]
  const root = new THREE.Group();
  root.name = 'OverlookNear';
  const kb = new KitBuilder();
  const mats = getArchMaterials();

  // 1. Flat stone disc 28 m across (radius 14 m)
  kb.addCylinder(14.0, 15.2, 2.2, 24, cx, cy - 1.1, cz, 'stone');

  // Partial stone balustrade around the northern/eastern cliff edge
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI * 0.75 + (i / 5) * Math.PI * 0.9;
    const rx = cx + Math.cos(angle) * 13.2;
    const rz = cz + Math.sin(angle) * 13.2;
    addRailing(kb, 4.2, rx, cy, rz, -angle + Math.PI * 0.5, 'stone');
  }

  // Stone bench at (-115, 432, -554) looking out toward the Sister and Hero Maple
  kb.addBox(2.4, 0.55, 0.85, cx + 5.0, cy + 0.28, cz + 6.0, 'stone');

  const merged = mergePlaceSpatialChunks(kb.parts, cx, cz, 'overlook', 1);
  root.add(merged.group);

  // 2. Concentric engraved rings inlaid in the stone disc + glowing ember core
  const breathGlowUniform = { value: 0.25 };
  const inlayGeo = new THREE.CircleGeometry(12.5, 36);
  inlayGeo.rotateX(-Math.PI * 0.5);
  const inlayMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uBreathGlow: breathGlowUniform,
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
      uniform float uBreathGlow;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;

        // Concentric engraved realm rings + central ember core
        float ring1 = smoothstep(0.018, 0.0, abs(r - 0.24));
        float ring2 = smoothstep(0.015, 0.0, abs(r - 0.48));
        float ring3 = smoothstep(0.015, 0.0, abs(r - 0.72));
        float ring4 = smoothstep(0.018, 0.0, abs(r - 0.94));
        float rings = max(max(ring1, ring2), max(ring3, ring4));
        float core = smoothstep(0.11, 0.0, r);

        float pulse = 0.75 + 0.25 * sin(uTime * 1.8);
        vec3 inkCol = vec3(0.12, 0.10, 0.09);
        vec3 emberCol = vec3(0.984, 0.337, 0.027) * (1.2 + uBreathGlow * 1.6) * pulse;

        vec3 col = mix(inkCol, emberCol, clamp(core + rings * uBreathGlow, 0.0, 1.0));
        float alpha = clamp(rings * 0.85 + core * 0.95, 0.0, 1.0);
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const inlayMesh = new THREE.Mesh(inlayGeo, inlayMat);
  inlayMesh.position.set(cx, cy + 0.03, cz);
  root.add(inlayMesh);

  // 3. Spirit Root plants at (-112, 432, -566) among the Hero Maple's roots
  const [rx, ry, rz] = LANDMARKS.rootSpot; // [-112, 432, -566]
  const rootGroup = new THREE.Group();
  rootGroup.position.set(rx, ry, rz);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tendril = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.11, 0.75, 6),
      i % 2 === 0 ? mats.bone : mats.emberCore
    );
    tendril.position.set(Math.cos(a) * 0.45, 0.32, Math.sin(a) * 0.45);
    tendril.rotation.z = (i - 2) * 0.22;
    rootGroup.add(tendril);
  }
  root.add(rootGroup);
  ctx.lamps.add({
    id: 'spirit-root-pulse',
    position: [rx, ry + 0.5, rz],
    size: 0.95,
    state: 'ember',
    hasGroundPool: true,
  });

  // 4. The Ascent Column (`ascentColumn`): thin elegant column of rising mist & pale light
  const ascentStrengthUniform = { value: 0.45 };
  const colGeo = new THREE.CylinderGeometry(1.6, 2.4, 520, 16, 1, true);
  const colMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uStrength: ascentStrengthUniform,
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
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float wisp = sin(vUv.y * 28.0 - uTime * 1.4 + vUv.x * 6.2831) * 0.5 + 0.5;
        float fadeY = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.2, vUv.y);
        float alpha = fadeY * (0.12 + 0.16 * wisp) * uStrength;
        vec3 paleGold = vec3(0.96, 0.89, 0.76);
        gl_FragColor = vec4(paleGold, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const ascentMesh = new THREE.Mesh(colGeo, colMat);
  ascentMesh.position.set(cx, cy + 260, cz);
  root.add(ascentMesh);

  // Register Overlook interactables: Spirit Root & Overlook Bench
  ctx.interactables.register({
    id: 'spirit-root',
    kind: 'gather',
    position: new THREE.Vector3(rx, ry + 0.6, rz),
    radius: 3.8,
    prompt: 'Gather Spirit Root',
    enabled: () => true,
    onUse: () => {
      ctx.onNotice?.('Pale ivory roots warm your palm with a slow, steady ember pulse.');
    },
  });

  ctx.interactables.register({
    id: 'overlook-bench',
    kind: 'seat',
    position: new THREE.Vector3(cx + 5.0, cy + 0.6, cz + 6.0),
    radius: 3.6,
    prompt: 'Sit and Look Out Over the Cloud Sea',
    enabled: () => true,
    onUse: () => {
      ctx.onSitBench?.();
      ctx.onNotice?.('Below the cliff edge, the sea of cloud drifts beneath the pale Sister.');
    },
  });

  return {
    group: root,
    stats: {
      chunkCount: merged.stats.chunkCount,
      drawCalls: merged.stats.drawCalls + 3,
      triangles: merged.stats.triangles + 140,
    },
    setBreathGlow(intensity01: number) {
      breathGlowUniform.value = THREE.MathUtils.clamp(intensity01, 0.15, 1.5);
    },
    update() {
      const realm = ctx.getPlayerRealm();
      ascentStrengthUniform.value = realm >= 4 ? 1.0 : 0.42;
    },
    dispose() {
      ctx.interactables.unregister('spirit-root');
      ctx.interactables.unregister('overlook-bench');
      inlayGeo.dispose();
      inlayMat.dispose();
      colGeo.dispose();
      colMat.dispose();
    },
  };
}
