import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDMARKS } from '../../world/bible.ts';
import { seededUnit, valueNoise2D, WORLD_SEED } from '../../world/noise.ts';
import { heightAt } from '../../world/terrainFn.ts';
import { patchMaterial } from '../fog.ts';
import { isHeadlessBrowser, QUALITY, type QualityTier } from '../Quality.ts';
import type { ColliderGrid } from './Colliders.ts';
import {
  buildVegCellData,
  type VegCellRequest,
  type VegCellResult,
} from './veg.worker.ts';

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

function setVertexColor(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const col = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Builds the 12..22 m olive-ink Conifer Pine mesh (trunk + 5 noise-displaced skirt cones, ~300 tris).
 */
function buildPineNearGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.42, 6.5, 7).toNonIndexed();
  trunk.translate(0, 3.25, 0);
  parts.push(setVertexColor(trunk, '#2E241D'));

  const skirtPalette = ['#47432B', '#544F33', '#5F593A', '#696240', '#746C47'];
  for (let s = 0; s < 5; s++) {
    const frac = s / 4;
    const radius = 3.2 - frac * 1.95;
    const height = 3.8 - frac * 1.1;
    const yCenter = 4.6 + s * 2.15;
    const cone = new THREE.ConeGeometry(radius, height, 10, 2).toNonIndexed();
    cone.translate(0, yCenter, 0);

    // Displace skirt vertices deterministically so the silhouette looks hand-painted
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const n = valueNoise2D(vx * 0.9 + s * 3.1, vz * 0.9 - vy * 0.4, WORLD_SEED + s * 19);
      pos.setXYZ(i, vx + n * 0.24, vy + n * 0.16, vz + n * 0.24);
    }
    cone.computeVertexNormals();
    parts.push(setVertexColor(cone, skirtPalette[s]));
  }

  return mergeGeometries(parts, false)!;
}

/**
 * Builds two crossed quads for distant (> 160 m) pine silhouettes.
 */
function buildPineFarBillboardGeometry(): THREE.BufferGeometry {
  const p1 = new THREE.PlaneGeometry(5.8, 14.5).toNonIndexed();
  p1.translate(0, 7.25, 0);
  const p2 = new THREE.PlaneGeometry(5.8, 14.5).toNonIndexed();
  p2.rotateY(Math.PI / 2);
  p2.translate(0, 7.25, 0);
  const merged = mergeGeometries([p1, p2], false)!;
  return setVertexColor(merged, '#575236');
}

function buildPineSilhouetteTexture(): THREE.DataTexture {
  const size = 64;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size; // 0 at bottom, 1 at top
    for (let x = 0; x < size; x++) {
      const u = (x / size - 0.5) * 2; // -1..1
      const p4 = (y * size + x) * 4;
      let alpha = 0;
      let r = 82,
        g = 77,
        b = 51;
      if (v < 0.24 && Math.abs(u) < 0.09) {
        alpha = 255;
        r = 46;
        g = 36;
        b = 29;
      } else if (v >= 0.18 && v < 0.95) {
        const tierWave = Math.sin(v * 18) * 0.08;
        const maxHalfW = (1 - (v - 0.18) / 0.8) * 0.78 + tierWave;
        if (Math.abs(u) < maxHalfW) {
          alpha = 255;
          r = Math.round(72 + v * 28);
          g = Math.round(68 + v * 26);
          b = Math.round(44 + v * 18);
        }
      }
      bytes[p4] = r;
      bytes[p4 + 1] = g;
      bytes[p4 + 2] = b;
      bytes[p4 + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the 8..14 m Ancient Broadleaf tree geometry (curved trunk with root flare + clusters of olive/ochre leaf cards).
 */
function buildBroadleafGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.28, 2.1, -0.18),
    new THREE.Vector3(-0.22, 4.4, 0.25),
    new THREE.Vector3(0.15, 6.6, 0.08),
  ]);
  const trunk = new THREE.TubeGeometry(curve, 8, 0.36, 7, false).toNonIndexed();
  parts.push(setVertexColor(trunk, '#342820'));

  const flare = new THREE.ConeGeometry(0.82, 1.4, 7).toNonIndexed();
  flare.translate(0, 0.7, 0);
  parts.push(setVertexColor(flare, '#2D221B'));

  const leafColors = ['#7A7345', '#8E844F', '#9E9056', '#69643B'];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const rad = 1.1 + (i % 4) * 0.65;
    const h = 5.4 + (i % 5) * 0.85;
    const cluster = new THREE.IcosahedronGeometry(1.45 - (i % 3) * 0.22, 1);
    cluster.scale(1.25, 0.68, 1.25);
    cluster.translate(Math.cos(a) * rad, h, Math.sin(a) * rad);
    parts.push(setVertexColor(cluster, leafColors[i % leafColors.length]));
  }

  return mergeGeometries(parts, false)!;
}

