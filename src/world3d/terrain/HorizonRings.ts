import * as THREE from 'three';
import { ridgedFbm2D, valueNoise2D, WORLD_SEED } from '../../world/noise.ts';
import { U } from '../uniforms.ts';

const HORIZON_RING_VERTEX = /* glsl */ `
attribute float aHeightNorm;
varying float vHeightNorm;
varying vec3 vWorldPos;

void main() {
  vHeightNorm = aHeightNorm;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const HORIZON_RING_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uInkWeight;
uniform float uAltitude01;
uniform float uNightWeight;
uniform vec3 uFogColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCamPos;

varying float vHeightNorm;
varying vec3 vWorldPos;

void main() {
  // Warm ink silhouette colour (#231C18 during day/dusk, deeper warm ink at night)
  vec3 warmInk = mix(vec3(0.175, 0.138, 0.115), vec3(0.055, 0.045, 0.038), uNightWeight);

  // Directional sun brightening along the sunward horizon at dawn/dusk
  vec3 viewDir = normalize(vWorldPos - uCamPos);
  float sunAlign = pow(max(0.0, dot(normalize(vec3(viewDir.x, 0.0, viewDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z)))), 3.0);
  vec3 horizonFog = mix(uFogColor, mix(uSkyHorizon, uSunColor, 0.35), sunAlign * 0.42);

  // Flat ink-wash base: colour = mix(horizonFog, warmInk, k) where k = 0.45, 0.28, 0.14
  vec3 col = mix(horizonFog, warmInk, uInkWeight);

  // Soft horizontal mist lines banded by altitude
  float mistBand = 0.5 + 0.5 * sin(vWorldPos.y * 0.018 + vWorldPos.x * 0.0005);
  float baseMist = 1.0 - smoothstep(0.0, 0.38, vHeightNorm);
  col = mix(col, horizonFog, (baseMist * 0.72 + mistBand * 0.14 * (1.0 - vHeightNorm)));

  // Soften ridge crest slightly into atmospheric haze and fade as uAltitude01 -> 1
  float spaceFade = 1.0 - smoothstep(0.35, 0.95, uAltitude01);
  float ridgeEdgeAlpha = smoothstep(1.0, 0.88, vHeightNorm) * spaceFade;

  gl_FragColor = vec4(col, ridgeEdgeAlpha);
}
`;

interface RingSpec {
  radius: number;
  inkWeight: number;
  minHeight: number;
  maxHeight: number;
  jaggedness: number;
  seedOffset: number;
}

const RING_SPECS: readonly RingSpec[] = [
  {
    radius: 6000,
    inkWeight: 0.45,
    minHeight: 480,
    maxHeight: 1550,
    jaggedness: 1.0,
    seedOffset: 11,
  },
  {
    radius: 11000,
    inkWeight: 0.28,
    minHeight: 540,
    maxHeight: 1420,
    jaggedness: 0.68,
    seedOffset: 29,
  },
  {
    radius: 18000,
    inkWeight: 0.14,
    minHeight: 600,
    maxHeight: 1320,
    jaggedness: 0.42,
    seedOffset: 53,
  },
];

/**
 * Layered Ink-Wash Mountain Silhouette Rings (`HorizonRings`):
 * - Three ring meshes at radius 6 km (`k = 0.45`), 11 km (`k = 0.28`), and 18 km (`k = 0.14`).
 * - Always centred on the camera in X and Z so they sit infinitely far on the horizon.
 * - Rendered in the background pass after `SkyPass` and before the main scene using a second camera copy
 *   with `near = 200` and `far = 80000`, with depth cleared before the main scene.
 */
