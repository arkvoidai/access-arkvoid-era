import * as THREE from 'three';
import { patchMaterial } from '../fog.ts';

export type ArchMaterialId =
  | 'stone'
  | 'plaster'
  | 'timber'
  | 'lacquer'
  | 'roofTile'
  | 'paperWindow'
  | 'clothIvory'
  | 'clothLacquer'
  | 'clothInk'
  | 'iron'
  | 'bone'
  | 'lava'
  | 'blackStone'
  | 'emberCore'
  | 'brass';

export interface ArchMaterials {
  stone: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  lacquer: THREE.MeshStandardMaterial;
  roofTile: THREE.MeshStandardMaterial;
  paperWindow: THREE.MeshStandardMaterial;
  clothIvory: THREE.MeshStandardMaterial;
  clothLacquer: THREE.MeshStandardMaterial;
  clothInk: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  bone: THREE.MeshStandardMaterial;
  lava: THREE.MeshStandardMaterial;
  blackStone: THREE.MeshStandardMaterial;
  emberCore: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  get(id: ArchMaterialId): THREE.MeshStandardMaterial;
  dispose(): void;
}

const ARCH_GLSL_HASH = /* glsl */ `
float archHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float archNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(archHash12(i + vec2(0.0, 0.0)), archHash12(i + vec2(1.0, 0.0)), u.x),
    mix(archHash12(i + vec2(0.0, 1.0)), archHash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;

let sharedArchMaterials: ArchMaterials | null = null;

/**
 * Returns the shared singleton procedural Ink & Ember architectural material library.
 * Every material uses `patchMaterial` so it automatically integrates with the Arkvoid fog
 * and shared time/lamp/wind uniforms without requiring external texture downloads.
 */
export function getArchMaterials(): ArchMaterials {
  if (sharedArchMaterials) return sharedArchMaterials;

  // 1. STONE: ashlar blocks in world-space triplanar coordinates (rows 0.4..0.7m, varied widths,
  // per-block tint #BDB3A2..#8C8273, mortar AO, chipped edges, moss near ground, soot)
  const stone = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:stone',
      color: 0xbdb3a2,
      roughness: 0.88,
      metalness: 0.04,
    }),
    {
      vertexPars: /* glsl */ `
        varying vec3 vArchLocalPos;
        varying vec3 vArchWorldNorm;
      `,
      vertexTransform: /* glsl */ `
        vArchLocalPos = position;
        vArchWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
      `,
      fragmentPars: /* glsl */ `
        varying vec3 vArchLocalPos;
        varying vec3 vArchWorldNorm;
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        vec3 wn = normalize(vArchWorldNorm);
        // Triplanar projection plane
        vec2 uvStone = abs(wn.x) > abs(wn.z) ? wp.zy : wp.xy;
        float rowIdx = floor(wp.y / 0.54);
        float rowShift = archHash12(vec2(rowIdx, 7.1)) * 1.9;
        float blockWidth = mix(0.85, 1.45, archHash12(vec2(rowIdx, 3.3)));
        float colIdx = floor((uvStone.x + rowShift) / blockWidth);
        vec2 cellId = vec2(colIdx, rowIdx);

        vec2 cellUV = vec2(
          fract((uvStone.x + rowShift) / blockWidth),
          fract(wp.y / 0.54)
        );
        // Mortar lines with chipped edge noise
        float chip = (archNoise2D(wp.xz * 7.5 + wp.y * 5.0) - 0.5) * 0.045;
        float edgeDist = min(
          min(cellUV.x, 1.0 - cellUV.x) * blockWidth,
          min(cellUV.y, 1.0 - cellUV.y) * 0.54
        ) + chip;
        float mortarMask = smoothstep(0.014, 0.042, edgeDist);

        // Per-block tint between #8C8273 and #BDB3A2
        float blockRand = archHash12(cellId);
        vec3 stoneLight = vec3(0.741, 0.702, 0.635); // #BDB3A2
        vec3 stoneDark  = vec3(0.549, 0.510, 0.451); // #8C8273
        vec3 blockCol = mix(stoneDark, stoneLight, blockRand);

        // Micro grain & mortar AO
        float grain = archNoise2D(uvStone * 6.0) * 0.10 - 0.05;
        vec3 mortarCol = vec3(0.32, 0.28, 0.24);
        vec3 col = mix(mortarCol, blockCol + grain, mortarMask);

        // Olive-ochre moss near ground base on shaded faces
        float groundProx = clamp(1.0 - vArchLocalPos.y * 0.38, 0.0, 1.0);
        float shadeFace = clamp(0.65 - wn.y * 0.35 - wn.x * 0.25, 0.0, 1.0);
        float mossMask = groundProx * shadeFace * smoothstep(0.35, 0.75, archNoise2D(wp.xz * 2.1));
        vec3 mossCol = vec3(0.41, 0.40, 0.26); // warm olive-ochre, never neon green
        col = mix(col, mossCol, mossMask * 0.55);

        diffuseColor.rgb = col;
      `,
    }
  );

  // 2. PLASTER: warm ivory #E9DFCC, subtle stains, fine cracks, grime gradient near base
  const plaster = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:plaster',
      color: 0xe9dfcc,
      roughness: 0.9,
      metalness: 0.02,
    }),
    {
      vertexPars: /* glsl */ `
        varying vec3 vArchLocalPos;
      `,
      vertexTransform: /* glsl */ `
        vArchLocalPos = position;
      `,
      fragmentPars: /* glsl */ `
        varying vec3 vArchLocalPos;
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        float stain = archNoise2D(wp.xy * 0.85 + wp.z * 0.65);
        float fineCrack = smoothstep(0.48, 0.50, abs(archNoise2D(wp.xy * 4.2) - 0.5));
        float baseGrime = clamp(1.0 - (vArchLocalPos.y + 0.5) * 0.45, 0.0, 1.0);
        vec3 ivory = vec3(0.914, 0.875, 0.800); // #E9DFCC
        vec3 stainCol = vec3(0.75, 0.69, 0.60);
        vec3 grimeCol = vec3(0.44, 0.38, 0.32);
        vec3 col = mix(ivory, stainCol, stain * 0.28);
        col = mix(col * 0.88, col, fineCrack);
        col = mix(col, grimeCol, baseGrime * 0.38);
        diffuseColor.rgb = col;
      `,
    }
  );

  // 3. TIMBER: dark brown #3B2A20 with grain stripes and worn corners
  const timber = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:timber',
      color: 0x3b2a20,
      roughness: 0.82,
      metalness: 0.04,
    }),
    {
      fragmentPars: /* glsl */ `
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        float stripe = archNoise2D(vec2(wp.y * 12.0 + wp.x * 2.5, wp.z * 2.5));
        vec3 baseWood = vec3(0.231, 0.165, 0.125); // #3B2A20
        vec3 wornWood = vec3(0.325, 0.239, 0.184);
        diffuseColor.rgb = mix(baseWood, wornWood, stripe * 0.45);
      `,
    }
  );

  // 4. LACQUER: deep muted lacquer #5A2410 (architecture accent, not ember)
  const lacquer = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:lacquer',
      color: 0x5a2410,
      roughness: 0.56,
      metalness: 0.08,
    }),
    {
      fragmentPars: /* glsl */ `
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        float grain = archNoise2D(wp.xy * 6.0 + wp.z * 6.0);
        vec3 lacCol = vec3(0.353, 0.141, 0.063); // #5A2410
        diffuseColor.rgb = lacCol * (0.88 + grain * 0.24);
      `,
    }
  );

  // 5. ROOF TILE: ink-grey #2E2A28 curved tile rows with pale frost at eaves & ridge caps
  const roofTile = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:roofTile',
      color: 0x2e2a28,
      roughness: 0.72,
      metalness: 0.08,
    }),
    {
      vertexPars: /* glsl */ `
        varying vec2 vRoofUV;
      `,
      vertexTransform: /* glsl */ `
        vRoofUV = uv;
      `,
      fragmentPars: /* glsl */ `
        varying vec2 vRoofUV;
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        // Curved tile ribs along roof slope
        float ribCoord = (wp.x + wp.z) * 3.8;
        float ribWave = sin(ribCoord * 3.14159) * 0.5 + 0.5;
        float rowLap = fract(wp.y * 2.8);
        float rowShadow = smoothstep(0.0, 0.18, rowLap);

        vec3 tileDark = vec3(0.135, 0.122, 0.116);
        vec3 tileBase = vec3(0.180, 0.165, 0.157); // #2E2A28
        vec3 tileFrost = vec3(0.52, 0.48, 0.43);

        vec3 col = mix(tileDark, tileBase, ribWave * rowShadow);
        // Subtle eave frost / weathering
        float frostMask = smoothstep(0.68, 0.96, archNoise2D(wp.xz * 0.85)) * (1.0 - rowLap) * 0.32;
        col = mix(col, tileFrost, frostMask);
        diffuseColor.rgb = col;
      `,
    }
  );

  // 6. PAPER WINDOWS: lattice grid; at night glows ember-warm #FFB27A * uNightLamp with flicker; by day pale ivory
  const paperWindow = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:paperWindow',
      color: 0xede3d2,
      roughness: 0.65,
      metalness: 0.0,
    }),
    {
      fragmentPars: /* glsl */ `
        uniform float uTime;
        uniform float uNightLamp;
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        // Lattice grid in world coordinates (0.28 m muntin spacing)
        vec2 grid = abs(fract(vec2(wp.x + wp.z, wp.y) * 3.6) - 0.5);
        float frameMask = smoothstep(0.41, 0.46, max(grid.x, grid.y));

        // Per-window seed so each room flickers independently
        float winSeed = archHash12(floor(wp.xz * 0.5 + wp.y * 0.35));
        float flicker = 0.88 + 0.12 * sin(uTime * (2.6 + winSeed * 2.2) + winSeed * 19.0);
        // 80% of windows light up at dusk/night
        float activeRoom = step(0.18, winSeed);

        vec3 dayPaper = vec3(0.91, 0.87, 0.79);
        vec3 frameTimber = vec3(0.21, 0.15, 0.11);
        vec3 warmGlow = vec3(1.0, 0.698, 0.478); // #FFB27A
        vec3 emberEdge = vec3(0.984, 0.337, 0.027); // #FB5607

        float lampStrength = uNightLamp * activeRoom * flicker;
        vec3 litPaper = mix(dayPaper, mix(emberEdge, warmGlow, 0.68) * 1.85, lampStrength);
        diffuseColor.rgb = mix(litPaper, frameTimber, frameMask);
      `,
    }
  );

  // 7. CLOTH: banners, canopies, and airship sails with vertex wind sway
  const clothIvory = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:clothIvory',
      color: 0xe6dccb,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    { enableWind: true }
  );

  const clothLacquer = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:clothLacquer',
      color: 0x682a14,
      roughness: 0.86,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    { enableWind: true }
  );

  const clothInk = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:clothInk',
      color: 0x262220,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    { enableWind: true }
  );

  // 8. IRON & BONE & BRASS & BLACK STONE
  const iron = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:iron',
      color: 0x2a2826,
      roughness: 0.52,
      metalness: 0.68,
    })
  );

  const bone = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:bone',
      color: 0xd8cdb8,
      roughness: 0.78,
      metalness: 0.02,
    })
  );

  const brass = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:brass',
      color: 0xb88b4a,
      roughness: 0.36,
      metalness: 0.75,
    })
  );

  const blackStone = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:blackStone',
      color: 0x231f1e,
      roughness: 0.84,
      metalness: 0.08,
    }),
    {
      fragmentPars: /* glsl */ `
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec3 wp = vArkvoidWorldPos;
        float n = archNoise2D(wp.xz * 0.4 + wp.y * 0.7);
        // Subtle ember window/fissure veins on fortress blocks
        float fissure = smoothstep(0.84, 0.92, archNoise2D(wp.xy * 0.35 + wp.z * 0.35));
        vec3 obsidian = vec3(0.13, 0.11, 0.11) * (0.85 + n * 0.3);
        vec3 emberVein = vec3(0.98, 0.34, 0.03) * 1.35;
        diffuseColor.rgb = mix(obsidian, emberVein, fissure * 0.25);
      `,
    }
  );

  const emberCore = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:emberCore',
      color: 0xffb27a,
      emissive: new THREE.Color(0xfb5607),
      emissiveIntensity: 1.9,
      roughness: 0.35,
    })
  );

  // 9. LAVA: domain-warped flow shader, dark crust plates with glowing ember cracks & bright vents
  const lava = patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'arch:lava',
      color: 0x2a1e1b,
      roughness: 0.65,
      metalness: 0.05,
    }),
    {
      fragmentPars: /* glsl */ `
        uniform float uTime;
        ${ARCH_GLSL_HASH}
      `,
      fragmentColor: /* glsl */ `
        vec2 p = vArkvoidWorldPos.xz * 0.045;
        vec2 flow = vec2(
          archNoise2D(p + vec2(uTime * 0.04, -uTime * 0.03)),
          archNoise2D(p + vec2(-uTime * 0.03, uTime * 0.05) + 9.4)
        );
        vec2 warped = p + (flow - 0.5) * 1.65;
        float n1 = archNoise2D(warped * 2.4);
        float n2 = archNoise2D(warped * 5.2 - uTime * 0.06);
        float crack = 1.0 - smoothstep(0.02, 0.16, abs(n1 - 0.5));
        float vent = smoothstep(0.76, 0.93, n1 * n2 * 1.8);
        float pulse = 0.85 + 0.15 * sin(uTime * 1.7 + p.x * 3.0);

        vec3 crust = vec3(0.12, 0.09, 0.08);
        vec3 magma = vec3(0.984, 0.337, 0.027) * 1.9 * pulse; // #FB5607
        vec3 core  = vec3(1.0, 0.78, 0.48) * 2.4;

        vec3 col = mix(crust, magma, clamp(crack, 0.0, 1.0));
        col = mix(col, core, vent);
        diffuseColor.rgb = col;
      `,
    }
  );

  const map: Record<ArchMaterialId, THREE.MeshStandardMaterial> = {
    stone,
    plaster,
    timber,
    lacquer,
    roofTile,
    paperWindow,
    clothIvory,
    clothLacquer,
    clothInk,
    iron,
    bone,
    lava,
    blackStone,
    emberCore,
    brass,
  };

  sharedArchMaterials = {
    ...map,
    get(id: ArchMaterialId) {
      return map[id];
    },
    dispose() {
      for (const m of Object.values(map)) {
        m.dispose();
      }
      sharedArchMaterials = null;
    },
  };

  return sharedArchMaterials;
}