/**
 * Builds an instanced Ember-Red Maple geometry (`#C73A0A`, `#E8480F`, `#FB5607`, `#F6A04D`).
 */
function buildInstancedMapleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.2, 1.8, 0.14),
    new THREE.Vector3(-0.18, 3.6, -0.12),
    new THREE.Vector3(0.1, 5.2, 0.05),
  ]);
  const trunk = new THREE.TubeGeometry(curve, 7, 0.28, 6, false).toNonIndexed();
  parts.push(setVertexColor(trunk, '#271E19'));

  const maplePalette = ['#C73A0A', '#E8480F', '#FB5607', '#F6A04D'];
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996;
    const r = 0.8 + (i % 4) * 0.55;
    const y = 4.2 + (i % 4) * 0.72;
    const puff = new THREE.IcosahedronGeometry(1.25 - (i % 3) * 0.18, 1);
    puff.scale(1.3, 0.64, 1.3);
    puff.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    parts.push(setVertexColor(puff, maplePalette[i % maplePalette.length]));
  }
  return mergeGeometries(parts, false)!;
}

/**
 * Builds the Hero Maple at `(-128, 432, -556)` on the Overlook:
 * - Thick twisting trunk + exposed roots reaching the cliff edge + gnarled boughs
 * - ~3,000 leaf cards (~20,000 triangles on desktop, scaled cleanly on headless) in `#C73A0A`, `#E8480F`, `#FB5607`, and `#F6A04D`.
 */
