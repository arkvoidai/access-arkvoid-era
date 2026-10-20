import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import { heightAt } from '../../world/terrainFn.ts';
import { QUALITY, type QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';

const WATER_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWaterQuality;
uniform float uIsLake;
attribute float aShoreDist;
attribute vec2 aFlowDir;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vShoreDist;
varying vec2 vFlowUv;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);

  // Gentle vertex waves on the lake when waterQuality == 2
  if (uIsLake > 0.5 && uWaterQuality > 1.5) {
    float wave = sin(wp.x * 0.35 + uTime * 1.4) * cos(wp.z * 0.32 + uTime * 1.1) * 0.06;
    wp.y += wave * clamp(aShoreDist * 0.15, 0.0, 1.0);
  }

  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vShoreDist = aShoreDist;
  vFlowUv = uv;

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uWaterQuality;
uniform float uIsLake;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogBaseY;
uniform float uFogHeightFalloff;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vShoreDist;
varying vec2 vFlowUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

vec3 rippleNormal(vec2 p) {
  float eps = 0.15;
  float hL = noise2D(p - vec2(eps, 0.0));
  float hR = noise2D(p + vec2(eps, 0.0));
  float hD = noise2D(p - vec2(0.0, eps));
  float hU = noise2D(p + vec2(0.0, eps));
  return normalize(vec3((hL - hR) * 0.22, 1.0, (hD - hU) * 0.22));
}

void main() {
  vec3 viewVec = uCamPos - vWorldPos;
  float dist = length(viewVec);
  vec3 V = viewVec / max(0.001, dist);

  vec3 N = vec3(0.0, 1.0, 0.0);
  vec2 baseCoord = uIsLake > 0.5 ? vWorldPos.xz * 0.45 : vec2(vFlowUv.x * 3.5, vFlowUv.y * 18.0 - uTime * 2.4);

  if (uWaterQuality >= 0.5) {
    vec3 n1 = rippleNormal(baseCoord + vec2(uTime * 0.45, -uTime * 0.32));
    if (uWaterQuality >= 1.5) {
      vec3 n2 = rippleNormal(baseCoord * 1.9 - vec2(uTime * 0.62, uTime * 0.51));
      N = normalize(n1 + n2);
    } else {
      N = n1;
    }
  }

  // Deep warm olive (#5B5A42) mixed by Fresnel with warm sky reflection (never teal or blue)
  vec3 deepWarmOlive = vec3(0.357, 0.353, 0.259);
  vec3 R = reflect(-V, N);
  float reflElev = clamp(R.y, 0.0, 1.0);
  vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, pow(reflElev, 0.45));

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);

  float depthFactor = clamp(vShoreDist / 6.0, 0.0, 1.0);
  vec3 shallowTint = vec3(0.56, 0.51, 0.39);
  vec3 waterBody = mix(shallowTint, deepWarmOlive, depthFactor);

  vec3 col = mix(waterBody, skyRefl, clamp(fresnel * 0.88 + 0.14, 0.0, 0.96));

  // Sun glitter & soft white-ivory shore foam on quality 2
  if (uWaterQuality >= 1.5) {
    vec3 H = normalize(V + normalize(uSunDir));
    float spec = pow(max(0.0, dot(N, H)), 140.0) * 1.8;
    col += uSunColor * spec;

    float foamWave = noise2D(vWorldPos.xz * 1.2 + vec2(uTime * 0.8, -uTime * 0.6));
    float shoreFoam = (1.0 - smoothstep(0.15, 2.1, vShoreDist + foamWave * 0.45));
    // Stream rapid foam along edges
    float streamFoam = uIsLake < 0.5 ? smoothstep(0.32, 0.49, abs(vFlowUv.x - 0.5) + foamWave * 0.12) * 0.65 : 0.0;
    float foamMask = max(shoreFoam, streamFoam);
    vec3 ivoryFoam = vec3(0.95, 0.90, 0.81);
    col = mix(col, ivoryFoam, clamp(foamMask * 0.72, 0.0, 0.85));
  }

  // Height-aware Arkvoid fog
  float heightDelta = max(0.0, vWorldPos.y - uFogBaseY);
  float heightFactor = exp(-heightDelta * uFogHeightFalloff);
  float effectiveDensity = uFogDensity * (0.35 + 0.65 * heightFactor);
  float fogFactor = clamp(1.0 - exp(-effectiveDensity * dist * (1.0 + dist * 0.00045)), 0.0, 0.96);
  col = mix(col, uFogColor, fogFactor);

  float alpha = clamp(0.76 + depthFactor * 0.2, 0.75, 0.96);
  gl_FragColor = vec4(col, alpha);
}
`;

const WATERFALL_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATERFALL_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity;

varying vec2 vUv;
varying vec3 vWorldPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  // Fast downward streaking foam and warm sky water
  float streak1 = noise2D(vec2(vUv.x * 14.0, vUv.y * 4.5 + uTime * 3.8));
  float streak2 = noise2D(vec2(vUv.x * 28.0 + 3.1, vUv.y * 8.0 + uTime * 5.6));
  float foam = smoothstep(0.32, 0.82, streak1 * 0.65 + streak2 * 0.35);

  vec3 baseWater = mix(vec3(0.42, 0.40, 0.31), uSkyHorizon, 0.55);
  vec3 ivoryFoam = vec3(0.96, 0.91, 0.82);
  vec3 col = mix(baseWater, ivoryFoam, foam * 0.85);

  // Soften side edges and top/bottom transitions
  float edgeMask = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float topBotMask = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.9, vUv.y);

  float dist = length(uCamPos - vWorldPos);
  float fogF = clamp(1.0 - exp(-uFogDensity * dist), 0.0, 0.95);
  col = mix(col, uFogColor, fogF);

  gl_FragColor = vec4(col, edgeMask * topBotMask * 0.88);
}
`;

