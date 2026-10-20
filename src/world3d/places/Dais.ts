import * as THREE from 'three';
import { KitBuilder } from '../arch/Kit.ts';
import { mergePlaceSpatialChunks, type MergeStats } from '../arch/Merge.ts';
import type { ModelOverrides } from '../arch/Overrides.ts';
import { U } from '../uniforms.ts';

export interface BuiltDaisNear {
  group: THREE.Group;
  stats: MergeStats;
  dispose(): void;
}

/**
 * Builds the distant silhouette of The Dais (`buildFar()`) at (-110, 5198, -620).
 */
export function buildDaisFar(): THREE.Group {
  const kb = new KitBuilder();
  kb.addCylinder(12, 10.5, 1.8, 16, -110, 5198 - 0.9, -620, 'bone');
  return mergePlaceSpatialChunks(kb.parts, -110, -620, 'dais-far', 1).group;
}

/**
 * Builds The Dais (`Dais.ts` — Prompt 5 Section 7) at (-110, 5198, -620):
 * - Pale stone disc 24 m across (radius 12 m) hanging in open space
 * - Inlaid with concentric realm rings and an ember core
 * - Thin tether of pale light descending toward the Overlook
 */
export function buildDaisNear(overrides: ModelOverrides): BuiltDaisNear {
  const root = new THREE.Group();
  root.name = 'DaisNear';

  const cx = -110;
  const cy = 5198;
  const cz = -620;

  const kb = new KitBuilder();
  kb.addCylinder(12.0, 9.8, 1.8, 24, 0, -0.9, 0, 'bone');
  kb.addCylinder(12.4, 12.2, 0.35, 24, 0, -0.18, 0, 'stone');
  const merged = mergePlaceSpatialChunks(kb.parts, 0, 0, 'dais', 1);

  const daisContainer = overrides.wrapWithOverride('dais', merged.group, [cx, cy, cz]);
  root.add(daisContainer);

  // Concentric inlaid rings on top of the Dais
  const ringGeo = new THREE.RingGeometry(2.2, 10.8, 32);
  ringGeo.rotateX(-Math.PI * 0.5);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
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
        float w = sin(r * 28.0) * 0.5 + 0.5;
        float line = smoothstep(0.88, 0.98, w);
        vec3 col = mix(vec3(0.18, 0.15, 0.14), vec3(0.984, 0.337, 0.027), line * 0.65);
        gl_FragColor = vec4(col, line * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.set(cx, cy + 0.03, cz);
  root.add(ringMesh);

  // Thin tether of pale light descending toward the Overlook
  const tetherGeo = new THREE.CylinderGeometry(0.35, 0.85, 1800, 10, 1, true);
  const tetherMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d2,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tetherMesh = new THREE.Mesh(tetherGeo, tetherMat);
  tetherMesh.position.set(cx, cy - 900, cz);
  root.add(tetherMesh);

  return {
    group: root,
    stats: {
      chunkCount: 1,
      drawCalls: merged.stats.drawCalls + 2,
      triangles: merged.stats.triangles + 96,
    },
    dispose() {
      ringGeo.dispose();
      ringMat.dispose();
      tetherGeo.dispose();
      tetherMat.dispose();
    },
  };
}