function buildHeroOverlookMaple(isHeadless: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'HeroOverlookMaple';
  const [hx, , hz] = LANDMARKS.heroMaple;
  const hy = heightAt(hx, hz);
  group.position.set(hx, hy, hz);

  const barkMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: '#261C17',
      roughness: 0.86,
      metalness: 0.04,
    })
  );

  // Thick twisting main trunk
  const mainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(0.45, 2.2, -0.35),
    new THREE.Vector3(-0.55, 4.8, 0.42),
    new THREE.Vector3(0.35, 7.4, -0.25),
    new THREE.Vector3(0.0, 9.6, 0.15),
  ]);
  const trunkMesh = new THREE.Mesh(
    new THREE.TubeGeometry(mainCurve, 20, 0.78, 12, false),
    barkMat
  );
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  group.add(trunkMesh);

  // 6 exposed roots reaching toward the Overlook cliff edge
  for (let r = 0; r < 6; r++) {
    const a = (r / 6) * Math.PI * 2 + 0.25;
    const rootCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 0.4, 1.4, Math.sin(a) * 0.4),
      new THREE.Vector3(Math.cos(a) * 1.6, 0.45, Math.sin(a) * 1.6),
      new THREE.Vector3(Math.cos(a) * 3.1, -0.25, Math.sin(a) * 3.1),
    ]);
    const rootMesh = new THREE.Mesh(
      new THREE.TubeGeometry(rootCurve, 10, 0.28, 7, false),
      barkMat
    );
    rootMesh.castShadow = true;
    group.add(rootMesh);
  }

  // 5 sweeping main boughs
  const boughTips: THREE.Vector3[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + 0.4;
    const tip = new THREE.Vector3(
      Math.cos(a) * (4.2 + (b % 2) * 1.2),
      8.2 + (b % 3) * 1.3,
      Math.sin(a) * (4.2 + (b % 2) * 1.2)
    );
    boughTips.push(tip);
    const bCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 5.8 + b * 0.5, 0),
      new THREE.Vector3(tip.x * 0.55, tip.y - 0.8, tip.z * 0.55),
      tip,
    ]);
    const bMesh = new THREE.Mesh(
      new THREE.TubeGeometry(bCurve, 10, 0.32, 8, false),
      barkMat
    );
    bMesh.castShadow = true;
    group.add(bMesh);
  }

  // ~3,000 leaf cards (2 triangles per card => ~6,000..18,000 triangles) in a single InstancedMesh
  const leafCardCount = isHeadless ? 450 : 3000;
  const cardGeo = new THREE.PlaneGeometry(0.62, 0.62, 2, 1);
  const leafMat = patchMaterial(
    new THREE.MeshStandardMaterial({
      color: '#FFFFFF',
      roughness: 0.52,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    { enableWind: true }
  );

  const leafInst = new THREE.InstancedMesh(cardGeo, leafMat, leafCardCount);
  leafInst.castShadow = true;
  leafInst.receiveShadow = true;

  const palette = [
    new THREE.Color('#C73A0A'),
    new THREE.Color('#E8480F'),
    new THREE.Color('#FB5607'),
    new THREE.Color('#F6A04D'),
  ];

  for (let i = 0; i < leafCardCount; i++) {
    const center = boughTips[i % boughTips.length];
    const u1 = seededUnit(i * 5 + 1, WORLD_SEED + 999);
    const u2 = seededUnit(i * 5 + 2, WORLD_SEED + 999);
    const u3 = seededUnit(i * 5 + 3, WORLD_SEED + 999);
    const u4 = seededUnit(i * 5 + 4, WORLD_SEED + 999);

    const theta = u1 * Math.PI * 2;
    const phi = Math.acos(2 * u2 - 1);
    const rad = Math.cbrt(u3) * 3.4;

    _pos.set(
      center.x + Math.sin(phi) * Math.cos(theta) * rad,
      center.y + Math.cos(phi) * rad * 0.62,
      center.z + Math.sin(phi) * Math.sin(theta) * rad
    );
    _euler.set((u2 - 0.5) * 1.4, u1 * Math.PI * 2, (u3 - 0.5) * 1.2);
    _quat.setFromEuler(_euler);
    const s = 0.75 + u4 * 0.75;
    _scale.set(s, s, s);
    _mat4.compose(_pos, _quat, _scale);
    leafInst.setMatrixAt(i, _mat4);

    const colIdx = u4 > 0.88 ? 3 : i % 3;
    leafInst.setColorAt(i, palette[colIdx]);
  }

  leafInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  leafInst.computeBoundingSphere();
  group.add(leafInst);

  group.traverse((c) => c.layers.enable(2));
  return group;
}

function buildReedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const stalk = new THREE.CylinderGeometry(0.02, 0.04, 1.8 + (i % 2) * 0.4, 5).toNonIndexed();
    stalk.translate((i - 1.5) * 0.14, 0.9, ((i * 3) % 2 - 0.5) * 0.14);
    parts.push(setVertexColor(stalk, '#8C8350'));
  }
  return mergeGeometries(parts, false)!;
}

function buildShrubGeometry(): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(0.68, 1);
  geo.scale(1.25, 0.62, 1.25);
  geo.translate(0, 0.35, 0);
  return setVertexColor(geo, '#68643D');
}

function buildRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.05, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const colUnder = new THREE.Color('#241E1A');
  const colMid = new THREE.Color('#5A5046');
  const colMossTop = new THREE.Color('#6D6942');

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = valueNoise2D(vx * 1.7 + vy, vz * 1.7 - vx, WORLD_SEED + 444);
    const nx = vx * (1 + n * 0.22);
    const ny = vy * (0.78 + n * 0.18);
    const nz = vz * (1 + n * 0.22);
    pos.setXYZ(i, nx, ny + 0.35, nz);

    // Cavity AO underside + moss on top
    const c = colMid.clone();
    if (vy < -0.15) c.lerp(colUnder, Math.min(1, (-0.15 - vy) * 1.4));
    if (vy > 0.35) c.lerp(colMossTop, Math.min(1, (vy - 0.35) * 1.2));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildWildflowerGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.015, 0.02, 0.36, 4).toNonIndexed();
  stem.translate(0, 0.18, 0);
  setVertexColor(stem, '#6E6A40');

  const bloom = new THREE.OctahedronGeometry(0.11, 0);
  bloom.scale(1.2, 0.55, 1.2);
  bloom.translate(0, 0.38, 0);
  setVertexColor(bloom, '#FB5607');

  return mergeGeometries([stem, bloom], false)!;
}

