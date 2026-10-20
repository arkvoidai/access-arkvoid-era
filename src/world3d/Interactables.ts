import * as THREE from 'three';
import { U } from './uniforms.ts';

export type InteractableKind = 'person' | 'object' | 'door' | 'gather' | 'place' | 'seat';

export interface Interactable {
  id: string;
  kind: InteractableKind;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: () => boolean;
  onUse: () => void;
}

export interface FocusedInteractableInfo {
  id: string;
  kind: InteractableKind;
  prompt: string;
  distance: number;
}

const CELL_SIZE = 12; // 12m spatial hash cells
const FOCUS_MAX_DIST = 4.0; // 4m range per spec
const FOCUS_COS_HALF_ANGLE = Math.cos((35 * Math.PI) / 180); // 35 degree cone from view direction

/**
 * Spatial-hashed Interaction Registry & Focus Ring (`Interactables.ts` — Prompt 5 Section 8):
 * - Evaluates nearest enabled interactable within 4 m inside a 35° view cone.
 * - Renders a thin billboarded ember ring drawn on top without depth test (`depthTest: false`),
 *   fading smoothly with distance.
 * - Exposes keyboard `E` activation and raycast/screen-space touch tap activation.
 */
export class InteractableRegistry {
  public readonly group = new THREE.Group();
  private readonly items = new Map<string, Interactable>();
  private readonly grid = new Map<string, Set<string>>();
  private readonly ringSprite: THREE.Mesh;
  private readonly ringUniforms: {
    uTime: THREE.IUniform<number>;
    uOpacity: THREE.IUniform<number>;
  };

  private focusedItem: Interactable | null = null;
  private focusedDistance = Number.POSITIVE_INFINITY;
  private readonly onFocusCallbacks = new Set<(info: FocusedInteractableInfo | null) => void>();
  private readonly onUseCallbacks = new Set<(item: Interactable) => void>();

