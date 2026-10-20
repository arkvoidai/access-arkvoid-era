import * as THREE from 'three';
import type { QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';

export type LampState = 'lit' | 'dim' | 'dark' | 'ember';

export interface LampSpec {
  position: [number, number, number] | THREE.Vector3;
  size?: number;
  colour?: number | string;
  state?: LampState;
  id?: string;
  slotGroup?: string;
  hasGroundPool?: boolean;
}

interface LampRecord {
  index: number;
  id: string;
  slotGroup?: string;
  position: THREE.Vector3;
  size: number;
  color: THREE.Color;
  state: LampState;
  phase: number;
  hasGroundPool: boolean;
  poolIndex: number;
}

interface PooledPointLight {
  light: THREE.PointLight;
  assignedLampIdx: number;
  currentWeight: number;
}

/**
 * Instanced Lantern System (`Lamps.ts` — Prompt 5 Section 3):
 * - All lantern bodies are 1 instanced mesh (emissive intensity driven by `uNightLamp` + per-instance phase).
 * - All additive glow halos are 1 billboarded instanced mesh.
 * - Soft ground light pools below larger lamps are 1 instanced mesh.
 * - Real `PointLight` pool: only the nearest `N` lamps get a real light (`high: 8`, `mid: 4`, `low: 0`),
 *   reassigned every 200 ms with smooth intensity fade and zero shadow casting.
 * - Reserves 12 promise-lantern hooks along the upper terrace railing (`slots('promise')`).
 */
export class LanternSystem {
  public readonly group = new THREE.Group();
  private readonly records: LampRecord[] = [];
  private readonly byId = new Map<string, LampRecord>();
  private readonly bySlot = new Map<string, LampRecord[]>();

  private readonly maxLamps: number;
  private readonly maxPools: number;

  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly haloMesh: THREE.InstancedMesh;
  private readonly poolMesh: THREE.InstancedMesh;

  private readonly bodyStateAttr: THREE.InstancedBufferAttribute;
  private readonly haloStateAttr: THREE.InstancedBufferAttribute;
  private readonly poolStateAttr: THREE.InstancedBufferAttribute;

  private readonly pointLights: PooledPointLight[] = [];
  private activeLightBudget = 8;
  private lastReassignTime = -10;
  private poolCount = 0;

  public constructor(maxLamps = 512, maxPools = 192) {
    this.maxLamps = maxLamps;
    this.maxPools = maxPools;
    this.group.name = 'LanternSystem';

    // 1. Paper-and-iron lantern body geometry
    const bodyGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.44, 8, 1);
    const bodyStateArray = new Float32Array(maxLamps * 4); // x: stateMult, y: phase, z: size, w: alwaysLit
    this.bodyStateAttr = new THREE.InstancedBufferAttribute(bodyStateArray, 4);
    bodyGeo.setAttribute('aLampMeta', this.bodyStateAttr);

    const bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uNightLamp: U.uNightLamp,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uAltitude01: U.uAltitude01,
        uCamPos: U.uCamPos,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aLampMeta;
        varying vec4 vLampMeta;
        varying vec3 vNormalLocal;
        varying vec3 vWorldPos;
        void main() {
          vLampMeta = aLampMeta;
          vNormalLocal = normal;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightLamp;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uAltitude01;
        uniform vec3 uCamPos;
        varying vec4 vLampMeta;
        varying vec3 vNormalLocal;
        varying vec3 vWorldPos;

        void main() {
          float stateMult = vLampMeta.x;
          float phase = vLampMeta.y;
          float alwaysLit = vLampMeta.w;

          // Iron cap and base rims at top/bottom of cylinder
          float rimMask = step(0.76, abs(vNormalLocal.y));
          float flicker = 0.88 + 0.12 * sin(uTime * 3.4 + phase * 6.2831);
          float nightDrive = max(uNightLamp, alwaysLit * 0.85);
          float glow = stateMult * nightDrive * flicker;

          vec3 ironCol = vec3(0.16, 0.15, 0.14);
          vec3 unlitPaper = vec3(0.76, 0.71, 0.63);
          vec3 coreCol = vec3(1.0, 0.698, 0.478); // #FFB27A
          vec3 edgeCol = vec3(0.984, 0.337, 0.027); // #FB5607

          vec3 paperCol = mix(unlitPaper * (0.45 + 0.55 * stateMult), mix(edgeCol, coreCol, 0.65) * 2.2, glow);
          vec3 col = mix(paperCol, ironCol, rimMask);

          float dist = length(vWorldPos - uCamPos);
          float effDensity = uFogDensity * clamp(1.0 - uAltitude01, 0.0, 1.0);
          float fogFactor = clamp(1.0 - exp(-(effDensity * dist) * (effDensity * dist)), 0.0, 0.92);
          col = mix(col, uFogColor, fogFactor * (1.0 - glow * 0.45));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, maxLamps);
    this.bodyMesh.count = 0;
    this.bodyMesh.frustumCulled = false;
    this.group.add(this.bodyMesh);

    // 2. Additive billboarded glow sprite quad per lamp
    const haloGeo = new THREE.PlaneGeometry(1.6, 1.6);
    const haloStateArray = new Float32Array(maxLamps * 4);
    this.haloStateAttr = new THREE.InstancedBufferAttribute(haloStateArray, 4);
    haloGeo.setAttribute('aHaloMeta', this.haloStateAttr);

    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uNightLamp: U.uNightLamp,
        uCamPos: U.uCamPos,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aHaloMeta;
        varying vec2 vUv;
        varying vec4 vHaloMeta;
        varying float vDist;
        void main() {
          vUv = uv;
          vHaloMeta = aHaloMeta;
          vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          vDist = length(center - uCamPos);
          float scale = aHaloMeta.z * (1.1 + clamp(vDist * 0.008, 0.0, 2.8));

          // Camera-facing billboard basis
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 worldPos = center + (right * position.x + up * position.y) * scale;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightLamp;
        varying vec2 vUv;
        varying vec4 vHaloMeta;
        varying float vDist;

        void main() {
          float stateMult = vHaloMeta.x;
          if (stateMult <= 0.01) discard;
          float phase = vHaloMeta.y;
          float alwaysLit = vHaloMeta.w;
          float nightDrive = max(uNightLamp, alwaysLit * 0.85);
          if (nightDrive <= 0.01) discard;

          float r = length(vUv - 0.5) * 2.0;
          if (r >= 1.0) discard;

          float falloff = pow(1.0 - r, 2.4);
          float flicker = 0.9 + 0.1 * sin(uTime * 3.4 + phase * 6.2831);
          vec3 core = vec3(1.0, 0.698, 0.478); // #FFB27A
          vec3 edge = vec3(0.984, 0.337, 0.027); // #FB5607
          vec3 col = mix(edge, core, 1.0 - r * 0.75) * falloff * stateMult * nightDrive * flicker * 0.95;

          gl_FragColor = vec4(col, falloff * stateMult * nightDrive);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, maxLamps);
    this.haloMesh.count = 0;
    this.haloMesh.frustumCulled = false;
    this.group.add(this.haloMesh);

    // 3. Soft light pool quad on the ground below larger lamps
    const poolGeo = new THREE.PlaneGeometry(4.2, 4.2);
    poolGeo.rotateX(-Math.PI * 0.5);
    const poolStateArray = new Float32Array(maxPools * 4);
    this.poolStateAttr = new THREE.InstancedBufferAttribute(poolStateArray, 4);
    poolGeo.setAttribute('aPoolMeta', this.poolStateAttr);

    const poolMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uNightLamp: U.uNightLamp,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPoolMeta;
        varying vec2 vUv;
        varying vec4 vPoolMeta;
        void main() {
          vUv = uv;
          vPoolMeta = aPoolMeta;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightLamp;
        varying vec2 vUv;
        varying vec4 vPoolMeta;
        void main() {
          float stateMult = vPoolMeta.x;
          float alwaysLit = vPoolMeta.w;
          float nightDrive = max(uNightLamp, alwaysLit * 0.8);
          float r = length(vUv - 0.5) * 2.0;
          if (r >= 1.0 || stateMult <= 0.01 || nightDrive <= 0.01) discard;
          float soft = pow(1.0 - r, 2.2) * 0.38 * stateMult * nightDrive;
          vec3 col = vec3(0.984, 0.52, 0.18) * soft;
          gl_FragColor = vec4(col, soft);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, maxPools);
    this.poolMesh.count = 0;
    this.poolMesh.frustumCulled = false;
    this.group.add(this.poolMesh);

    // 4. Pool of 8 real PointLights (high: 8, mid: 4, low: 0), never casting shadows
    for (let i = 0; i < 8; i++) {
      const pl = new THREE.PointLight(0xffa45b, 0, 18, 1.8);
      pl.castShadow = false;
      this.group.add(pl);
      this.pointLights.push({
        light: pl,
        assignedLampIdx: -1,
        currentWeight: 0,
      });
    }
  }

  private stateMultiplier(state: LampState): number {
    switch (state) {
      case 'lit':
        return 1.0;
      case 'ember':
        return 1.35;
      case 'dim':
        return 0.38;
      case 'dark':
        return 0.0;
    }
  }

  public add(spec: LampSpec): string {
    const idx = this.records.length;
    if (idx >= this.maxLamps) {
      return spec.id ?? `lamp-overflow-${idx}`;
    }

    const pos =
      spec.position instanceof THREE.Vector3
        ? spec.position.clone()
        : new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
    const id = spec.id ?? `lamp-${idx}`;
    const size = spec.size ?? 1.0;
    const state = spec.state ?? 'lit';
    const phase = ((idx * 0.61803398875) % 1.0) + (pos.x * 0.03 + pos.z * 0.07) % 1.0;
    const hasPool = spec.hasGroundPool ?? size >= 1.15;
    let poolIdx = -1;

    if (hasPool && this.poolCount < this.maxPools) {
      poolIdx = this.poolCount++;
      const poolMatrix = new THREE.Matrix4()
        .makeScale(size, 1, size)
        .setPosition(pos.x, pos.y - 2.35, pos.z);
      this.poolMesh.setMatrixAt(poolIdx, poolMatrix);
      this.poolMesh.count = this.poolCount;
      this.poolMesh.instanceMatrix.needsUpdate = true;
    }

    const rec: LampRecord = {
      index: idx,
      id,
      slotGroup: spec.slotGroup,
      position: pos,
      size,
      color: new THREE.Color(spec.colour ?? 0xffb27a),
      state,
      phase,
      hasGroundPool: hasPool,
      poolIndex: poolIdx,
    };

    this.records.push(rec);
    this.byId.set(id, rec);
    if (spec.slotGroup) {
      const list = this.bySlot.get(spec.slotGroup) ?? [];
      list.push(rec);
      this.bySlot.set(spec.slotGroup, list);
    }

    const m = new THREE.Matrix4().makeScale(size, size, size).setPosition(pos);
    this.bodyMesh.setMatrixAt(idx, m);
    this.haloMesh.setMatrixAt(idx, m);
    this.bodyMesh.count = this.records.length;
    this.haloMesh.count = this.records.length;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceMatrix.needsUpdate = true;

    this.syncLampAttributes(rec);
    return id;
  }

  private syncLampAttributes(rec: LampRecord): void {
    const mult = this.stateMultiplier(rec.state);
    const alwaysLit = rec.state === 'ember' ? 1.0 : 0.0;
    this.bodyStateAttr.setXYZW(rec.index, mult, rec.phase, rec.size, alwaysLit);
    this.haloStateAttr.setXYZW(rec.index, mult, rec.phase, rec.size, alwaysLit);
    this.bodyStateAttr.needsUpdate = true;
    this.haloStateAttr.needsUpdate = true;

    if (rec.poolIndex >= 0) {
      this.poolStateAttr.setXYZW(rec.poolIndex, mult, rec.phase, rec.size, alwaysLit);
      this.poolStateAttr.needsUpdate = true;
    }
  }

  public setState(id: string, state: LampState): void {
    const rec = this.byId.get(id);
    if (!rec || rec.state === state) return;
    rec.state = state;
    this.syncLampAttributes(rec);
  }

  public slots(slotGroup: string): ReadonlyArray<LampRecord> {
    return this.bySlot.get(slotGroup) ?? [];
  }

  public setQualityTier(tier: QualityTier): void {
    this.activeLightBudget = tier === 'high' ? 8 : tier === 'mid' ? 4 : 0;
  }

  public update(playerPos: THREE.Vector3, realSeconds: number, dt: number): void {
    const nightDrive = U.uNightLamp.value;

    // Reassign nearest N active lamps every 200 ms
    if (realSeconds - this.lastReassignTime >= 0.2) {
      this.lastReassignTime = realSeconds;

      if (this.activeLightBudget === 0 || this.records.length === 0) {
        for (const pl of this.pointLights) {
          pl.assignedLampIdx = -1;
        }
      } else {
        // Find top N closest lit/ember lamps within 65m
        const candidates: Array<{ idx: number; distSq: number }> = [];
        for (let i = 0; i < this.records.length; i++) {
          const r = this.records[i];
          if (r.state === 'dark') continue;
          const dSq = r.position.distanceToSquared(playerPos);
          if (dSq < 65 * 65) {
            candidates.push({ idx: i, distSq: dSq });
          }
        }
        candidates.sort((a, b) => a.distSq - b.distSq);

        for (let slot = 0; slot < this.pointLights.length; slot++) {
          const pl = this.pointLights[slot];
          if (slot < this.activeLightBudget && slot < candidates.length) {
            pl.assignedLampIdx = candidates[slot].idx;
          } else {
            pl.assignedLampIdx = -1;
          }
        }
      }
    }

    // Smooth intensity fade so there is zero light popping
    const fadeSpeed = Math.min(1, dt * 5.0);
    for (let slot = 0; slot < this.pointLights.length; slot++) {
      const pl = this.pointLights[slot];
      if (pl.assignedLampIdx >= 0) {
        const rec = this.records[pl.assignedLampIdx];
        pl.light.position.copy(rec.position);
        pl.currentWeight += (1.0 - pl.currentWeight) * fadeSpeed;
        const mult = this.stateMultiplier(rec.state);
        const effNight = rec.state === 'ember' ? Math.max(nightDrive, 0.85) : nightDrive;
        pl.light.intensity = pl.currentWeight * mult * effNight * 2.4 * rec.size;
      } else {
        pl.currentWeight += (0.0 - pl.currentWeight) * fadeSpeed;
        pl.light.intensity = pl.currentWeight * 1.8;
      }
    }
  }

  public get count(): number {
    return this.records.length;
  }

  public get activePointLightCount(): number {
    let n = 0;
    for (const pl of this.pointLights) {
      if (pl.light.intensity > 0.02) n++;
    }
    return n;
  }

  public dispose(): void {
    this.bodyMesh.geometry.dispose();
    (this.bodyMesh.material as THREE.Material).dispose();
    this.haloMesh.geometry.dispose();
    (this.haloMesh.material as THREE.Material).dispose();
    this.poolMesh.geometry.dispose();
    (this.poolMesh.material as THREE.Material).dispose();
  }
}
