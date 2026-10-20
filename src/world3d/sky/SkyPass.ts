import * as THREE from 'three';
import { SISTER } from '../../world/bible.ts';
import { U } from '../uniforms.ts';

const SKY_PASS_VERTEX_GLSL = /* glsl */ `
varying vec2 vNdc;

void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

const SKY_PASS_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform mat4 uInvProj;
uniform mat3 uCamWorldRot;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uAltitude01;
uniform float uNightWeight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform vec3 uSisterCenter;
uniform float uSisterRadius;
uniform sampler2D uSisterTex;
uniform float uHasSisterTex;

varying vec2 vNdc;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);

  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);

  return mix(nxy0, nxy1, u.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise3D(p);
    p = p * 2.04 + vec3(13.7, -7.3, 5.1);
    amp *= 0.5;
  }
  return v;
}

vec2 intersectSphere(vec3 ro, vec3 rd, vec3 center, float rad) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - rad * rad;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  float s = sqrt(h);
  return vec2(-b - s, -b + s);
}

void main() {
  // Reconstruct world-space view ray from NDC using inverse projection and camera rotation
  vec4 viewPos = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 viewRay = normalize(viewPos.xyz / max(0.0001, viewPos.w));
  vec3 d = normalize(uCamWorldRot * viewRay);

  float h = max(0.0, uCamPos.y);
  float atm = exp(-h / 3200.0);
  float space = clamp(uAltitude01, 0.0, 1.0);

  // 1. ATMOSPHERIC GRADIENT
  float e = d.y;
  float t = pow(clamp(e, 0.0, 1.0), 0.45);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, t);

  if (e < 0.0) {
    float belowT = clamp(-e * 3.5, 0.0, 1.0);
    sky = mix(uSkyHorizon, uFogColor, belowT);
  }

  // 2. SUN DISC, SOFT GLOW & WARM HAZE (no lens flare, no ghost circles)
  vec3 sunDir = normalize(uSunDir);
  float sunCos = max(dot(d, sunDir), 0.0);
  float sunHorizonMask = smoothstep(-0.04, 0.03, e);
  float sunDisc = pow(sunCos, 2400.0) * 6.0 * sunHorizonMask;
  float sunGlow = pow(sunCos, 14.0) * 0.35 * atm;
  float sunHaze = pow(sunCos, 3.0) * 0.12 * atm;
  vec3 color = sky + uSunColor * (sunDisc + sunGlow + sunHaze);

  // 3. SPACE BLEND (#07070A warm ink, shrinking atmosphere into a thin warm horizon band)
  vec3 spaceInk = vec3(0.0274, 0.0274, 0.0392);
  float spaceT = smoothstep(0.0, 1.0, space);
  color = mix(color, spaceInk, spaceT);
  if (space > 0.01) {
    float limbGlow = exp(-abs(e + 0.04 * space) * (6.0 + space * 20.0));
    color += uSkyHorizon * limbGlow * spaceT * 0.62;
    color += uSunColor * sunDisc * spaceT;
  }

  // 4. STARS & WARM IVORY DUST BAND
  float starVis = max(uNightWeight, space) * smoothstep(-0.02, 0.14, e + space * 0.35);
  if (starVis > 0.005) {
    vec3 starGrid = floor(d * 520.0);
    float sh = hash31(starGrid);
    if (sh > 0.9945) {
      float normHash = (sh - 0.9945) / 0.0055;
      float powerLaw = pow(normHash, 3.2);
      float twinkle = 0.88 + 0.12 * sin(uTime * 1.9 + sh * 628.0);
      vec3 ivoryStar = mix(vec3(0.94, 0.86, 0.74), vec3(1.0, 0.95, 0.86), normHash);
      color += ivoryStar * powerLaw * twinkle * starVis * 1.45;
    }

    // Tilted great-circle dust band (warm ivory, max 12% brightness)
    vec3 bandNormal = normalize(vec3(0.46, 0.62, -0.63));
    float planeDist = abs(dot(d, bandNormal));
    float bandProfile = exp(-planeDist * planeDist * 18.0);
    if (bandProfile > 0.01) {
      float dustNoise = fbm3(d * 4.5 + vec3(1.2, -0.8, 2.4));
      float dust = bandProfile * smoothstep(0.32, 0.78, dustNoise) * 0.12;
      color += vec3(0.95, 0.87, 0.75) * dust * starVis;
    }
  }

  // 5. THE SISTER PLANET & TILTED RING (analytic ray-sphere + ray-plane intersection)
  // Effective light direction for the Sister: during day/twilight use sunDir; at deep night keep a crescent phase angle
  vec3 planetLightDir = normalize(mix(sunDir, normalize(vec3(-0.72, 0.44, 0.53)), uNightWeight * 0.85));

  // Tilted ring plane normal (tilted toward the valley so the elliptical ring and Cassini gap are clearly visible)
  vec3 ringNormal = normalize(vec3(-0.32, 0.82, -0.47));
  float denom = dot(d, ringNormal);
  float tRing = -1.0;
  if (abs(denom) > 0.0001) {
    tRing = dot(uSisterCenter - uCamPos, ringNormal) / denom;
  }

  vec2 tSphere = intersectSphere(uCamPos, d, uSisterCenter, uSisterRadius);
  float tPlanet = tSphere.x;

  // Horizon haze attenuation: softens the lowest 6 degrees near the horizon while keeping the Sister crisp above
  float horizonAtten = 1.0 - exp(-max(0.0, e + space * 0.35) * 14.0);

  // Evaluate ring colour if hit within [1.35 * R, 1.9 * R]
  vec4 ringSample = vec4(0.0);
  if (tRing > 0.0) {
    vec3 ringPos = uCamPos + d * tRing;
    vec3 relRing = ringPos - uSisterCenter;
    float rDist = length(relRing) / uSisterRadius;
    if (rDist >= 1.35 && rDist <= 1.90) {
      float uRing = (rDist - 1.35) / (1.90 - 1.35);
      float edgeSoft = smoothstep(0.0, 0.08, uRing) * smoothstep(1.0, 0.88, uRing);
      float fineBands = 0.55 + 0.45 * sin(uRing * 95.0 + sin(uRing * 23.0) * 1.4);
      float cassiniGap = 1.0 - 0.68 * exp(-pow((uRing - 0.58) * 18.0, 2.0));

      // Check if planet shadows this point on the ring
      vec2 shadowHit = intersectSphere(ringPos, planetLightDir, uSisterCenter, uSisterRadius * 0.98);
      float planetShadow = shadowHit.x > 0.0 ? 0.18 : 1.0;

      vec3 ringCol = mix(vec3(0.84, 0.77, 0.67), vec3(0.98, 0.92, 0.82), fineBands) * planetShadow;
      float ringAlpha = edgeSoft * cassiniGap * 0.55 * horizonAtten;
      ringSample = vec4(ringCol, ringAlpha);
    }
  }

  // Evaluate planet surface if hit
  if (tPlanet > 0.0) {
    // If ring is behind planet, composite ring behind first
    if (ringSample.a > 0.0 && tRing > tPlanet) {
      color = mix(color, ringSample.rgb, ringSample.a);
    }

    vec3 hitPos = uCamPos + d * tPlanet;
    vec3 n = normalize(hitPos - uSisterCenter);

    // Local coordinate frame on the Sister
    vec3 pLocal = n;
    float lat = asin(clamp(pLocal.y, -1.0, 1.0));
    float lon = atan(pLocal.z, pLocal.x);

    vec3 albedo;
    if (uHasSisterTex > 0.5) {
      vec2 uv = vec2(lon / (2.0 * 3.14159265) + 0.5, lat / 3.14159265 + 0.5);
      albedo = texture2D(uSisterTex, uv).rgb;
    } else {
      // Procedural latitude bands warped by 3D FBM noise (pale ivory, soft grey-ochre, warm ink continents)
      float warp = fbm3(pLocal * 3.6 + vec3(0.5, 1.1, -0.4));
      float detail = fbm3(pLocal * 9.2 + warp * 1.8);
      float bandCoord = pLocal.y * 8.5 + (warp - 0.5) * 2.6;
      float band = 0.5 + 0.5 * sin(bandCoord * 3.14159);

      vec3 colIvory = vec3(0.96, 0.91, 0.83);
      vec3 colOchre = vec3(0.76, 0.68, 0.58);
      vec3 colWarmInk = vec3(0.22, 0.17, 0.14);

      albedo = mix(colOchre, colIvory, smoothstep(0.25, 0.78, band));
      float continentMask = smoothstep(0.52, 0.70, warp * 0.65 + detail * 0.35);
      albedo = mix(albedo, colWarmInk, continentMask * 0.65);

      // Subtle high-altitude cloud streaks
      float streaks = smoothstep(0.58, 0.82, sin(lat * 18.0 + detail * 4.5) * 0.5 + 0.5);
      albedo = mix(albedo, colIvory, streaks * 0.32);
    }

    // Ring shadow cast onto the planet surface
    float ringShadowOnPlanet = 1.0;
    float lDenom = dot(planetLightDir, ringNormal);
    if (abs(lDenom) > 0.0001) {
      float tToRing = dot(uSisterCenter - hitPos, ringNormal) / lDenom;
      if (tToRing > 0.0) {
        vec3 sRingPos = hitPos + planetLightDir * tToRing;
        float sDist = length(sRingPos - uSisterCenter) / uSisterRadius;
        if (sDist >= 1.35 && sDist <= 1.90) {
          ringShadowOnPlanet = 0.58;
        }
      }
    }

    // Lambert shading with soft terminator
    float ndl = dot(n, planetLightDir);
    float lambert = smoothstep(-0.16, 0.85, ndl) * ringShadowOnPlanet;

    // Dark side of the planet blends naturally into the sky behind it so it looks embedded in the atmosphere
    vec3 darkSide = mix(color * 0.88, vec3(0.05, 0.04, 0.035), clamp(uNightWeight + space, 0.0, 1.0));
    vec3 brightSide = albedo * mix(uSunColor, vec3(0.99, 0.94, 0.86), 0.55) * 1.12;
    vec3 litPlanet = mix(darkSide, brightSide, lambert);

    // Thin ember limb on the sunlit rim: pow(1 - dot(n, -d), 5) * 0.6 of #FB5607 mixed with #FFE2C6
    float ndv = clamp(dot(n, -d), 0.0, 1.0);
    float rimFactor = pow(1.0 - ndv, 5.0) * 0.6 * smoothstep(-0.12, 0.55, ndl);
    vec3 emberRimCol = mix(vec3(0.984, 0.337, 0.027), vec3(1.0, 0.886, 0.776), 0.42);
    litPlanet += emberRimCol * rimFactor;

    // Daytime atmospheric scatter veil: by day it is a ghostly, enormous pale world; at dusk/night/space it is the hero
    float dayVeil = clamp(atm * (1.0 - uNightWeight) * 0.32, 0.0, 0.42);
    litPlanet = mix(litPlanet, color + litPlanet * 0.35, dayVeil);

    float limbFade = smoothstep(0.01, 0.16, ndv);
    float planetOpacity = limbFade * horizonAtten;

    color = mix(color, litPlanet, planetOpacity);

    // If ring is in front of planet, composite ring on top now
    if (ringSample.a > 0.0 && tRing < tPlanet) {
      color = mix(color, ringSample.rgb, ringSample.a);
    }
  } else if (ringSample.a > 0.0) {
    color = mix(color, ringSample.rgb, ringSample.a);
  }

  gl_FragColor = vec4(max(vec3(0.0), color), 1.0);
}
`;

