import * as THREE from 'three';
import { LANDMARKS } from '../../world/bible.ts';
import { seededUnit, WORLD_SEED } from '../../world/noise.ts';
import { heightAt } from '../../world/terrainFn.ts';
import { QUALITY, type QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

/**
 * Manages:
 * 1. Falling, spinning maple leaves drifting off the Overlook cliff from the Hero Maple `(-128, 432, -556)`
 *    and courtyard maples on the wind.
 * 2. Floating ivory dust-seed motes in sunlight and slow ember fireflies near water and lanterns at dusk/night.
 * Scaled by `QUALITY[tier].particleScale` with zero per-frame heap allocation.
 */
export class LeavesAndMotes {
  public readonly group = new THREE.Group();
  private readonly leafInst: THREE.InstancedMesh;
  private readonly moteInst: THREE.InstancedMesh;
  private readonly fireflyInst: THREE.InstancedMesh;

  private readonly maxLeaves = 96;
  private readonly maxMotes = 64;
  private readonly maxFireflies = 48;

  private activeLeaves = 96;
  private activeMotes = 64;
  private activeFireflies = 48;

  constructor(initialTier: QualityTier) {
    this.group.name = 'ArkvoidLeavesAndMotes';

    // 1. Spinning falling maple leaves (#C73A0A, #E8480F, #FB5607, #F6A04D)
    const leafGeo = new THREE.PlaneGeometry(0.22, 0.22);
    const leafMat = new THREE.MeshBasicMaterial({
      color: '#FFFFFF',
      side: THREE.DoubleSide,
    });
    this.leafInst = new THREE.InstancedMesh(leafGeo, leafMat, this.maxLeaves);
    this.leafInst.frustumCulled = false;

    const palette = [
      new THREE.Color('#C73A0A'),
      new THREE.Color('#E8480F'),
      new THREE.Color('#FB5607'),
      new THREE.Color('#F6A04D'),
    ];
    for (let i = 0; i < this.maxLeaves; i++) {
      this.leafInst.setColorAt(i, palette[i % palette.length]);
    }
    if (this.leafInst.instanceColor) this.leafInst.instanceColor.needsUpdate = true;

    // 2. Floating warm ivory dust-seed motes in sunlight
    const moteGeo = new THREE.OctahedronGeometry(0.032, 0);
    const moteMat = new THREE.MeshBasicMaterial({
      color: '#F7EBD6',
      transparent: true,
      opacity: 0.65,
    });
    this.moteInst = new THREE.InstancedMesh(moteGeo, moteMat, this.maxMotes);
    this.moteInst.frustumCulled = false;

    // 3. Dusk & Night slow ember fireflies near water & lanterns (#FB5607 / #FF9552)
    const fireflyGeo = new THREE.OctahedronGeometry(0.048, 0);
    const fireflyMat = new THREE.MeshBasicMaterial({
      color: '#FB5607',
    });
    this.fireflyInst = new THREE.InstancedMesh(fireflyGeo, fireflyMat, this.maxFireflies);
    this.fireflyInst.frustumCulled = false;

    this.group.add(this.leafInst, this.moteInst, this.fireflyInst);
    this.setQualityTier(initialTier);
  }

  public setQualityTier(tier: QualityTier): void {
    const scale = QUALITY[tier].particleScale;
    this.activeLeaves = Math.max(12, Math.round(this.maxLeaves * scale));
    this.activeMotes = Math.max(8, Math.round(this.maxMotes * scale));
    this.activeFireflies = Math.max(8, Math.round(this.maxFireflies * scale));

    this.leafInst.count = this.activeLeaves;
    this.moteInst.count = this.activeMotes;
    this.fireflyInst.count = this.activeFireflies;
  }

  public update(realSeconds: number, playerPos: THREE.Vector3): void {
    const windX = U.uWindDir.value.x * U.uWindStrength.value;
    const windZ = U.uWindDir.value.y * U.uWindStrength.value;
    const [hx, , hz] = LANDMARKS.heroMaple;
    const hy = heightAt(hx, hz);

    // 1. Update falling maple leaves (70% around the Hero Overlook Maple drifting off the cliff, 30% around Courtyard maples)
    for (let i = 0; i < this.activeLeaves; i++) {
      const r1 = seededUnit(i * 5 + 1, WORLD_SEED + 313);
      const r2 = seededUnit(i * 5 + 2, WORLD_SEED + 313);
      const r3 = seededUnit(i * 5 + 3, WORLD_SEED + 313);

      const cycle = (realSeconds * (0.09 + r1 * 0.06) + r2) % 1;
      const isHero = i < this.activeLeaves * 0.72;

      const originX = isHero ? hx : 48;
      const originY = isHero ? hy + 8.5 : 146.0;
      const originZ = isHero ? hz : 14;

      const spreadAngle = r3 * Math.PI * 2;
      const spreadRad = 1.5 + r1 * 4.5;
      const driftTime = cycle * 14.0;

      const lx =
        originX +
        Math.cos(spreadAngle) * spreadRad +
        windX * driftTime * 2.2 +
        Math.sin(realSeconds * 1.8 + i) * 0.75;
      const ly = originY - cycle * (isHero ? 26.0 : 8.5);
      const lz =
        originZ +
        Math.sin(spreadAngle) * spreadRad +
        windZ * driftTime * 2.2 +
        Math.cos(realSeconds * 1.5 + i) * 0.75;

      _pos.set(lx, ly, lz);
      _euler.set(
        realSeconds * (1.8 + r1) + i,
        realSeconds * (2.2 + r2) + i * 0.5,
        Math.sin(realSeconds * 2.5 + i) * 0.9
      );
      _quat.setFromEuler(_euler);
      const s = 0.75 + r3 * 0.65;
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      this.leafInst.setMatrixAt(i, _mat4);
    }
    this.leafInst.instanceMatrix.needsUpdate = true;

    // 2. Floating ivory dust-seed motes around the player in sunlight
    const sunPresence = 1.0 - U.uNightWeight.value * 0.85;
    for (let i = 0; i < this.activeMotes; i++) {
      const u1 = seededUnit(i * 3 + 11, WORLD_SEED + 617);
      const u2 = seededUnit(i * 3 + 12, WORLD_SEED + 617);
      const u3 = seededUnit(i * 3 + 13, WORLD_SEED + 617);

      const angle = u1 * Math.PI * 2 + realSeconds * 0.08;
      const rad = 2.0 + u2 * 16.0;
      const mx = playerPos.x + Math.cos(angle) * rad + Math.sin(realSeconds * 0.7 + i) * 0.5;
      const mz = playerPos.z + Math.sin(angle) * rad + Math.cos(realSeconds * 0.6 + i) * 0.5;
      const my =
        playerPos.y -
        0.4 +
        u3 * 3.8 +
        Math.sin(realSeconds * 0.9 + i * 1.7) * 0.45;

      _pos.set(mx, my, mz);
      _quat.identity();
      const s = (0.6 + u1 * 0.7) * sunPresence;
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      this.moteInst.setMatrixAt(i, _mat4);
    }
    this.moteInst.instanceMatrix.needsUpdate = true;

    // 3. Slow ember fireflies at dusk & night near the courtyard lanterns, waterfall, and Valley Lake
    const lampStrength = U.uNightLamp.value;
    const lakeX = LANDMARKS.valleyLake.center[0];
    const lakeZ = LANDMARKS.valleyLake.center[1];

    for (let i = 0; i < this.activeFireflies; i++) {
      const f1 = seededUnit(i * 4 + 1, WORLD_SEED + 823);
      const f2 = seededUnit(i * 4 + 2, WORLD_SEED + 823);
      const f3 = seededUnit(i * 4 + 3, WORLD_SEED + 823);

      // Half near East Gate / Courtyard lanterns & brazier, half near Valley Lake & stream
      const nearTown = i % 2 === 0;
      const cx = nearTown ? 48 + (f1 - 0.5) * 32 : lakeX + (f1 - 0.5) * 90;
      const cz = nearTown ? (f2 - 0.5) * 28 : lakeZ + (f2 - 0.5) * 90;
      const baseY = heightAt(cx, cz);

      const fx = cx + Math.sin(realSeconds * 0.85 + i * 2.1) * 1.4;
      const fz = cz + Math.cos(realSeconds * 0.75 + i * 1.7) * 1.4;
      const fy = baseY + 0.65 + f3 * 1.8 + Math.sin(realSeconds * 1.4 + i) * 0.35;

      const pulse = 0.45 + 0.55 * Math.sin(realSeconds * 3.1 + i * 1.9);
      const s = lampStrength * pulse * (0.8 + f1 * 0.6);

      _pos.set(fx, fy, fz);
      _quat.identity();
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      this.fireflyInst.setMatrixAt(i, _mat4);
    }
    this.fireflyInst.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.leafInst.geometry.dispose();
    (this.leafInst.material as THREE.Material).dispose();
    this.moteInst.geometry.dispose();
    (this.moteInst.material as THREE.Material).dispose();
    this.fireflyInst.geometry.dispose();
    (this.fireflyInst.material as THREE.Material).dispose();
  }
}