function buildStreamRibbonGeometry(
  points: ReadonlyArray<readonly [number, number, number]>,
  halfWidth: number,
  subdivisionsPerSeg = 8
): THREE.BufferGeometry {
  const spine: Array<{ x: number; y: number; z: number; v: number }> = [];
  let accumLen = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = i === points.length - 2 ? subdivisionsPerSeg + 1 : subdivisionsPerSeg;
    for (let s = 0; s < steps; s++) {
      const t = s / subdivisionsPerSeg;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      if (spine.length > 0) {
        const prev = spine[spine.length - 1];
        accumLen += Math.hypot(x - prev.x, z - prev.z);
      }
      spine.push({ x, y, z, v: accumLen * 0.1 });
    }
  }

  const n = spine.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const shoreDist = new Float32Array(n * 2);
  const indices = new Uint16Array((n - 1) * 6);

  for (let i = 0; i < n; i++) {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const rx = -tz / len;
    const rz = tx / len;

    const p = spine[i];
    const vL = i * 2;
    const vR = vL + 1;

    positions[vL * 3] = p.x - rx * halfWidth;
    positions[vL * 3 + 1] = p.y;
    positions[vL * 3 + 2] = p.z - rz * halfWidth;

    positions[vR * 3] = p.x + rx * halfWidth;
    positions[vR * 3 + 1] = p.y;
    positions[vR * 3 + 2] = p.z + rz * halfWidth;

    normals[vL * 3 + 1] = 1;
    normals[vR * 3 + 1] = 1;

    uvs[vL * 2] = 0;
    uvs[vL * 2 + 1] = p.v;
    uvs[vR * 2] = 1;
    uvs[vR * 2 + 1] = p.v;

    shoreDist[vL] = 0.25;
    shoreDist[vR] = 0.25;
  }

  let ptr = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[ptr++] = a;
    indices[ptr++] = c;
    indices[ptr++] = b;
    indices[ptr++] = b;
    indices[ptr++] = c;
    indices[ptr++] = d;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aShoreDist', new THREE.BufferAttribute(shoreDist, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

function buildLakeDiscGeometry(): THREE.BufferGeometry {
  const cx = LANDMARKS.valleyLake.center[0];
  const cz = LANDMARKS.valleyLake.center[1];
  const waterY = LANDMARKS.valleyLake.waterLevel;
  const radius = LANDMARKS.valleyLake.radius + 4;

  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 36, 36);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, waterY, cz);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const shoreDist = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const bedY = heightAt(wx, wz);
    const depth = Math.max(0, waterY - bedY);
    shoreDist[i] = depth * 1.35;
  }

  geo.setAttribute('aShoreDist', new THREE.BufferAttribute(shoreDist, 1));
  return geo;
}

/**
 * Builds and animates the Valley Lake, upper & lower Streams, and the 38 m Waterfall
 * with spray particle sheet and rising mist plume at `(30, 130)`.
 */
