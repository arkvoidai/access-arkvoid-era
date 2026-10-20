import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ArchMaterialId } from './Materials.ts';
import { getArchMaterials } from './Materials.ts';

export interface KitPart {
  geometry: THREE.BufferGeometry;
  materialId: ArchMaterialId;
  matrix: THREE.Matrix4;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export class KitBuilder {
  public readonly parts: KitPart[] = [];
  public readonly lampPositions: THREE.Vector3[] = [];

  public addPart(
    geometry: THREE.BufferGeometry,
    materialId: ArchMaterialId,
    matrix: THREE.Matrix4,
    castShadow = true,
    receiveShadow = true
  ): void {
    this.parts.push({
      geometry,
      materialId,
      matrix: matrix.clone(),
      castShadow,
      receiveShadow,
    });
  }

  public addBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    materialId: ArchMaterialId,
    rotY = 0
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4();
    if (rotY !== 0) {
      m.makeRotationY(rotY);
    }
    m.setPosition(x, y, z);
    this.addPart(geo, materialId, m);
  }

  public addCylinder(
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    x: number,
    y: number,
    z: number,
    materialId: ArchMaterialId,
    rotY = 0
  ): void {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    const m = new THREE.Matrix4();
    if (rotY !== 0) m.makeRotationY(rotY);
    m.setPosition(x, y, z);
    this.addPart(geo, materialId, m);
  }

  public addChildBuilder(child: KitBuilder, transform: THREE.Matrix4): void {
    for (const part of child.parts) {
      const combined = new THREE.Matrix4().multiplyMatrices(transform, part.matrix);
      this.parts.push({
        geometry: part.geometry.clone(),
        materialId: part.materialId,
        matrix: combined,
        castShadow: part.castShadow,
        receiveShadow: part.receiveShadow,
      });
    }
    for (const lp of child.lampPositions) {
      this.lampPositions.push(lp.clone().applyMatrix4(transform));
    }
  }

  /**
   * Builds a standalone `THREE.Group` with geometries merged by `ArchMaterialId`.
   */
  public toMergedGroup(name = 'kit-group'): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const mats = getArchMaterials();
    const byMat = new Map<ArchMaterialId, THREE.BufferGeometry[]>();

    for (const part of this.parts) {
      const g = part.geometry.clone();
      g.applyMatrix4(part.matrix);
      const nonIndexed = g.index ? g.toNonIndexed() : g;
      // Ensure consistent attributes (position, normal, uv)
      if (!nonIndexed.getAttribute('uv')) {
        const count = nonIndexed.getAttribute('position').count;
        nonIndexed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      const list = byMat.get(part.materialId) ?? [];
      list.push(nonIndexed);
      byMat.set(part.materialId, list);
      if (nonIndexed !== g) g.dispose();
    }

    for (const [matId, geos] of byMat.entries()) {
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats.get(matId));
      mesh.name = `${name}:${matId}`;
      mesh.castShadow = matId !== 'paperWindow' && matId !== 'lava';
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return group;
  }
}

/**
 * Deterministic seeded PRNG (`0..1`) for building variation.
 */
function seededRand(seed: number, step: number): number {
  let t = (seed + step * 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Builds a battered stone terrace wall (`lean` inward by a few degrees at the top).
 */
export function buildTerraceWallGeo(
  length: number,
  height: number,
  thickness: number,
  batter = 0.08
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(length, height, thickness, 4, 2, 1);
  const pos = geo.getAttribute('position');
  const halfH = height * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + halfH) / Math.max(0.01, height); // 0 at bottom, 1 at top
    // Narrow top thickness slightly to create authentic inward stone batter
    pos.setZ(i, z * (1.0 - t * batter));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a stone or timber stair flight with optional side cheek walls.
 */
export function addStairs(
  kb: KitBuilder,
  width: number,
  height: number,
  depth: number,
  steps: number,
  x: number,
  y0: number,
  z: number,
  rotY = 0,
  materialId: ArchMaterialId = 'stone'
): void {
  const local = new KitBuilder();
  const stepH = height / steps;
  const stepD = depth / steps;
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * stepH;
    const cz = -depth * 0.5 + (i + 0.5) * stepD;
    local.addBox(width, h, stepD + 0.04, 0, h * 0.5, cz, materialId);
  }
  // Low stone cheek stringers
  local.addBox(0.26, height + 0.28, depth + 0.2, -width * 0.5 - 0.13, height * 0.5, 0, 'stone');
  local.addBox(0.26, height + 0.28, depth + 0.2, width * 0.5 + 0.13, height * 0.5, 0, 'stone');

  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y0, z);
  kb.addChildBuilder(local, m);
}

