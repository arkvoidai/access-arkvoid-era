import * as THREE from 'three';
import { WORLD } from '../../world/bible.ts';
import { seededUnit, WORLD_SEED } from '../../world/noise.ts';
import {
  heightAt,
  pathInfluenceAt,
  regionAt,
  slopeAt,
  waterLevelAt,
} from '../../world/terrainFn.ts';
import { isHeadlessBrowser, QUALITY, type QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';

const GRASS_VERTEX = /* glsl */ `
attribute vec4 aInstancePose; // xyz = blade base world pos, w = yaw & scale packed
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform sampler2D uWear;
uniform vec4 uWorldBounds;
uniform vec3 uCamPos;
uniform float uGrassRadius;
uniform vec3 uActors[9]; // uActors[0] = player, uActors[1..8] = nearby NPCs

varying float vHeightFrac;
varying vec3 vWorldPos;
varying float vMacroVar;

void main() {
  vec3 basePos = aInstancePose.xyz;
  float distToCam = length(basePos.xz - uCamPos.xz);
  float distScale = 1.0 - smoothstep(uGrassRadius * 0.78, uGrassRadius, distToCam);

  float rawW = aInstancePose.w;
  float rotY = fract(rawW) * 6.2831853;
  float bladeScale = (floor(rawW) * 0.08 + 0.65) * distScale;

  // Sample footpath wear map: bends and shortens blades where people walk
  vec2 worldUv = (basePos.xz - uWorldBounds.xy) / uWorldBounds.zw;
  float wear = 0.0;
  if (worldUv.x >= 0.0 && worldUv.x <= 1.0 && worldUv.y >= 0.0 && worldUv.y <= 1.0) {
    wear = texture2D(uWear, worldUv).r;
  }

  vHeightFrac = clamp(position.y / 0.58, 0.0, 1.0);
  vMacroVar = sin(basePos.x * 0.04 + basePos.z * 0.03) * 0.5 + 0.5;

  float c = cos(rotY);
  float s = sin(rotY);
  vec3 localPos = position * bladeScale * (1.0 - wear * 0.72);
  vec3 rotated = vec3(localPos.x * c - localPos.z * s, localPos.y, localPos.x * s + localPos.z * c);

  // Wind waves + fast tip flutter
  float windPhase = dot(basePos.xz, uWindDir) * 0.16 - uTime * (2.2 + uWindStrength * 1.8);
  float slowWave = sin(windPhase) * 0.24 * uWindStrength;
  float fastFlutter = sin(uTime * 7.5 + basePos.x * 1.7 + basePos.z * 1.3) * 0.045 * uWindStrength;
  float bend = (slowWave + fastFlutter) * vHeightFrac * vHeightFrac;

  rotated.x += uWindDir.x * bend;
  rotated.z += uWindDir.y * bend;

  // Wear map flattens blade toward ground
  rotated.y *= (1.0 - wear * 0.68);
  rotated.x += wear * 0.18 * vHeightFrac;

  // Actor push-aside (player + up to 8 nearby characters)
  for (int i = 0; i < 9; i++) {
    vec2 diff = basePos.xz - uActors[i].xz;
    float dSq = dot(diff, diff);
    if (dSq < 1.96 && dSq > 0.0001) {
      float d = sqrt(dSq);
      float push = (1.0 - d / 1.4) * vHeightFrac * 0.48;
      vec2 pushDir = diff / d;
      rotated.x += pushDir.x * push;
      rotated.z += pushDir.y * push;
      rotated.y *= (1.0 - push * 0.45);
    }
  }

  vec3 wp = basePos + rotated;
  vWorldPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const GRASS_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uNightWeight;

varying float vHeightFrac;
varying vec3 vWorldPos;
varying float vMacroVar;

void main() {
  // Base #6F6B40 to tip #B3A872 with macro variation
  vec3 colBase = vec3(0.435, 0.420, 0.251);
  vec3 colTip  = mix(vec3(0.702, 0.659, 0.447), vec3(0.76, 0.71, 0.50), vMacroVar);
  vec3 albedo = mix(colBase, colTip, vHeightFrac);

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uSunDir);

  // Diffuse + warm gold back-lighting when the sun is behind the grass blade
  float sunUp = clamp(L.y * 1.4 + 0.35, 0.08, 1.0) * (1.0 - uNightWeight * 0.78);
  float backLight = pow(max(0.0, dot(-V, L)), 3.0) * vHeightFrac * 0.85;

  vec3 lit = albedo * (0.45 + 0.65 * sunUp) + uSunColor * backLight * 0.58;

  float dist = length(uCamPos - vWorldPos);
  float fogF = clamp(1.0 - exp(-uFogDensity * dist), 0.0, 0.95);
  lit = mix(lit, uFogColor, fogF);

  gl_FragColor = vec4(lit, 1.0);
}
`;

/**
 * Builds a single 5-vertex tapered grass blade (3 triangles).
 */
function buildFiveVertexBladeGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.045, 0.0, 0.0,
     0.045, 0.0, 0.0,
    -0.030, 0.28, 0.0,
     0.030, 0.28, 0.0,
     0.000, 0.58, 0.0,
  ]);
  const indices = new Uint16Array([
    0, 1, 2,
    1, 3, 2,
    2, 3, 4,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/**
 * GPU Wind Grass (`GrassField`):
 * - 5-vertex instanced blades placed on `heightAt(x, z)` out to `grassRadius` around the player.
 * - Budget: 150,000 blades on `high`, 60,000 on `mid`, 0 on `low`.
 * - Colour gradient `#6F6B40` -> `#B3A872`, warm sun back-light, wind waves + flutter,
 *   bent flat by the footpath wear map (`uWear`), and pushed aside by the player + up to 8 NPCs.
 */
export class GrassField {
  public readonly mesh: THREE.Mesh;
  private readonly instGeo: THREE.InstancedBufferGeometry;
  private readonly poseAttr: THREE.InstancedBufferAttribute;
  private readonly poseData: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private readonly actorUniforms: THREE.Vector3[];

  private tier: QualityTier;
  private readonly isHeadless: boolean;
  private lastAnchorX = Number.NaN;
  private lastAnchorZ = Number.NaN;

  constructor(initialTier: QualityTier) {
    this.tier = initialTier;
    this.isHeadless = isHeadlessBrowser();

    const maxBlades = this.isHeadless ? 4000 : 150000;
    this.poseData = new Float32Array(maxBlades * 4);

    const baseBlade = buildFiveVertexBladeGeometry();
    this.instGeo = new THREE.InstancedBufferGeometry();
    this.instGeo.index = baseBlade.index;
    this.instGeo.attributes.position = baseBlade.attributes.position;

    this.poseAttr = new THREE.InstancedBufferAttribute(this.poseData, 4);
    this.poseAttr.setUsage(THREE.DynamicDrawUsage);
    this.instGeo.setAttribute('aInstancePose', this.poseAttr);

    this.actorUniforms = Array.from({ length: 9 }, () => new THREE.Vector3(0, -9999, 0));

    this.material = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX,
      fragmentShader: GRASS_FRAGMENT,
      uniforms: {
        uTime: U.uTime,
        uWindDir: U.uWindDir,
        uWindStrength: U.uWindStrength,
        uWear: U.uWear,
        uWorldBounds: {
          value: new THREE.Vector4(
            WORLD.minX,
            WORLD.minZ,
            WORLD.maxX - WORLD.minX,
            WORLD.maxZ - WORLD.minZ
          ),
        },
        uCamPos: U.uCamPos,
        uGrassRadius: { value: QUALITY[initialTier].grassRadius || 45 },
        uActors: { value: this.actorUniforms },
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uSkyHorizon: U.uSkyHorizon,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uNightWeight: U.uNightWeight,
      },
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.instGeo, this.material);
    this.mesh.name = 'ArkvoidGrassField';
    this.mesh.frustumCulled = false;

    this.applyTier(initialTier);
  }

  private targetBladeBudget(tier: QualityTier): number {
    if (tier === 'low') return 0;
    if (this.isHeadless) return tier === 'high' ? 4000 : 2500;
    return tier === 'high' ? 150000 : 60000;
  }

  public setQualityTier(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.applyTier(tier);
  }

  private applyTier(tier: QualityTier): void {
    this.tier = tier;
    const cfg = QUALITY[tier];
    const budget = this.targetBladeBudget(tier);
    if (budget <= 0 || cfg.grassRadius <= 0) {
      this.mesh.visible = false;
      this.instGeo.instanceCount = 0;
      return;
    }
    this.mesh.visible = true;
    this.material.uniforms.uGrassRadius.value = cfg.grassRadius;
    this.lastAnchorX = Number.NaN;
  }

  public update(
    playerPos: THREE.Vector3,
    npcPositions: ReadonlyArray<THREE.Vector3>
  ): void {
    if (!this.mesh.visible) return;

    this.actorUniforms[0].copy(playerPos);
    for (let i = 0; i < 8; i++) {
      if (i < npcPositions.length) {
        this.actorUniforms[i + 1].copy(npcPositions[i]);
      } else {
        this.actorUniforms[i + 1].set(0, -9999, 0);
      }
    }

    // Recycle grass cells when the player walks > 12 m from the last cell anchor
    const snapX = Math.round(playerPos.x / 12) * 12;
    const snapZ = Math.round(playerPos.z / 12) * 12;
    if (snapX !== this.lastAnchorX || snapZ !== this.lastAnchorZ) {
      this.lastAnchorX = snapX;
      this.lastAnchorZ = snapZ;
      this.repopulateAround(snapX, snapZ);
    }
  }

  private repopulateAround(centerX: number, centerZ: number): void {
    const cfg = QUALITY[this.tier];
    const radius = cfg.grassRadius;
    const budget = this.targetBladeBudget(this.tier);
    if (budget <= 0 || radius <= 0) {
      this.instGeo.instanceCount = 0;
      return;
    }

    let placed = 0;
    const maxAttempts = Math.min(budget * 2, this.poseData.length / 2);

    for (let i = 0; i < maxAttempts && placed < budget; i++) {
      const r1 = seededUnit(i * 3 + 1, WORLD_SEED + 555);
      const r2 = seededUnit(i * 3 + 2, WORLD_SEED + 555);
      const r3 = seededUnit(i * 3 + 3, WORLD_SEED + 555);

      const dist = Math.sqrt(r1) * radius;
      const angle = r2 * Math.PI * 2;
      const wx = Math.round((centerX + Math.cos(angle) * dist) * 2) * 0.5;
      const wz = Math.round((centerZ + Math.sin(angle) * dist) * 2) * 0.5;

      // Skip paths, town stone courtyard, cliffs, water, and the Ashen basin
      if (Math.hypot(wx - 32, wz) < 34) continue;
      if (pathInfluenceAt(wx, wz).dist < 2.2) continue;
      if (regionAt(wx, wz) === 'ashen') continue;
      const wl = waterLevelAt(wx, wz);
      const wy = heightAt(wx, wz);
      if (wl !== null && wy <= wl + 0.25) continue;
      if ((slopeAt(wx, wz) * 180) / Math.PI > 33) continue;

      const p4 = placed * 4;
      this.poseData[p4] = wx;
      this.poseData[p4 + 1] = wy;
      this.poseData[p4 + 2] = wz;
      this.poseData[p4 + 3] = Math.floor(r3 * 6) + (r2 % 0.999);
      placed++;
    }

    this.instGeo.instanceCount = placed;
    this.poseAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.instGeo.dispose();
    this.material.dispose();
  }
}