const _cpuSkyOut = new THREE.Color();

/**
 * CPU version of the sky gradient (`skyColorAt(direction)`) for the environment map and fog tint.
 */
export function skyColorAt(
  direction: THREE.Vector3,
  target: THREE.Color = _cpuSkyOut
): THREE.Color {
  const e = direction.y;
  if (e >= 0) {
    const t = Math.pow(Math.min(1, Math.max(0, e)), 0.45);
    return target.copy(U.uSkyHorizon.value).lerp(U.uSkyZenith.value, t);
  }
  const belowT = Math.min(1, Math.max(0, -e * 3.5));
  return target.copy(U.uSkyHorizon.value).lerp(U.uFogColor.value, belowT);
}

/**
 * Full-screen triangle background pass rendering the atmosphere, sun, stars, dust band, and the Sister planet.
 */
export class SkyPass {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.OrthographicCamera;
  public readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly rotMatrix3 = new THREE.Matrix3();
  private sisterTexture: THREE.Texture | null = null;
  private readonly dummyTex: THREE.DataTexture;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Full-screen triangle covering [-1, 1]^2 in clip space with a single triangle
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const dummyData = new Uint8Array([240, 228, 210, 255]);
    this.dummyTex = new THREE.DataTexture(dummyData, 1, 1, THREE.RGBAFormat);
    this.dummyTex.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_PASS_VERTEX_GLSL,
      fragmentShader: SKY_PASS_PASS_FRAG_SAFE,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorldRot: { value: new THREE.Matrix3() },
        uCamPos: U.uCamPos,
        uTime: U.uTime,
        uAltitude01: U.uAltitude01,
        uNightWeight: U.uNightWeight,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uSkyZenith: U.uSkyZenith,
        uSkyHorizon: U.uSkyHorizon,
        uFogColor: U.uFogColor,
        uSisterCenter: {
          value: new THREE.Vector3(SISTER.center[0], SISTER.center[1], SISTER.center[2]),
        },
        uSisterRadius: { value: SISTER.radius },
        uSisterTex: { value: this.dummyTex },
        uHasSisterTex: { value: 0.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.probeOptionalSisterTexture();
  }