/**
 * Signature curved East-Asian / Arkvoid hipped-gabled roof geometry (`roof(w, d, eave, rise, curve, lift)`).
 * Planes curve concavely toward the eaves with upturned eave corners ("flying eaves"),
 * plus ridge beam and hip spine tubes.
 */
export function buildCurvedRoofParts(
  kb: KitBuilder,
  w: number,
  d: number,
  eave: number,
  rise: number,
  curve: number,
  lift: number,
  yBase: number,
  includeBrackets = true
): void {
  const totalW = w + eave * 2;
  const totalD = d + eave * 2;
  const segX = 10;
  const segZ = 8;

  // Main curved tile shell (grid displaced into a concave hipped-gable roof with upturned corners)
  const shellGeo = new THREE.BoxGeometry(totalW, 0.22, totalD, segX, 1, segZ);
  const pos = shellGeo.getAttribute('position');
  const halfW = totalW * 0.5;
  const halfD = totalD * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    const nx = Math.abs(vx) / Math.max(0.01, halfW); // 0 at ridge center, 1 at eave tip
    const nz = Math.abs(vz) / Math.max(0.01, halfD); // 0 at ridge center, 1 at eave slope

    // Concave roof profile from ridge (nz = 0) down to eaves (nz = 1)
    const slope = Math.pow(nz, 1.0 + curve * 0.85);
    let h = rise * (1.0 - slope);

    // Hipped taper near the left/right ends
    const hipFactor = Math.max(0, (nx - 0.55) / 0.45);
    h *= 1.0 - hipFactor * 0.42;

    // Upturned eave corners ("lift" at outer diagonal tips)
    const cornerDist = Math.max(0, nx * nz - 0.35) / 0.65;
    const cornerLift = lift * cornerDist * cornerDist;

    pos.setY(i, vy + yBase + h + cornerLift);
  }
  shellGeo.computeVertexNormals();
  kb.addPart(shellGeo, 'roofTile', new THREE.Matrix4());

  // Main ridge cap beam + upturned end finials
  const ridgeW = totalW * 0.76;
  kb.addBox(ridgeW, 0.34, 0.38, 0, yBase + rise + 0.14, 0, 'stone');
  kb.addBox(0.42, 0.52, 0.44, -ridgeW * 0.5, yBase + rise + 0.26, 0, 'lacquer');
  kb.addBox(0.42, 0.52, 0.44, ridgeW * 0.5, yBase + rise + 0.26, 0, 'lacquer');

  // Eave timber fascia beams
  kb.addBox(totalW * 0.96, 0.18, 0.2, 0, yBase + 0.04, halfD - 0.12, 'timber');
  kb.addBox(totalW * 0.96, 0.18, 0.2, 0, yBase + 0.04, -halfD + 0.12, 'timber');

  // Stacked eave bracket sets (dougong-style corbel brackets) on larger buildings
  if (includeBrackets) {
    const cols = Math.max(2, Math.floor(w / 3.0));
    for (let i = 0; i <= cols; i++) {
      const bx = -w * 0.5 + (i / cols) * w;
      for (const sz of [-1, 1]) {
        const bz = sz * (d * 0.5);
        kb.addBox(0.36, 0.2, 0.65, bx, yBase - 0.12, bz + sz * 0.18, 'lacquer');
        kb.addBox(0.52, 0.18, 0.95, bx, yBase + 0.04, bz + sz * 0.28, 'timber');
      }
    }
  }
}