/**
 * Manages cell-based streaming vegetation, rocks, wildflowers, and the Hero Overlook Maple,
 * registering trunk and boulder colliders into `ColliderGrid`.
 */
export class WorldVegetation {
  public readonly group = new THREE.Group();
  private readonly colliderGrid: ColliderGrid;
  private tier: QualityTier;
  private readonly isHeadless: boolean;
  private worker: Worker | null = null;

  private readonly activeCells = new Map<string, VegCellResult>();
  private readonly inFlightCells = new Set<string>();
  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;
  private instanceMatricesDirty = true;

  private readonly pineNearInst: THREE.InstancedMesh;
  private readonly pineFarInst: THREE.InstancedMesh;
  private readonly broadleafInst: THREE.InstancedMesh;
  private readonly mapleInst: THREE.InstancedMesh;
  private readonly reedInst: THREE.InstancedMesh;
  private readonly shrubInst: THREE.InstancedMesh;
  private readonly rockInst: THREE.InstancedMesh;
  private readonly flowerInst: THREE.InstancedMesh;
  private readonly heroMaple: THREE.Group;
  private readonly pineSilTex: THREE.DataTexture;

  constructor(initialTier: QualityTier, colliderGrid: ColliderGrid) {
    this.tier = initialTier;
    this.colliderGrid = colliderGrid;
    this.isHeadless = isHeadlessBrowser();
    this.group.name = 'ArkvoidVegetation';

    const foliageMat = patchMaterial(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.78,
        metalness: 0.03,
      }),
      { enableWind: true }
    );

    const staticVertexMat = patchMaterial(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.04,
      })
    );

    this.pineSilTex = buildPineSilhouetteTexture();
    const billboardMat = patchMaterial(
      new THREE.MeshStandardMaterial({
        map: this.pineSilTex,
        alphaTest: 0.45,
        roughness: 0.85,
        side: THREE.DoubleSide,
      })
    );

    this.pineNearInst = new THREE.InstancedMesh(buildPineNearGeometry(), foliageMat, 600);
    this.pineNearInst.castShadow = true;
    this.pineNearInst.receiveShadow = true;
    this.pineNearInst.frustumCulled = false;

    this.pineFarInst = new THREE.InstancedMesh(
      buildPineFarBillboardGeometry(),
      billboardMat,
      900
    );
    this.pineFarInst.frustumCulled = false;

    this.broadleafInst = new THREE.InstancedMesh(buildBroadleafGeometry(), foliageMat, 350);
    this.broadleafInst.castShadow = true;
    this.broadleafInst.receiveShadow = true;
    this.broadleafInst.frustumCulled = false;

    this.mapleInst = new THREE.InstancedMesh(buildInstancedMapleGeometry(), foliageMat, 160);
    this.mapleInst.castShadow = true;
    this.mapleInst.receiveShadow = true;
    this.mapleInst.frustumCulled = false;

    this.reedInst = new THREE.InstancedMesh(buildReedGeometry(), foliageMat, 400);
    this.reedInst.frustumCulled = false;

    this.shrubInst = new THREE.InstancedMesh(buildShrubGeometry(), foliageMat, 500);
    this.shrubInst.frustumCulled = false;

    this.rockInst = new THREE.InstancedMesh(buildRockGeometry(), staticVertexMat, 450);
    this.rockInst.castShadow = true;
    this.rockInst.receiveShadow = true;
    this.rockInst.frustumCulled = false;

    this.flowerInst = new THREE.InstancedMesh(buildWildflowerGeometry(), foliageMat, 350);
    this.flowerInst.frustumCulled = false;

    this.group.add(
      this.pineNearInst,
      this.pineFarInst,
      this.broadleafInst,
      this.mapleInst,
      this.reedInst,
      this.shrubInst,
      this.rockInst,
      this.flowerInst
    );

    // Hero Overlook Maple at (-128, 432, -556) + trunk collider
    this.heroMaple = buildHeroOverlookMaple(this.isHeadless);
    this.group.add(this.heroMaple);
    this.colliderGrid.addBatch('hero_maple', [
      {
        kind: 'circle',
        id: 'hero_maple_trunk',
        x: LANDMARKS.heroMaple[0],
        z: LANDMARKS.heroMaple[2],
        radius: 1.15,
        tag: 'trunk',
      },
    ]);

    // Curated Courtyard & East Gate Maples so the opening vista has signature ember foliage
    this.colliderGrid.addBatch('curated_town_trees', [
      { kind: 'circle', id: 'court_maple_1', x: 48, z: 14, radius: 0.65, tag: 'trunk' },
      { kind: 'circle', id: 'court_maple_2', x: 26, z: -15, radius: 0.65, tag: 'trunk' },
    ]);

    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined' || this.isHeadless) return;
    try {
      this.worker = new Worker(new URL('./veg.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<VegCellResult>) => {
        this.inFlightCells.delete(e.data.cellKey);
        this.activeCells.set(e.data.cellKey, e.data);
        this.colliderGrid.addBatch(`veg_${e.data.cellKey}`, e.data.colliders);
        this.instanceMatricesDirty = true;
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  public setQualityTier(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.tier = tier;
    this.lastCellX = Number.NaN;
    this.instanceMatricesDirty = true;
  }

  public update(playerPos: THREE.Vector3): void {
    const cellSize = 128;
    const pcx = Math.floor(playerPos.x / cellSize);
    const pcz = Math.floor(playerPos.z / cellSize);

    if (pcx !== this.lastCellX || pcz !== this.lastCellZ) {
      this.lastCellX = pcx;
      this.lastCellZ = pcz;
      this.reconcileCells(pcx, pcz);
      this.instanceMatricesDirty = true;
    }

    if (this.instanceMatricesDirty) {
      this.rebuildInstanceBuffers(playerPos);
      this.instanceMatricesDirty = false;
    }
  }

  private reconcileCells(pcx: number, pcz: number): void {
    const cellSize = 128;
    const radiusCells = this.isHeadless ? 2 : this.tier === 'low' ? 2 : 3;
    const desired = new Set<string>();
    const cfg = QUALITY[this.tier];

    for (let dz = -radiusCells; dz <= radiusCells; dz++) {
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        if (dx * dx + dz * dz > radiusCells * radiusCells + 1) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = `${cx}:${cz}`;
        desired.add(key);

        if (!this.activeCells.has(key) && !this.inFlightCells.has(key)) {
          const req: VegCellRequest = {
            cellKey: key,
            cx,
            cz,
            cellSize,
            treeDensity: cfg.treeDensity,
          };
          if (this.worker) {
            this.inFlightCells.add(key);
            this.worker.postMessage(req);
          } else {
            const res = buildVegCellData(req);
            this.activeCells.set(key, res);
            this.colliderGrid.addBatch(`veg_${key}`, res.colliders);
          }
        }
      }
    }

    for (const key of this.activeCells.keys()) {
      if (!desired.has(key)) {
        this.activeCells.delete(key);
        this.colliderGrid.removeBatch(`veg_${key}`);
      }
    }
  }

  private rebuildInstanceBuffers(playerPos: THREE.Vector3): void {
    let pineNearCount = 0;
    let pineFarCount = 0;
    let broadleafCount = 0;
    let mapleCount = 0;
    let reedCount = 0;
    let shrubCount = 0;
    let rockCount = 0;
    let flowerCount = 0;

    // Always place the 3 signature Courtyard & East Gate Maples first
    const fixedMaples: ReadonlyArray<[number, number, number, number]> = [
      [48, 14, 1.15, 0.4],
      [26, -15, 1.0, 1.9],
      [78, 18, 1.1, 3.1],
    ];
    for (const [mx, mz, ms, mrot] of fixedMaples) {
      if (mapleCount < this.mapleInst.instanceMatrix.count) {
        _pos.set(mx, heightAt(mx, mz), mz);
        _euler.set(0, mrot, 0);
        _quat.setFromEuler(_euler);
        _scale.set(ms, ms, ms);
        _mat4.compose(_pos, _quat, _scale);
        this.mapleInst.setMatrixAt(mapleCount++, _mat4);
      }
    }

    const pushPacked = (
      arr: Float32Array,
      mesh: THREE.InstancedMesh,
      currentCount: number,
      maxDistSq: number
    ): number => {
      const cap = mesh.instanceMatrix.count;
      for (let i = 0; i < arr.length && currentCount < cap; i += 5) {
        const x = arr[i];
        const y = arr[i + 1];
        const z = arr[i + 2];
        const dSq = (x - playerPos.x) * (x - playerPos.x) + (z - playerPos.z) * (z - playerPos.z);
        if (dSq > maxDistSq) continue;
        const s = arr[i + 3];
        const rot = arr[i + 4];
        _pos.set(x, y, z);
        _euler.set(0, rot, 0);
        _quat.setFromEuler(_euler);
        _scale.set(s, s, s);
        _mat4.compose(_pos, _quat, _scale);
        mesh.setMatrixAt(currentCount++, _mat4);
      }
      return currentCount;
    };

    const nearPineDistSq = 160 * 160;
    const shrubDistSq = 65 * 65;

    for (const cell of this.activeCells.values()) {
      // Split pines at 160 m between 3D skirted geometry and crossed alpha silhouette quads
      for (let i = 0; i < cell.pines.length; i += 5) {
        const x = cell.pines[i];
        const y = cell.pines[i + 1];
        const z = cell.pines[i + 2];
        const s = cell.pines[i + 3];
        const rot = cell.pines[i + 4];
        const dSq =
          (x - playerPos.x) * (x - playerPos.x) + (z - playerPos.z) * (z - playerPos.z);

        _pos.set(x, y, z);
        _euler.set(0, rot, 0);
        _quat.setFromEuler(_euler);
        _scale.set(s, s, s);
        _mat4.compose(_pos, _quat, _scale);

        if (dSq <= nearPineDistSq && pineNearCount < this.pineNearInst.instanceMatrix.count) {
          this.pineNearInst.setMatrixAt(pineNearCount++, _mat4);
        } else if (pineFarCount < this.pineFarInst.instanceMatrix.count) {
          this.pineFarInst.setMatrixAt(pineFarCount++, _mat4);
        }
      }

      broadleafCount = pushPacked(
        cell.broadleafs,
        this.broadleafInst,
        broadleafCount,
        280 * 280
      );
      mapleCount = pushPacked(cell.maples, this.mapleInst, mapleCount, 300 * 300);
      reedCount = pushPacked(cell.reeds, this.reedInst, reedCount, 180 * 180);
      shrubCount = pushPacked(cell.shrubs, this.shrubInst, shrubCount, shrubDistSq);
      rockCount = pushPacked(cell.rocks, this.rockInst, rockCount, 340 * 340);
      flowerCount = pushPacked(cell.wildflowers, this.flowerInst, flowerCount, 90 * 90);
    }

    const commit = (m: THREE.InstancedMesh, count: number) => {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
    };

    commit(this.pineNearInst, pineNearCount);
    commit(this.pineFarInst, pineFarCount);
    commit(this.broadleafInst, broadleafCount);
    commit(this.mapleInst, mapleCount);
    commit(this.reedInst, reedCount);
    commit(this.shrubInst, shrubCount);
    commit(this.rockInst, rockCount);
    commit(this.flowerInst, flowerCount);
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pineSilTex.dispose();
    const all = [
      this.pineNearInst,
      this.pineFarInst,
      this.broadleafInst,
      this.mapleInst,
      this.reedInst,
      this.shrubInst,
      this.rockInst,
      this.flowerInst,
    ];
    for (const m of all) {
      m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach((mat) => mat.dispose());
      } else {
        m.material.dispose();
      }
    }
  }
}
