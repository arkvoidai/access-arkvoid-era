import * as THREE from 'three';
import { WORLD } from '../../world/bible.ts';
import { patchMaterial } from '../fog.ts';
import type { QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';
import type { TerrainTextureSet } from './TerrainTextures.ts';

/**
 * Creates the custom `MeshStandardMaterial` for Arkvoid's terrain.
 * Extends Three.js `MeshStandardMaterial` via `onBeforeCompile` so it receives shadows,
 * PMREM hemisphere/environment lighting, and the Arkvoid height-aware atmospheric fog,
 * while computing albedo, micro-normal, cavity AO, wetness, cliff strata, ash ember cracks,
 * and live footpath wear (`uWear`) in the fragment shader.
 */
export function createTerrainMaterial(
  textures: TerrainTextureSet,
  pathFieldTex: THREE.DataTexture,
  tier: QualityTier
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    metalness: 0.03,
  });

  // First install the shared Arkvoid fog & uniform hook
  patchMaterial(mat);

  const prevBeforeCompile = mat.onBeforeCompile;
  const isLowTier = tier === 'low';

  mat.customProgramCacheKey = () => `arkvoid-terrain-splat-v1-${isLowTier ? 'low' : 'high'}`;

  mat.onBeforeCompile = (shader, renderer) => {
    prevBeforeCompile.call(mat, shader, renderer);

    shader.uniforms.uGrassAlbedo = { value: textures.grassAlbedo };
    shader.uniforms.uGrassNormal = { value: textures.grassNormal };
    shader.uniforms.uRockDarkAlbedo = { value: textures.rockDarkAlbedo };
    shader.uniforms.uRockPaleAlbedo = { value: textures.rockPaleAlbedo };
    shader.uniforms.uDirtAlbedo = { value: textures.dirtAlbedo };
    shader.uniforms.uMacroNoise = { value: textures.macroNoise };
    shader.uniforms.uPathField = { value: pathFieldTex };
    shader.uniforms.uWear = U.uWear;
    shader.uniforms.uLowTier = { value: isLowTier ? 1.0 : 0.0 };
    shader.uniforms.uWorldBounds = {
      value: new THREE.Vector4(
        WORLD.minX,
        WORLD.minZ,
        WORLD.maxX - WORLD.minX,
        WORLD.maxZ - WORLD.minZ
      ),
    };

    shader.vertexShader =
      /* glsl */ `
      attribute vec4 aSplat;
      attribute vec2 aExtra;
      attribute float aCavity;
      varying vec4 vSplat;
      varying vec2 vExtra;
      varying float vCavity;
      varying vec3 vTerrainWorldNormal;
      varying vec3 vTerrainWorldPos;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      vSplat = aSplat;
      vExtra = aExtra;
      vCavity = aCavity;
      vTerrainWorldNormal = normalize(normal);
      vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );

    shader.fragmentShader =
      /* glsl */ `
      uniform sampler2D uGrassAlbedo;
      uniform sampler2D uGrassNormal;
      uniform sampler2D uRockDarkAlbedo;
      uniform sampler2D uRockPaleAlbedo;
      uniform sampler2D uDirtAlbedo;
      uniform sampler2D uMacroNoise;
      uniform sampler2D uPathField;
      uniform sampler2D uWear;
      uniform float uNightLamp;
      uniform float uLowTier;
      uniform vec4 uWorldBounds;

      varying vec4 vSplat;
      varying vec2 vExtra;
      varying float vCavity;
      varying vec3 vTerrainWorldNormal;
      varying vec3 vTerrainWorldPos;

      vec3 sampleTileBroken(sampler2D tex, vec2 uv, vec2 macroVal) {
        if (uLowTier > 0.5) {
          return texture2D(tex, uv).rgb;
        }
        vec2 uvA = uv;
        vec2 uvB = uv * 0.67 + vec2(0.37, 0.71);
        float blend = smoothstep(0.3, 0.7, macroVal.x);
        return mix(texture2D(tex, uvA).rgb, texture2D(tex, uvB).rgb, blend);
      }

      vec3 sampleTriplanarRock(sampler2D tex, vec3 wp, vec3 wn, float scale) {
        if (uLowTier > 0.5) {
          return texture2D(tex, wp.xz * scale).rgb;
        }
        vec3 w = pow(abs(wn), vec3(4.0));
        w /= max(0.0001, w.x + w.y + w.z);
        vec3 cx = texture2D(tex, wp.zy * scale).rgb;
        vec3 cy = texture2D(tex, wp.xz * scale).rgb;
        vec3 cz = texture2D(tex, wp.xy * scale).rgb;
        return cx * w.x + cy * w.y + cz * w.z;
      }
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #include <map_fragment>
      {
        vec3 wp = vTerrainWorldPos;
        vec3 wn = normalize(vTerrainWorldNormal);
        float slope = 1.0 - clamp(wn.y, 0.0, 1.0);

        // World UV in [0, 1] across WORLD rectangle for PathField and WearMap
        vec2 worldUv = (wp.xz - uWorldBounds.xy) / uWorldBounds.zw;
        float wearVal = 0.0;
        float pathFieldVal = 0.0;
        if (worldUv.x >= 0.0 && worldUv.x <= 1.0 && worldUv.y >= 0.0 && worldUv.y <= 1.0) {
          wearVal = texture2D(uWear, worldUv).r;
          pathFieldVal = texture2D(uPathField, worldUv).r;
        }

        // 300 m macro variation to break repetition across valleys and ridges
        vec2 macro = texture2D(uMacroNoise, wp.xz * 0.0033).rg;

        // Layer palette (strictly warm Ink & Ember: no blue, no neon green)
        vec2 tiledUv = wp.xz * 0.14;
        vec3 texGrass = sampleTileBroken(uGrassAlbedo, tiledUv, macro);
        vec3 colGrassBase = mix(vec3(0.482, 0.478, 0.290), vec3(0.639, 0.604, 0.388), macro.x);
        vec3 colShadedMoss = vec3(0.373, 0.369, 0.235); // #5F5E3C
        vec3 colGrass = mix(colGrassBase * (0.72 + 0.52 * texGrass), colShadedMoss, smoothstep(0.15, 0.6, 1.0 - vCavity));

        vec3 texRockDark = sampleTriplanarRock(uRockDarkAlbedo, wp, wn, 0.09);
        vec3 texRockPale = sampleTriplanarRock(uRockPaleAlbedo, wp, wn, 0.08);
        vec3 colRockDark = mix(vec3(0.227, 0.196, 0.176), texRockDark, 0.65); // #3A322D
        vec3 colRockPale = mix(vec3(0.812, 0.776, 0.706), texRockPale, 0.65); // #CFC6B4

        // Cliff horizontal strata bands from world Y + macro noise
        float strataWave = sin(wp.y * 0.42 + macro.x * 5.5) * 0.5 + 0.5;
        float strataBand = smoothstep(0.25, 0.78, strataWave);
        vec3 colCliffRock = mix(colRockDark, colRockPale, clamp(vSplat.z + strataBand * 0.45, 0.0, 1.0));

        vec3 texDirt = sampleTileBroken(uDirtAlbedo, wp.xz * 0.16, macro);
        vec3 colDirt = mix(vec3(0.604, 0.482, 0.353), texDirt, 0.58); // #9A7B5A
        vec3 colScree = vec3(0.490, 0.455, 0.412); // #7D7469
        vec3 colAsh = vec3(0.231, 0.220, 0.208);   // #3B3835

        // Combine vertex splat weights with live path field and live footpath wear map
        float wGrass = vSplat.x;
        float wRock = clamp(vSplat.y + vSplat.z + smoothstep(0.22, 0.42, slope), 0.0, 1.0);
        float wPath = clamp(max(vSplat.w, pathFieldVal) + wearVal * 0.92, 0.0, 1.0);
        float wAsh = vExtra.x;
        float wScree = vExtra.y;

        vec3 layerCol = colGrass;
        layerCol = mix(layerCol, colScree, clamp(wScree, 0.0, 1.0));
        layerCol = mix(layerCol, colDirt, wPath);
        layerCol = mix(layerCol, colCliffRock, wRock);
        layerCol = mix(layerCol, colAsh, clamp(wAsh, 0.0, 1.0));

        // Faint glowing ember cracks in the Ashen basin floor, boosted slightly at night by uNightLamp
        if (wAsh > 0.25 && wp.y < 76.0) {
          float crackPattern = smoothstep(0.84, 0.96, sin(wp.x * 0.55 + macro.x * 8.0) * cos(wp.z * 0.55 + macro.y * 8.0));
          float emberGlow = crackPattern * wAsh * (0.35 + uNightLamp * 0.55);
          layerCol += vec3(0.984, 0.337, 0.027) * emberGlow;
        }

        // Wetness near valley water & lower mist floor (y < 64 m)
        float wetness = 1.0 - smoothstep(57.5, 63.5, wp.y);
        layerCol *= mix(1.0, 0.72, wetness);

        // Cavity Ambient Occlusion (darkens crevices and cliff bases so even low tier looks grounded)
        float cavityAo = mix(0.48, 1.08, clamp(vCavity, 0.0, 1.0));
        layerCol *= cavityAo;

        diffuseColor.rgb = layerCol;
      }
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
      #include <roughnessmap_fragment>
      {
        float wetness = 1.0 - smoothstep(57.5, 63.5, vTerrainWorldPos.y);
        roughnessFactor = mix(0.88, 0.32, wetness);
      }
      `
    );
  };

  return mat;
}