/**
 * Adds a wooden or stone balustrade railing along a segment.
 */
export function addRailing(
  kb: KitBuilder,
  length: number,
  x: number,
  y0: number,
  z: number,
  rotY = 0,
  materialId: ArchMaterialId = 'timber'
): void {
  const local = new KitBuilder();
  const h = 0.95;
  // Top and lower rails
  local.addBox(length, 0.1, 0.12, 0, h, 0, materialId);
  local.addBox(length, 0.08, 0.1, 0, 0.24, 0, materialId);
  const posts = Math.max(2, Math.round(length / 2.2));
  for (let i = 0; i <= posts; i++) {
    const px = -length * 0.5 + (i / posts) * length;
    local.addBox(0.14, h + 0.14, 0.14, px, (h + 0.14) * 0.5, 0, materialId);
  }
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y0, z);
  kb.addChildBuilder(local, m);
}

export type BuildingStyle = 'hall' | 'house' | 'tower' | 'pavilion' | 'workshop';

export interface BuildingOptions {
  footprint: [number, number];
  floors?: 1 | 2 | 3;
  style?: BuildingStyle;
  seed?: number;
}

/**
 * Parametric `Building({ footprint, floors, style, seed })` builder:
 * Stone plinth platform with steps, timber columns every ~3 m, warm ivory plaster infill walls,
 * timber doors, emissive lattice paper windows, eave brackets, curved tile roofs, and corner lanterns.
 */