export class HorizonRings {
  public readonly scene = new THREE.Scene();
  public readonly bgCamera = new THREE.PerspectiveCamera(58, 1.6, 200, 80000);
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor() {
    const sisterAngle = Math.atan2(-20800, 14300);

    // Render furthest ring first (18 km -> 11 km -> 6 km)
    for (let rIdx = RING_SPECS.length - 1; rIdx >= 0; rIdx--) {
      const spec = RING_SPECS[rIdx];
      const segments = 180;
      const vertCount = (segments + 1) * 2;
      const positions = new Float32Array(vertCount * 3);
      const heightNorms = new Float32Array(vertCount);
      const indices = new Uint16Array(segments * 6);

      for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const angle = u * Math.PI * 2;
        const cx = Math.cos(angle);
        const cz = Math.sin(angle);

        const rNoise = ridgedFbm2D(
          cx * (2.6 + spec.jaggedness * 1.8),
          cz * (2.6 + spec.jaggedness * 1.8),
          4,
          WORLD_SEED + spec.seedOffset
        );
        const vNoise =
          valueNoise2D(cx * 5.2, cz * 5.2, WORLD_SEED + spec.seedOffset + 7) * 0.5 + 0.5;

        // Keep a lower dramatic saddle under the Sister planet in NNE so its lower hemisphere and ring shine cleanly
        const diffSister = Math.abs(
          Math.atan2(Math.sin(angle - sisterAngle), Math.cos(angle - sisterAngle))
        );
        const vistaDip = diffSister < 0.42 ? 0.38 + 0.62 * (diffSister / 0.42) : 1.0;

        const hFrac = Math.min(1, Math.max(0.08, (rNoise * 0.78 + vNoise * 0.22) * vistaDip));
        const crestY = spec.minHeight + (spec.maxHeight - spec.minHeight) * hFrac;
        const baseY = -60;

        const vBot = i * 2;
        const vTop = vBot + 1;

        positions[vBot * 3] = cx * spec.radius;
        positions[vBot * 3 + 1] = baseY;
        positions[vBot * 3 + 2] = cz * spec.radius;
        heightNorms[vBot] = 0;

        positions[vTop * 3] = cx * spec.radius;
        positions[vTop * 3 + 1] = crestY;
        positions[vTop * 3 + 2] = cz * spec.radius;
        heightNorms[vTop] = 1;
      }

      let ptr = 0;
      for (let i = 0; i < segments; i++) {
        const b0 = i * 2;
        const t0 = b0 + 1;
        const b1 = (i + 1) * 2;
        const t1 = b1 + 1;

        indices[ptr++] = b0;
        indices[ptr++] = t0;
        indices[ptr++] = b1;
        indices[ptr++] = t0;
        indices[ptr++] = t1;
        indices[ptr++] = b1;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aHeightNorm', new THREE.BufferAttribute(heightNorms, 1));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader: HORIZON_RING_VERTEX,
        fragmentShader: HORIZON_RING_FRAGMENT,
        uniforms: {
          uInkWeight: { value: spec.inkWeight },
          uAltitude01: U.uAltitude01,
          uNightWeight: U.uNightWeight,
          uFogColor: U.uFogColor,
          uSkyHorizon: U.uSkyHorizon,
          uSunColor: U.uSunColor,
          uSunDir: U.uSunDir,
          uCamPos: U.uCamPos,
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10 - rIdx;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(mat);
    }
  }

  /**
   * Renders the three layered ink-wash horizon rings after `SkyPass` using a camera copy
   * with `near = 200` and `far = 80000`, centred on `worldCamera` in X and Z.
   */
  public render(
    renderer: THREE.WebGLRenderer,
    worldCamera: THREE.PerspectiveCamera,
    target: THREE.WebGLRenderTarget | null = null
  ): void {
    worldCamera.updateMatrixWorld();
    this.bgCamera.fov = worldCamera.fov;
    this.bgCamera.aspect = worldCamera.aspect;
    this.bgCamera.near = 200;
    this.bgCamera.far = 80000;
    this.bgCamera.updateProjectionMatrix();

    this.bgCamera.position.copy(worldCamera.position);
    this.bgCamera.quaternion.copy(worldCamera.quaternion);
    this.bgCamera.up.copy(worldCamera.up);
    this.bgCamera.updateMatrixWorld();

    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].position.set(worldCamera.position.x, 0, worldCamera.position.z);
    }

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.render(this.scene, this.bgCamera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}
