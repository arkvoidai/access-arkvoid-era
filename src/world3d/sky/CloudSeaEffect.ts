import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';
import { CLOUD_SEA } from '../../world/bible.ts';
import { QUALITY, type QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';
import { generateCloudVolumeBytes } from './CloudNoise.worker.ts';

const CLOUD_SEA_EFFECT_FRAGMENT = /* glsl */ `
uniform sampler3D uCloudVolume;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uFrameJitter;
uniform float uCloudY0;
uniform float uCloudY1;
uniform int uCloudSteps;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uNightWeight;

float ign(vec2 pixelCoord) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(pixelCoord, magic.xy)));
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.05, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

float sampleCloudDensity(vec3 worldPos, vec3 windOffset) {
  float hFrac = clamp((worldPos.y - uCloudY0) / max(1.0, uCloudY1 - uCloudY0), 0.0, 1.0);
  // Vertical profile: rounded bottoms, flatter anvil tops
  float profile = smoothstep(0.0, 0.22, hFrac) * smoothstep(1.0, 0.72, hFrac);
  if (profile <= 0.001) return 0.0;

  vec3 uvwBase = (worldPos + windOffset) * vec3(0.00125, 0.0042, 0.00125);
  float baseNoise = texture(uCloudVolume, uvwBase).r;

  // Coverage ~ 0.55 so there are generous gaps for the sun and the Sister planet
  float coverage = 0.55;
  float d = smoothstep(1.0 - coverage, 0.94, baseNoise) * profile;
  if (d <= 0.001) return 0.0;

  // Second higher-frequency lookup near edges for natural billow erosion
  vec3 uvwDetail = (worldPos - windOffset * 0.45) * vec3(0.0048, 0.011, 0.0048);
  float detailNoise = texture(uCloudVolume, uvwDetail).r;
  float edgeFactor = clamp(1.0 - d, 0.0, 1.0);
  d = max(0.0, d - detailNoise * 0.34 * edgeFactor);

  return d * 0.058;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uCloudSteps <= 0) {
    outputColor = inputColor;
    return;
  }

  // Reconstruct world-space ray from UV and camera matrices
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 viewFar = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 viewRay = normalize(viewFar.xyz / max(0.0001, viewFar.w));
  vec3 rd = normalize((uCamWorld * vec4(viewRay, 0.0)).xyz);
  vec3 ro = uCamPos;

  // Compute scene geometry distance from depth buffer (depth == 1.0 means background sky)
  float maxGeometryT = 9000.0;
  if (depth < 0.99995) {
    vec4 clipPos = vec4(ndc, depth * 2.0 - 1.0, 1.0);
    vec4 viewPos = uInvProj * clipPos;
    viewPos.xyz /= max(0.00001, viewPos.w);
    maxGeometryT = length(viewPos.xyz);
  }

  // Analytic ray-slab intersection with planes y = uCloudY0 and y = uCloudY1
  float tEnter = 0.0;
  float tExit = 0.0;

  if (abs(rd.y) < 0.0002) {
    if (ro.y < uCloudY0 || ro.y > uCloudY1) {
      outputColor = inputColor;
      return;
    }
    tEnter = 0.0;
    tExit = 9000.0;
  } else {
    float t0 = (uCloudY0 - ro.y) / rd.y;
    float t1 = (uCloudY1 - ro.y) / rd.y;
    tEnter = max(0.0, min(t0, t1));
    tExit = min(9000.0, max(t0, t1));
  }

  // Clip ray to solid scene geometry and max distance
  tExit = min(tExit, maxGeometryT);

  if (tExit <= tEnter + 0.1) {
    outputColor = inputColor;
    return;
  }

  int steps = clamp(uCloudSteps, 8, 48);
  float raySpan = min(tExit - tEnter, 2600.0);
  float baseStep = raySpan / float(steps);

  vec2 fragCoord = uv * vec2(1280.0, 720.0) + vec2(uFrameJitter * 73.1, uFrameJitter * 39.7);
  float jitter = ign(fragCoord);

  vec3 windOffset = vec3(uWindDir.x, 0.0, uWindDir.y) * (uTime * (8.0 + uWindStrength * 9.0));
  vec3 sunDir = normalize(uSunDir);
  float cosAngle = dot(rd, sunDir);
  // Forward-scattering Henyey-Greenstein phase (g ~ 0.6) + gentle back-scatter lobe
  float phase = mix(hgPhase(cosAngle, 0.6), hgPhase(cosAngle, -0.2), 0.28);

  // Ambient colours: sky colour from above, warm brown-grey (#7A6A5E) from below (never blue)
  vec3 ambTop = mix(uSkyHorizon, uSkyZenith, 0.45);
  vec3 ambBottom = mix(vec3(0.478, 0.416, 0.369), vec3(0.14, 0.11, 0.09), uNightWeight);

  float transmittance = 1.0;
  vec3 scatteredLight = vec3(0.0);
  float weightedDist = 0.0;
  float weightSum = 0.0;

  float t = tEnter + jitter * baseStep;

  for (int i = 0; i < 48; i++) {
    if (i >= steps || t >= tExit || transmittance < 0.02) break;

    // Larger steps with distance
    float stepLen = baseStep * (1.0 + (t - tEnter) * 0.00035);
    vec3 p = ro + rd * t;

    float d = sampleCloudDensity(p, windOffset);
    if (d > 0.0005) {
      float hFrac = clamp((p.y - uCloudY0) / max(1.0, uCloudY1 - uCloudY0), 0.0, 1.0);

      // 3 short light samples toward the sun
      float sunOpticalDepth = 0.0;
      sunOpticalDepth += sampleCloudDensity(p + sunDir * 10.0, windOffset) * 10.0;
      sunOpticalDepth += sampleCloudDensity(p + sunDir * 24.0, windOffset) * 14.0;
      sunOpticalDepth += sampleCloudDensity(p + sunDir * 48.0, windOffset) * 24.0;

      float lightTrans = exp(-sunOpticalDepth * 1.45);
      // "Powder" sugar darkening at thin sunlit edges
      float powder = 1.0 - exp(-d * stepLen * 2.6);
      float powderBoost = mix(1.0, powder * 1.75, 0.55);

      // Sunlit cloud tops are warm ivory/ember; undersides are warm ink-grey
      vec3 directCol = mix(uSunColor, vec3(0.98, 0.94, 0.86), 0.35) * lightTrans * phase * powderBoost * 2.4;
      vec3 ambientCol = mix(ambBottom, ambTop, hFrac) * (0.58 + 0.42 * hFrac);

      vec3 sampleLum = directCol + ambientCol;
      float stepTrans = exp(-d * stepLen);
      float integ = (1.0 - stepTrans);

      scatteredLight += transmittance * sampleLum * integ;
      weightedDist += t * transmittance * integ;
      weightSum += transmittance * integ;
      transmittance *= stepTrans;
    }

    t += stepLen;
  }

  float cloudAlpha = 1.0 - transmittance;
  if (cloudAlpha <= 0.001) {
    outputColor = inputColor;
    return;
  }

  float avgDist = weightSum > 0.0001 ? (weightedDist / weightSum) : tEnter;
  // Distance fade into the fog colour so the far cloud sea melts into the horizon
  float horizonMelt = smoothstep(1400.0, 7200.0, avgDist);
  vec3 finalCloudLum = mix(scatteredLight, uFogColor * cloudAlpha, horizonMelt);

  vec3 composite = inputColor.rgb * transmittance + finalCloudLum;
  outputColor = vec4(composite, inputColor.a);
}
`;

/**
 * Volumetric Cloud Sea post-processing effect (`CLOUD_SEA.y0` = 250 m to `CLOUD_SEA.y1` = 335 m).
 */
export class CloudSeaEffect extends Effect {
  private readonly camera: THREE.PerspectiveCamera;
  private cloudTexture3D: THREE.Data3DTexture;
  private worker: Worker | null = null;
  private frameCounter = 0;

  constructor(camera: THREE.PerspectiveCamera, initialTier: QualityTier) {
    // Instant 16^3 seed volume on frame 0 while the Web Worker builds the full 96^3 volume
    const seedSize = 16;
    const seedBytes = generateCloudVolumeBytes(seedSize);
    const initialTex = CloudSeaEffect.make3DTexture(seedBytes, seedSize);

    super('CloudSeaEffect', CLOUD_SEA_EFFECT_FRAGMENT, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform<unknown>>([
        ['uCloudVolume', new THREE.Uniform(initialTex)],
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uTime', new THREE.Uniform(0)],
        ['uFrameJitter', new THREE.Uniform(0)],
        ['uCloudY0', new THREE.Uniform(CLOUD_SEA.y0)],
        ['uCloudY1', new THREE.Uniform(CLOUD_SEA.y1)],
        ['uCloudSteps', new THREE.Uniform(QUALITY[initialTier].cloudSteps)],
        ['uWindDir', new THREE.Uniform(new THREE.Vector2(0.9, 0.4))],
        ['uWindStrength', new THREE.Uniform(0.5)],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uSunColor', new THREE.Uniform(new THREE.Color('#FF9552'))],
        ['uSkyZenith', new THREE.Uniform(new THREE.Color('#8A7A73'))],
        ['uSkyHorizon', new THREE.Uniform(new THREE.Color('#F29A62'))],
        ['uFogColor', new THREE.Uniform(new THREE.Color('#E0AA84'))],
        ['uNightWeight', new THREE.Uniform(0)],
      ]),
    });

    this.camera = camera;
    this.cloudTexture3D = initialTex;
    this.spawnNoiseWorker();
  }

  private static make3DTexture(bytes: Uint8Array, size: number): THREE.Data3DTexture {
    const tex = new THREE.Data3DTexture(
      bytes as Uint8Array<ArrayBuffer>,
      size,
      size,
      size
    );
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }

  private spawnNoiseWorker(): void {
    if (typeof Worker === 'undefined') return;
    const isHeadless =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));
    if (isHeadless) return;

    try {
      this.worker = new Worker(new URL('./CloudNoise.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<{ size: number; buffer: ArrayBuffer }>) => {
        const { size, buffer } = e.data;
        const bytes = new Uint8Array(buffer);
        const hiTex = CloudSeaEffect.make3DTexture(bytes, size);
        const oldTex = this.cloudTexture3D;
        this.cloudTexture3D = hiTex;
        const uVol = this.uniforms.get('uCloudVolume');
        if (uVol) uVol.value = hiTex;
        oldTex.dispose();
        this.worker?.terminate();
        this.worker = null;
      };
      this.worker.postMessage({ size: 96 });
    } catch {
      // Keep 16^3 seed volume if Worker instantiation is blocked
    }
  }

  public setTier(tier: QualityTier): void {
    const uSteps = this.uniforms.get('uCloudSteps');
    if (uSteps) {
      uSteps.value = QUALITY[tier].cloudSteps;
    }
  }

  public override update(
    _renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget,
    _deltaTime?: number
  ): void {
    this.camera.updateMatrixWorld();
    this.frameCounter = (this.frameCounter + 1) % 64;

    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(
      this.camera.projectionMatrixInverse
    );
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (this.uniforms.get('uCamPos')!.value as THREE.Vector3).copy(U.uCamPos.value);
    this.uniforms.get('uTime')!.value = U.uTime.value;
    this.uniforms.get('uFrameJitter')!.value = (this.frameCounter * 0.61803398875) % 1.0;
    (this.uniforms.get('uWindDir')!.value as THREE.Vector2).copy(U.uWindDir.value);
    this.uniforms.get('uWindStrength')!.value = U.uWindStrength.value;
    (this.uniforms.get('uSunDir')!.value as THREE.Vector3).copy(U.uSunDir.value);
    (this.uniforms.get('uSunColor')!.value as THREE.Color).copy(U.uSunColor.value);
    (this.uniforms.get('uSkyZenith')!.value as THREE.Color).copy(U.uSkyZenith.value);
    (this.uniforms.get('uSkyHorizon')!.value as THREE.Color).copy(U.uSkyHorizon.value);
    (this.uniforms.get('uFogColor')!.value as THREE.Color).copy(U.uFogColor.value);
    this.uniforms.get('uNightWeight')!.value = U.uNightWeight.value;
  }

  public override dispose(): void {
    super.dispose();
    this.worker?.terminate();
    this.worker = null;
    this.cloudTexture3D.dispose();
  }
}