  public constructor() {
    this.group.name = 'InteractableRegistry';

    this.ringUniforms = {
      uTime: U.uTime,
      uOpacity: { value: 0.0 },
    };

    const ringGeo = new THREE.PlaneGeometry(0.72, 0.72);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: this.ringUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 center = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 worldPos = center + (right * position.x + up * position.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          if (uOpacity <= 0.01) discard;
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float pulse = 0.72 + 0.04 * sin(uTime * 3.2);
          float ring = smoothstep(0.08, 0.0, abs(r - pulse));
          float core = smoothstep(0.16, 0.0, r) * 0.65;
          float alpha = (ring + core) * uOpacity;
          if (alpha <= 0.02) discard;
          vec3 ember = vec3(0.984, 0.337, 0.027); // #FB5607
          vec3 warm  = vec3(1.0, 0.698, 0.478);   // #FFB27A
          vec3 col = mix(ember, warm, core);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.ringSprite = new THREE.Mesh(ringGeo, ringMat);
    this.ringSprite.renderOrder = 999;
    this.ringSprite.visible = false;
    this.ringSprite.frustumCulled = false;
    this.group.add(this.ringSprite);
  }

  private cellKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  public register(item: Interactable): void {
    this.unregister(item.id);
    this.items.set(item.id, item);

    const cx = Math.floor(item.position.x / CELL_SIZE);
    const cz = Math.floor(item.position.z / CELL_SIZE);
    const key = this.cellKey(cx, cz);
    let set = this.grid.get(key);
    if (!set) {
      set = new Set();
      this.grid.set(key, set);
    }
    set.add(item.id);
  }

  public unregister(id: string): void {
    const existing = this.items.get(id);
    if (!existing) return;
    const cx = Math.floor(existing.position.x / CELL_SIZE);
    const cz = Math.floor(existing.position.z / CELL_SIZE);
    const key = this.cellKey(cx, cz);
    this.grid.get(key)?.delete(id);
    this.items.delete(id);
    if (this.focusedItem?.id === id) {
      this.setFocused(null, Number.POSITIVE_INFINITY);
    }
  }

  public get(id: string): Interactable | undefined {
    return this.items.get(id);
  }

  public getAll(): ReadonlyArray<Interactable> {
    return Array.from(this.items.values());
  }

  public onFocusChange(cb: (info: FocusedInteractableInfo | null) => void): () => void {
    this.onFocusCallbacks.add(cb);
    return () => this.onFocusCallbacks.delete(cb);
  }

  public onTrigger(cb: (item: Interactable) => void): () => void {
    this.onUseCallbacks.add(cb);
    return () => this.onUseCallbacks.delete(cb);
  }

  private setFocused(item: Interactable | null, dist: number): void {
    const prevId = this.focusedItem?.id ?? null;
    const nextId = item?.id ?? null;
    this.focusedItem = item;
    this.focusedDistance = dist;

    if (prevId !== nextId) {
      const info: FocusedInteractableInfo | null = item
        ? {
            id: item.id,
            kind: item.kind,
            prompt: item.prompt,
            distance: Number(dist.toFixed(2)),
          }
        : null;
      for (const cb of this.onFocusCallbacks) {
        cb(info);
      }
    }
  }

  public update(camera: THREE.Camera, playerFeetPos: THREE.Vector3): FocusedInteractableInfo | null {
    const eyePos = camera.position;
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);

    const baseCx = Math.floor(playerFeetPos.x / CELL_SIZE);
    const baseCz = Math.floor(playerFeetPos.z / CELL_SIZE);

    let bestItem: Interactable | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDist = Number.POSITIVE_INFINITY;

    const toItem = new THREE.Vector3();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const set = this.grid.get(this.cellKey(baseCx + dx, baseCz + dz));
        if (!set) continue;
        for (const id of set) {
          const item = this.items.get(id);
          if (!item || !item.enabled()) continue;

          // Distance from player feet or eye (use minimum of 3D eye distance and horizontal feet distance)
          const distEye = eyePos.distanceTo(item.position);
          const distFeet = Math.hypot(
            playerFeetPos.x - item.position.x,
            playerFeetPos.z - item.position.z
          );
          const effectiveDist = Math.min(distEye, distFeet);
          const maxRange = Math.max(FOCUS_MAX_DIST, item.radius);

          if (effectiveDist > maxRange || Math.abs(playerFeetPos.y - item.position.y) > 4.5) {
            continue;
          }

          toItem.subVectors(item.position, eyePos);
          const len = toItem.length();
          if (len > 0.001) {
            toItem.divideScalar(len);
          }
          const cosAngle = viewDir.dot(toItem);
          // Allow very close interactables (< 1.6m) slightly wider cone so standing right next to a door/bench feels natural
          const minCos = effectiveDist < 1.6 ? 0.5 : FOCUS_COS_HALF_ANGLE;
          if (cosAngle < minCos) continue;

          const score = effectiveDist * (1.25 - cosAngle * 0.45);
          if (score < bestScore) {
            bestScore = score;
            bestItem = item;
            bestDist = effectiveDist;
          }
        }
      }
    }

    this.setFocused(bestItem, bestDist);

    if (bestItem) {
      this.ringSprite.visible = true;
      this.ringSprite.position.copy(bestItem.position);
      const maxRange = Math.max(FOCUS_MAX_DIST, bestItem.radius);
      const fade = THREE.MathUtils.clamp(1.0 - (bestDist / maxRange) * 0.65, 0.25, 1.0);
      this.ringUniforms.uOpacity.value = fade;
      return {
        id: bestItem.id,
        kind: bestItem.kind,
        prompt: bestItem.prompt,
        distance: Number(bestDist.toFixed(2)),
      };
    } else {
      this.ringSprite.visible = false;
      this.ringUniforms.uOpacity.value = 0.0;
      return null;
    }
  }

  /**
   * Triggers the currently focused interactable (e.g., when pressing `E` or clicking the prompt pill).
   */
  public triggerFocused(): boolean {
    if (!this.focusedItem || !this.focusedItem.enabled()) return false;
    this.focusedItem.onUse();
    for (const cb of this.onUseCallbacks) {
      cb(this.focusedItem);
    }
    return true;
  }

  /**
   * Triggers an interactable by ID directly (for tests or UI actions).
   */
  public triggerById(id: string): boolean {
    const item = this.items.get(id);
    if (!item || !item.enabled()) return false;
    item.onUse();
    for (const cb of this.onUseCallbacks) {
      cb(item);
    }
    return true;
  }

  /**
   * Touch/click tap handler: checks if any enabled interactable within range is tapped in normalized
   * device coordinates (`ndcX`, `ndcY` in `-1..1`), and triggers it.
   */
  public triggerAtScreenPoint(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera,
    playerFeetPos: THREE.Vector3
  ): boolean {
    let best: Interactable | null = null;
    let bestScreenDist = 0.18; // NDC tolerance (~9% of screen width)
    const projected = new THREE.Vector3();

    for (const item of this.items.values()) {
      if (!item.enabled()) continue;
      const dist = playerFeetPos.distanceTo(item.position);
      if (dist > Math.max(FOCUS_MAX_DIST + 1.5, item.radius + 1.5)) continue;

      projected.copy(item.position).project(camera);
      if (projected.z < 0 || projected.z > 1) continue;
      const d = Math.hypot(projected.x - ndcX, projected.y - ndcY);
      if (d < bestScreenDist) {
        bestScreenDist = d;
        best = item;
      }
    }

    if (best) {
      best.onUse();
      for (const cb of this.onUseCallbacks) {
        cb(best);
      }
      return true;
    }
    return false;
  }

  public get focused(): FocusedInteractableInfo | null {
    if (!this.focusedItem) return null;
    return {
      id: this.focusedItem.id,
      kind: this.focusedItem.kind,
      prompt: this.focusedItem.prompt,
      distance: Number(this.focusedDistance.toFixed(2)),
    };
  }

  public dispose(): void {
    this.items.clear();
    this.grid.clear();
    this.ringSprite.geometry.dispose();
    (this.ringSprite.material as THREE.Material).dispose();
  }
}
