import * as THREE from 'three';
import { CLOUD_SEA } from '../../world/bible.ts';
import { U } from '../uniforms.ts';

const CLOUD_FALLBACK_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying float vLayerFrac;

attribute float aLayerFrac;

void main() {
  vLayerFrac = aLayerFrac;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CLOUD_FALLBACK_FRAGMENT = /* glsl */ `
uniform sampler2D uNoiseTex;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uSkyHorizon;
uniform float uNightWeight;

varying vec3 vWorldPos;
varying float vLayerFrac;

void main() {
  vec3 toFrag = vWorldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(0.001, dist);

  // Fade out at grazing angles and far horizon so stacked planes never show hard slices
  float angleFade = smoothstep(0.03, 0.22, abs(viewDir.y));
  float distFade = (1.0 - smoothstep(1400.0, 4800.0, dist)) * smoothstep(12.0, 65.0, dist);
  if (angleFade * distFade <= 0.002) discard;

  vec2 windScroll = uWindDir * (uTime * (0.0025 + uWindStrength * 0.002));
  vec2 uv1 = vWorldPos.xz * 0.00055 + windScroll + vec2(vLayerFrac * 0.37, vLayerFrac * 0.61);
  vec2 uv2 = vWorldPos.xz * 0.0014 - windScroll * 0.6 + vec2(vLayerFrac * 0.19, 0.0);

  float n1 = texture2D(uNoiseTex, uv1).r;
  float n2 = texture2D(uNoiseTex, uv2).r;
  float density = n1 * 0.65 + n2 * 0.35;

  // Coverage ~0.55 so there are gaps for sun and the Sister planet
  float cloudMask = smoothstep(0.45, 0.78, density);
  float layerWeight = sin(vLayerFrac * 3.14159265);
  float alpha = cloudMask * (0.14 + 0.14 * layerWeight) * angleFade * distFade;
  if (alpha <= 0.003) discard;

  // Warm ivory tops and warm ink-grey undersides, picking up ember/peach sun colour
  vec3 undersideCol = mix(vec3(0.48, 0.42, 0.37), vec3(0.14, 0.11, 0.09), uNightWeight);
  vec3 topCol = mix(uSkyHorizon, mix(uSunColor, vec3(0.98, 0.94, 0.86), 0.45), 0.75);
  vec3 cloudCol = mix(undersideCol, topCol, 0.25 + 0.75 * vLayerFrac);

  // Melt into horizon fog colour with distance
  cloudCol = mix(cloudCol, uFogColor, smoothstep(900.0, 4200.0, dist));

  gl_FragColor = vec4(cloudCol, alpha);
}
`;

function createCloud2DNoiseTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number): number => {
    const wx = ((x % 16) + 16) % 16;
    const wy = ((y % 16) + 16) % 16;
    const n = Math.sin(wx * 127.1 + wy * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const vNoise = (u: number, v: number, freq: number): number => {
    const px = u * freq;
    const py = v * freq;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const val =
        vNoise(u, v, 4) * 0.55 + vNoise(u, v, 8) * 0.30 + vNoise(u, v, 16) * 0.15;
      const byte = Math.max(0, Math.min(255, Math.round(val * 255)));
      const idx = (y * size + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Five stacked large alpha planes (6 m apart inside `CLOUD_SEA.y0..y1`) for the `low` quality tier.
 */
export class CloudFallback {
  public readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly noiseTex: THREE.DataTexture;
  private readonly planes: THREE.Mesh[] = [];

  constructor() {
    this.group.name = 'CloudFallbackPlanes';
    this.noiseTex = createCloud2DNoiseTexture(128);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_FALLBACK_VERTEX,
      fragmentShader: CLOUD_FALLBACK_FRAGMENT,
      uniforms: {
        uNoiseTex: { value: this.noiseTex },
        uTime: U.uTime,
        uWindDir: U.uWindDir,
        uWindStrength: U.uWindStrength,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uFogColor: U.uFogColor,
        uSkyHorizon: U.uSkyHorizon,
        uNightWeight: U.uNightWeight,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // 5 stacked large alpha planes, each 6 m apart inside the cloud sea slab
    const baseAltitude = CLOUD_SEA.y0 + 18;
    const planeSize = 9600;

    for (let i = 0; i < 5; i++) {
      const geo = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
      geo.rotateX(-Math.PI / 2);

      const count = geo.attributes.position.count;
      const fracArr = new Float32Array(count);
      const frac = (i + 0.5) / 5;
      fracArr.fill(frac);
      geo.setAttribute('aLayerFrac', new THREE.BufferAttribute(fracArr, 1));

      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.y = baseAltitude + i * 6;
      mesh.renderOrder = 2 + i;
      this.group.add(mesh);
      this.planes.push(mesh);
    }
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(cameraPos: THREE.Vector3): void {
    if (!this.group.visible) return;
    // Follow camera in X and Z so the cloud sea extends endlessly
    this.group.position.x = cameraPos.x;
    this.group.position.z = cameraPos.z;
  }

  public dispose(): void {
    for (const m of this.planes) {
      m.geometry.dispose();
    }
    this.material.dispose();
    this.noiseTex.dispose();
  }
}