export class WorldWater {
  public readonly group = new THREE.Group();
  private readonly lakeMat: THREE.ShaderMaterial;
  private readonly streamMat: THREE.ShaderMaterial;
  private readonly waterfallMat: THREE.ShaderMaterial;
  private readonly sprayGroup: THREE.Group;
  private readonly sprayMeshes: THREE.Mesh[] = [];
  private readonly sprayMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(initialTier: QualityTier) {
    this.group.name = 'ArkvoidWater';
    const waterQuality = QUALITY[initialTier].waterQuality;

    const makeWaterMat = (isLake: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
        uniforms: {
          uTime: U.uTime,
          uWaterQuality: { value: waterQuality },
          uIsLake: { value: isLake ? 1.0 : 0.0 },
          uCamPos: U.uCamPos,
          uSunDir: U.uSunDir,
          uSunColor: U.uSunColor,
          uSkyZenith: U.uSkyZenith,
          uSkyHorizon: U.uSkyHorizon,
          uFogColor: U.uFogColor,
          uFogDensity: U.uFogDensity,
          uFogBaseY: U.uFogBaseY,
          uFogHeightFalloff: U.uFogHeightFalloff,
        },
        transparent: true,
        depthWrite: false,
      });

    this.lakeMat = makeWaterMat(true);
    this.streamMat = makeWaterMat(false);

    // 1. Valley Lake at (-330, 300), waterLevel = 58
    const lakeGeo = buildLakeDiscGeometry();
    this.geometries.push(lakeGeo);
    const lakeMesh = new THREE.Mesh(lakeGeo, this.lakeMat);
    this.group.add(lakeMesh);

    // 2. Upper Town Stream ribbon descending to waterfall ledge (30, 130)
    const upperStreamGeo = buildStreamRibbonGeometry(
      [
        [-30, 145.6, -140],
        [-12, 140.6, -40],
        [-12, 137.6, 20],
        [10, 133.6, 70],
        [30, 129.8, 130],
      ],
      1.75
    );
    this.geometries.push(upperStreamGeo);
    this.group.add(new THREE.Mesh(upperStreamGeo, this.streamMat));

    // 3. Lower Valley Stream ribbon from shelf (30, 92, 138) into Valley Lake (-330, 58, 300)
    const lowerStreamGeo = buildStreamRibbonGeometry(
      [
        [30, 91.8, 138],
        [-45, 81.8, 175],
        [-155, 67.8, 232],
        [-265, 59.8, 276],
        [-330, 58.0, 300],
      ],
      2.2
    );
    this.geometries.push(lowerStreamGeo);
    this.group.add(new THREE.Mesh(lowerStreamGeo, this.streamMat));

    // 4. Waterfall at (30, 130) dropping 38 m from y=130 to y=92
    this.waterfallMat = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_VERTEX,
      fragmentShader: WATERFALL_FRAGMENT,
      uniforms: {
        uTime: U.uTime,
        uSkyHorizon: U.uSkyHorizon,
        uFogColor: U.uFogColor,
        uCamPos: U.uCamPos,
        uFogDensity: U.uFogDensity,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const wfGeo = new THREE.PlaneGeometry(4.6, 38.5, 8, 16);
    this.geometries.push(wfGeo);
    const wfMesh = new THREE.Mesh(wfGeo, this.waterfallMat);
    wfMesh.position.set(30, 111.0, 134.0);
    wfMesh.rotation.x = 0.21;
    this.group.add(wfMesh);

    // 5. Waterfall base spray sheet & rising mist plume
    this.sprayGroup = new THREE.Group();
    this.sprayGroup.position.set(30, 92.5, 138.0);
    this.sprayMat = new THREE.MeshBasicMaterial({
      color: '#EFE6D5',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const puffGeo = new THREE.DodecahedronGeometry(2.6, 1);
    this.geometries.push(puffGeo);

    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(puffGeo, this.sprayMat);
      this.sprayMeshes.push(puff);
      this.sprayGroup.add(puff);
    }
    this.group.add(this.sprayGroup);
  }

  public setQualityTier(tier: QualityTier): void {
    const wq = QUALITY[tier].waterQuality;
    this.lakeMat.uniforms.uWaterQuality.value = wq;
    this.streamMat.uniforms.uWaterQuality.value = wq;
  }

  public update(realSeconds: number): void {
    // Animate waterfall base spray & rising mist plume
    for (let i = 0; i < this.sprayMeshes.length; i++) {
      const m = this.sprayMeshes[i];
      const phase = (realSeconds * 0.42 + i / this.sprayMeshes.length) % 1;
      const angle = i * 1.4;
      m.position.set(
        Math.cos(angle) * (1.2 + phase * 3.5),
        phase * 14.0,
        Math.sin(angle) * (1.2 + phase * 3.5)
      );
      const s = 0.8 + phase * 2.1;
      m.scale.set(s, s * 0.75, s);
    }
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.lakeMat.dispose();
    this.streamMat.dispose();
    this.waterfallMat.dispose();
    this.sprayMat.dispose();
  }
}
