import * as THREE from 'three';
import { U } from './uniforms.ts';

/**
 * Reusable GLSL function `vec3 arkvoidFog(vec3 color, vec3 worldPos)` for custom ShaderMaterials.
 * Implements:
 * 1. Exponential-squared distance fog
 * 2. Height fog below `uFogBaseY` falling off with `uFogHeightFalloff`
 * 3. Sun in-scatter warming toward `uSunColor` when looking toward `uSunDir`
 * 4. Altitude fade (`1.0 - uAltitude01`) so fog vanishes in high space
 */
export const ARKVOID_FOG_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseY;
uniform float uAltitude01;
uniform vec3 uCamPos;

vec3 arkvoidFog(vec3 baseColor, vec3 worldPos) {
  vec3 toFrag = worldPos - uCamPos;
  float dist = length(toFrag);
  vec3 viewDir = dist > 0.0001 ? toFrag / dist : vec3(0.0, 0.0, 1.0);

  // Altitude fade (0 at ground, 1 in open space)
  float altFade = clamp(1.0 - uAltitude01, 0.0, 1.0);
  float effDensity = uFogDensity * altFade;

  // Exponential-squared distance fog
  float distFactor = 1.0 - exp(-(effDensity * dist) * (effDensity * dist));

  // Height fog (denser below uFogBaseY, creating mist valleys)
  float belowBase = max(0.0, uFogBaseY - worldPos.y);
  float heightDensity = 1.0 - exp(-belowBase * uFogHeightFalloff);
  float heightFactor = heightDensity * clamp(dist / 220.0, 0.0, 1.0) * altFade;

  float fogFactor = clamp(distFactor + heightFactor * 0.65, 0.0, 0.96);

  // Sun in-scatter: warm toward uSunColor when looking toward the sun
  float sunAlign = max(0.0, dot(viewDir, normalize(uSunDir)));
  float inScatter = pow(sunAlign, 5.0) * 0.42;
  vec3 finalFogColor = mix(uFogColor, uSunColor, inScatter);

  return mix(baseColor, finalFogColor, fogFactor);
}
`;

let fogPatchInstalled = false;

/**
 * Patches THREE.ShaderChunk fog chunks once at startup and injects shared uniforms
 * into THREE.ShaderLib so all built-in materials with `fog: true` compile and render
 * the Ink & Ember atmospheric fog automatically.
 */
export function installArkvoidFogPatch(): void {
  if (fogPatchInstalled) return;
  fogPatchInstalled = true;

  // Register shared uniforms on built-in ShaderLib templates so standard/basic/lambert/physical
  // materials always have uSunDir, uFogBaseY, etc. bound even before patchMaterial is called.
  const libs = [
    THREE.ShaderLib.standard,
    THREE.ShaderLib.physical,
    THREE.ShaderLib.basic,
    THREE.ShaderLib.lambert,
    THREE.ShaderLib.phong,
    THREE.ShaderLib.points,
  ];
  for (const lib of libs) {
    if (lib && lib.uniforms) {
      Object.assign(lib.uniforms, {
        uTime: U.uTime,
        uWorldMinutes: U.uWorldMinutes,
        uDayFraction: U.uDayFraction,
        uSunDir: U.uSunDir,
        uSunColor: U.uSunColor,
        uSunIntensity: U.uSunIntensity,
        uSkyZenith: U.uSkyZenith,
        uSkyHorizon: U.uSkyHorizon,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uFogHeightFalloff: U.uFogHeightFalloff,
        uFogBaseY: U.uFogBaseY,
        uAltitude01: U.uAltitude01,
        uWindDir: U.uWindDir,
        uWindStrength: U.uWindStrength,
        uPlayerPos: U.uPlayerPos,
        uCamPos: U.uCamPos,
        uWear: U.uWear,
        uEmber: U.uEmber,
        uNightLamp: U.uNightLamp,
      });
    }
  }

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vArkvoidWorldPos;
#endif
`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
  vec4 arkWorldPos = modelMatrix * vec4(transformed, 1.0);
  vArkvoidWorldPos = arkWorldPos.xyz;
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vArkvoidWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ARKVOID_FOG_GLSL}
#endif
`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = arkvoidFog(gl_FragColor.rgb, vArkvoidWorldPos);
#endif
`;
}