export function buildBuildingKit(opts: BuildingOptions): KitBuilder {
  const kb = new KitBuilder();
  const seed = opts.seed ?? 101;
  const style = opts.style ?? 'house';
  const floors = opts.floors ?? 1;

  const wVar = 0.94 + seededRand(seed, 1) * 0.12;
  const dVar = 0.94 + seededRand(seed, 2) * 0.12;
  const w = opts.footprint[0] * wVar;
  const d = opts.footprint[1] * dVar;

  const plinthH = style === 'hall' || style === 'tower' ? 1.15 : 0.65;
  // 1. Stone platform plinth + entry steps on +Z
  kb.addPart(
    buildTerraceWallGeo(w + 1.1, plinthH, d + 1.1, 0.06),
    'stone',
    new THREE.Matrix4().setPosition(0, plinthH * 0.5, 0)
  );
  addStairs(kb, Math.min(2.8, w * 0.42), plinthH, 1.1, 4, 0, 0, d * 0.5 + 0.95, 0, 'stone');

  let curY = plinthH;
  const floorH = style === 'hall' ? 4.2 : style === 'tower' ? 3.8 : 3.2;

  for (let f = 0; f < floors; f++) {
    const scale = Math.pow(0.86, f);
    const fw = w * scale;
    const fd = d * scale;
    const isPavilion = style === 'pavilion';
    const isWorkshop = style === 'workshop' && f === 0;

    // Corner & perimeter columns every ~3 m
    const colsX = Math.max(2, Math.round(fw / 3.0));
    const colsZ = Math.max(2, Math.round(fd / 3.0));
    const colMat: ArchMaterialId = style === 'hall' || style === 'pavilion' ? 'lacquer' : 'timber';

    for (let ix = 0; ix <= colsX; ix++) {
      for (let iz = 0; iz <= colsZ; iz++) {
        if (ix > 0 && ix < colsX && iz > 0 && iz < colsZ) continue;
        const cx = -fw * 0.5 + (ix / colsX) * fw;
        const cz = -fd * 0.5 + (iz / colsZ) * fd;
        kb.addCylinder(0.16, 0.19, floorH, 8, cx, curY + floorH * 0.5, cz, colMat);
      }
    }

    // Ring tie beams
    kb.addBox(fw + 0.25, 0.24, fd + 0.25, 0, curY + floorH - 0.12, 0, 'timber');

    if (!isPavilion) {
      if (isWorkshop) {
        // Open front shed (+Z open), back and side plaster/timber walls
        kb.addBox(fw - 0.2, floorH - 0.2, 0.28, 0, curY + floorH * 0.5, -fd * 0.5 + 0.15, 'plaster');
        kb.addBox(0.28, floorH - 0.2, fd - 0.2, -fw * 0.5 + 0.15, curY + floorH * 0.5, 0, 'plaster');
        kb.addBox(0.28, floorH - 0.2, fd - 0.2, fw * 0.5 - 0.15, curY + floorH * 0.5, 0, 'plaster');
      } else {
        // Solid warm ivory plaster infill core
        kb.addBox(fw - 0.22, floorH - 0.2, fd - 0.22, 0, curY + floorH * 0.5, 0, 'plaster');

        // Ground floor front door (+Z)
        if (f === 0) {
          kb.addBox(1.45, 2.25, 0.32, 0, curY + 1.125, fd * 0.5 - 0.04, 'timber');
          kb.addBox(1.65, 0.18, 0.38, 0, curY + 2.3, fd * 0.5 - 0.02, 'lacquer');
        }

        // Emissive lattice paper windows on front/back & sides
        const winCountX = Math.max(1, colsX - 1);
        for (let wx = 0; wx < winCountX; wx++) {
          const xPos = -fw * 0.5 + ((wx + 0.5) / winCountX) * fw;
          if (f === 0 && Math.abs(xPos) < 1.1) continue; // Leave room for main door
          kb.addBox(1.15, 1.25, 0.3, xPos, curY + floorH * 0.56, fd * 0.5 - 0.04, 'paperWindow');
          kb.addBox(1.15, 1.25, 0.3, xPos, curY + floorH * 0.56, -fd * 0.5 + 0.04, 'paperWindow');
        }
        kb.addBox(0.3, 1.2, 1.2, -fw * 0.5 + 0.04, curY + floorH * 0.56, 0, 'paperWindow');
        kb.addBox(0.3, 1.2, 1.2, fw * 0.5 - 0.04, curY + floorH * 0.56, 0, 'paperWindow');
      }
    } else {
      // Pavilion perimeter railings with front gap
      addRailing(kb, fw, 0, curY, -fd * 0.5, 0, 'lacquer');
      addRailing(kb, fd, -fw * 0.5, curY, 0, Math.PI * 0.5, 'lacquer');
      addRailing(kb, fd, fw * 0.5, curY, 0, Math.PI * 0.5, 'lacquer');
    }

    // Intermediate skirt roof between multiple stories, or crowning top roof
    const isTop = f === floors - 1;
    const eave = isTop ? (style === 'hall' ? 1.55 : 1.05) : 0.85;
    const rise = isTop ? (style === 'hall' ? 2.4 : style === 'tower' ? 2.2 : 1.65) : 0.95;
    const curve = 0.58 + seededRand(seed, 5) * 0.2;
    const lift = isTop ? 0.52 : 0.32;

    buildCurvedRoofParts(
      kb,
      fw,
      fd,
      eave,
      rise,
      curve,
      lift,
      curY + floorH,
      style === 'hall' || style === 'tower' || floors > 1
    );

    // Corner eave lantern hooks on ground or top tier
    if (f === 0 || isTop) {
      const lx = fw * 0.5 + eave * 0.72;
      const lz = fd * 0.5 + eave * 0.72;
      const ly = curY + floorH - 0.25;
      kb.lampPositions.push(new THREE.Vector3(-lx, ly, lz), new THREE.Vector3(lx, ly, lz));
    }

    curY += floorH + (isTop ? 0 : 0.45);
  }

  return kb;
}

/**
 * Convenience wrapper returning a merged `THREE.Group` for a single building.
 */
export function Building(opts: BuildingOptions): {
  group: THREE.Group;
  builder: KitBuilder;
} {
  const builder = buildBuildingKit(opts);
  return {
    group: builder.toMergedGroup(`building-${opts.style ?? 'house'}`),
    builder,
  };
}
