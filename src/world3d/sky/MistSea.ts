import * as THREE from 'three';
import { U } from '../uniforms.ts';

const MIST_SEA_VERTEX = /* glsl */ `
varying vec3 vWorldPos;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MIST_SEA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uFogColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSunColor;
uniform vec3 uPlayerPos;
uniform float uPlayerSpeed;
uniform float uNightWeight;

varying vec3 vWorldPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmMist(vec2 p) {
  float v = 0.0;
  v += 0.55 * valueNoise2D(p);
  v += 0.30 * valueNoise2D(p * 2.13 + vec2(4.7, -3.1));
  v += 0.15 * valueNoise2D(p * 4.41 + vec2(-8.2, 6.4));
  return v;
}

void main() {
  vec2 offset = vWorldPos.xz - cameraPosition.xz;
  float dist = length(offset);

  // Softly moving large-scale cloud noise across the 60 km mist floor
  vec2 windDrift = uWindDir * (uTime * (0.0018 + uWindStrength * 0.0014));
  vec2 uvMacro = vWorldPos.xz * 0.00028 + windDrift;
  float n = fbmMist(uvMacro);

  // Subtle brightness modulation following time of day
  vec3 highlightTint = mix(uFogColor, mix(uSkyHorizon, uSunColor, 0.22), 0.32);
  vec3 shadowTint = uFogColor * mix(0.88, 0.72, uNightWeight);
  vec3 mistCol = mix(shadowTint, highlightTint, smoothstep(0.24, 0.78, n));

  // Very faint wake of parted mist where the player moves close to the ground
  float playerDist = length(vWorldPos.xz - uPlayerPos.xz);
  float groundProximity = 1.0 - smoothstep(10.0, 185.0, abs(uPlayerPos.y - 110.0));
  float wakeRipple = exp(-playerDist * 0.035) * (0.5 + 0.5 * sin(playerDist * 0.35 - uTime * 2.4));
  float wakeStrength = wakeRipple * groundProximity * clamp(uPlayerSpeed * 0.18 + 0.25, 0.0, 1.0);
  mistCol = mix(mistCol, uSkyHorizon, wakeStrength * 0.14);

  // Fade cleanly into the horizon sky colour at 45 km (45,000 m)
  float horizonFade = smoothstep(18000.0, 45000.0, dist);
  vec3 finalCol = mix(mistCol, uSkyHorizon, horizonFade);

  // Outer rim feather at 58..60 km so the disc border is invisible
  float outerAlpha = 1.0 - smoothstep(55000.0, 60000.0, dist);

  gl_FragColor = vec4(finalCol, outerAlpha);
}
`;

/**
 * Endless Mist Sea floor (`radius = 60,000 m`) at `y = 10 m`, following the camera in X and Z.
 */
export class MistSea {
  public readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const geo = new THREE.CircleGeometry(60000, 72);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: MIST_SEA_VERTEX,
      fragmentShader: MIST_SEA_FRAGMENT,
      uniforms: {
        uTime: U.uTime,
        uWindDir: U.uWindDir,
        uWindStrength: U.uWindStrength,
        uFogColor: U.uFogColor,
        uSkyHorizon: U.uSkyHorizon,
        uSunColor: U.uSunColor,
        uPlayerPos: U.uPlayerPos,
        uPlayerSpeed: { value: 0.0 },
        uNightWeight: U.uNightWeight,
      },
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'MistSeaFloor';
    this.mesh.position.y = 10.0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
  }

  public update(cameraPos: THREE.Vector3, playerSpeed = 0): void {
    this.mesh.position.x = cameraPos.x;
    this.mesh.position.z = cameraPos.z;
    this.material.uniforms.uPlayerSpeed.value = playerSpeed;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