export interface MaterialPatchHooks {
  uniforms?: Record<string, THREE.IUniform>;
  vertexPars?: string;
  vertexTransform?: string;
  fragmentPars?: string;
  fragmentColor?: string;
  enableWind?: boolean;
  enableEmberGlow?: boolean;
}

/**
 * Helper built on `onBeforeCompile` that binds shared uniforms `U` and optional
 * vertex/fragment hooks (wind sway, footpath wear, ember lamps) to any Three.js material.
 */
export function patchMaterial<T extends THREE.Material>(
  material: T,
  hooks: MaterialPatchHooks = {}
): T {
  installArkvoidFogPatch();
  (material as THREE.Material & { fog?: boolean }).fog = true;

  const prevCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(material, shader, renderer);

    Object.assign(shader.uniforms, {
      uTime: U.uTime,
      uWorldMinutes: U.uWorldMinutes,
      uDayFraction: U.uDayFraction,
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uSunIntensity: U.uSunIntensity,
      uSkyZenith: U.uSkyZenith,
      uSkyHorizon: U.uSkyHorizon,
      uFogColor: U.uFogColor,
      uFogDensity: U.uFogDensity,
      uFogHeightFalloff: U.uFogHeightFalloff,
      uFogBaseY: U.uFogBaseY,
      uAltitude01: U.uAltitude01,
      uWindDir: U.uWindDir,
      uWindStrength: U.uWindStrength,
      uPlayerPos: U.uPlayerPos,
      uCamPos: U.uCamPos,
      uWear: U.uWear,
      uEmber: U.uEmber,
      uNightLamp: U.uNightLamp,
      ...(hooks.uniforms ?? {}),
    });

    if (hooks.vertexPars || hooks.enableWind) {
      const windPars = hooks.enableWind
        ? `uniform float uTime;\nuniform vec2 uWindDir;\nuniform float uWindStrength;\n`
        : '';
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n${windPars}\n${hooks.vertexPars ?? ''}`
      );
    }

    if (hooks.vertexTransform || hooks.enableWind) {
      const windTransform = hooks.enableWind
        ? `float sway = sin(uTime * 1.8 + position.x * 0.5 + position.z * 0.5) * uWindStrength * max(0.0, position.y) * 0.08;\ntransformed.xz += uWindDir * sway;\n`
        : '';
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${windTransform}\n${hooks.vertexTransform ?? ''}`
      );
    }

    if (hooks.fragmentPars || hooks.enableEmberGlow) {
      const emberPars = hooks.enableEmberGlow
        ? `uniform float uEmber;\nuniform float uNightLamp;\n`
        : '';
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n${emberPars}\n${hooks.fragmentPars ?? ''}`
      );
    }

    if (hooks.fragmentColor || hooks.enableEmberGlow) {
      const emberFrag = hooks.enableEmberGlow
        ? `diffuseColor.rgb += vec3(0.98, 0.34, 0.03) * uEmber * uNightLamp * 0.15;\n`
        : '';
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${emberFrag}\n${hooks.fragmentColor ?? ''}`
      );
    }
  };

  material.needsUpdate = true;
  return material;
}

/**
 * Unit-style runtime self-check that compiles one patched MeshStandardMaterial
 * and reports success for the Debug overlay.
 */
export function verifyPatchedMaterial(renderer: THREE.WebGLRenderer): {
  ok: boolean;
  detail: string;
} {
  try {
    installArkvoidFogPatch();
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xeadccb, 0.0024);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.25, 100);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0x9b8b6e, roughness: 0.85 }),
      { enableWind: true, enableEmberGlow: true }
    );
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    renderer.compile(scene, cam);
    geo.dispose();
    mat.dispose();
    return {
      ok: true,
      detail: 'Patched MeshStandardMaterial + ArkvoidFog compiled cleanly.',
    };
  } catch (err) {
    return {
      ok: false,
      detail: `Shader compile check failed: ${String(err)}`,
    };
  }
}