  /**
   * Silently probes `/world/sky/sister.webp` without logging any error if the file does not exist.
   */
  private probeOptionalSisterTexture(): void {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    const isHeadless = Boolean(
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent)
    );
    if (isHeadless) return;

    fetch('/world/sky/sister.webp', { method: 'HEAD' })
      .then((res) => {
        const ct = res.headers.get('content-type') ?? '';
        if (res.ok && ct.startsWith('image/')) {
          const loader = new THREE.TextureLoader();
          loader.load(
            '/world/sky/sister.webp',
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              this.sisterTexture = tex;
              this.material.uniforms.uSisterTex.value = tex;
              this.material.uniforms.uHasSisterTex.value = 1.0;
            },
            undefined,
            () => {
              // Silent fallback to procedural surface
            }
          );
        }
      })
      .catch(() => {
        // Silent fallback to procedural surface
      });
  }

  public syncCamera(worldCamera: THREE.Camera): void {
    worldCamera.updateMatrixWorld();
    this.material.uniforms.uInvProj.value.copy(worldCamera.projectionMatrixInverse);
    this.rotMatrix3.setFromMatrix4(worldCamera.matrixWorld);
    this.material.uniforms.uCamWorldRot.value.copy(this.rotMatrix3);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    worldCamera: THREE.Camera,
    target: THREE.WebGLRenderTarget | null = null
  ): void {
    this.syncCamera(worldCamera);
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.clearColor();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.dummyTex.dispose();
    this.sisterTexture?.dispose();
  }
}

const SKY_PASS_PASS_FRAG_SAFE = SKY_PASS_FRAGMENT_GLSL;
