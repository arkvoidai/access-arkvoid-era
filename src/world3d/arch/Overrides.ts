import * as THREE from 'three';
import { patchMaterial } from '../fog.ts';
import { getWorldGLTFLoader } from '../loaders.ts';

export const OVERRIDE_MODEL_IDS = [
  'east-gate',
  'guard-post',
  'house-a',
  'house-b',
  'house-c',
  'house-d',
  'workshop',
  'stone-bridge',
  'market-stall',
  'well',
  'terrace-cottage',
  'still',
  'hall-facade',
  'hall-interior',
  'nest',
  'hero-maple',
  'airship',
  'island-1',
  'island-2',
  'island-3',
  'island-4',
  'island-5',
  'island-6',
  'island-7',
  'fortress-ruin',
  'law-seal',
  'dais',
  'lantern',
] as const;

export type OverrideModelId = (typeof OVERRIDE_MODEL_IDS)[number];

export interface LoadedOverrideAsset {
  id: OverrideModelId;
  scene: THREE.Group;
  lampSockets: THREE.Vector3[];
  interactSockets: Array<{ name: string; position: THREE.Vector3 }>;
}

/**
 * GLB Model Override System (`Overrides.ts` — Prompt 5 Section 9):
 * - Checks `/world/models/<id>.glb` asynchronously at startup.
 * - Verifies binary glTF magic header (`glTF` = `0x46546C67`) so missing files that fall back
 *   to SPA HTML in dev servers are silently ignored without console errors.
 * - Extracts `lamp_*` and `interact_*` empty sockets and patches loaded materials with Arkvoid fog.
 * - Replaces procedural placeholders in-place whenever an override `.glb` is found.
 */
export class ModelOverrides {
  private readonly loaded = new Map<OverrideModelId, LoadedOverrideAsset>();
  private readonly pendingTargets = new Map<
    OverrideModelId,
    Array<{
      container: THREE.Group;
      onReplaced?: (asset: LoadedOverrideAsset) => void;
    }>
  >();
  private renderer?: THREE.WebGLRenderer;
  private scanComplete = false;

  public constructor(renderer?: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  public get loadedIds(): ReadonlyArray<OverrideModelId> {
    return Array.from(this.loaded.keys());
  }

  public get isScanComplete(): boolean {
    return this.scanComplete;
  }

  /**
   * Probes and loads any available `.glb` overrides in `/world/models/<id>.glb`.
   * Silently skips missing files.
   */
  public async scanAndLoadAll(
    idsToProbe: ReadonlyArray<OverrideModelId> = ['well', 'east-gate', 'terrace-cottage', 'nest', 'dais']
  ): Promise<ReadonlyArray<OverrideModelId>> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      this.scanComplete = true;
      return [];
    }

    const loader = getWorldGLTFLoader(this.renderer);

    await Promise.all(
      idsToProbe.map(async (id) => {
        try {
          const url = `/world/models/${id}.glb`;
          const res = await fetch(url, { method: 'GET' });
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 20) return;

          // Verify glTF binary magic header ('glTF' == 0x46546C67 little-endian)
          const magic = new DataView(buf).getUint32(0, true);
          if (magic !== 0x46546c67) return;

          const gltf = await loader.parseAsync(buf, '/world/models/');
          const lampSockets: THREE.Vector3[] = [];
          const interactSockets: Array<{ name: string; position: THREE.Vector3 }> = [];

          gltf.scene.traverse((obj) => {
            if (obj.name.startsWith('lamp_')) {
              const p = new THREE.Vector3();
              obj.getWorldPosition(p);
              lampSockets.push(p);
            } else if (obj.name.startsWith('interact_')) {
              const p = new THREE.Vector3();
              obj.getWorldPosition(p);
              interactSockets.push({ name: obj.name, position: p });
            }

            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh && mesh.material) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map((m) => patchMaterial(m));
              } else {
                mesh.material = patchMaterial(mesh.material);
              }
            }
          });

          const asset: LoadedOverrideAsset = {
            id,
            scene: gltf.scene,
            lampSockets,
            interactSockets,
          };
          this.loaded.set(id, asset);

          // Upgrade any already-mounted procedural containers for this ID
          const targets = this.pendingTargets.get(id);
          if (targets) {
            for (const target of targets) {
              this.applyOverrideToContainer(target.container, asset);
              target.onReplaced?.(asset);
            }
          }
        } catch {
          // Silently ignore missing or invalid optional GLB files per Section 9
        }
      })
    );

    this.scanComplete = true;
    return this.loadedIds;
  }

  /**
   * Wraps a procedural `THREE.Object3D` in an override-aware `THREE.Group`.
   * If `/world/models/<id>.glb` is already loaded (or finishes loading moments later),
   * the procedural children are replaced with a clone of the `.glb` asset at the exact same transform.
   */
  public wrapWithOverride(
    id: OverrideModelId,
    proceduralNode: THREE.Object3D,
    position?: [number, number, number],
    rotationY = 0,
    onReplaced?: (asset: LoadedOverrideAsset) => void
  ): THREE.Group {
    const container = new THREE.Group();
    container.name = `override-slot:${id}`;
    if (position) {
      container.position.set(position[0], position[1], position[2]);
    }
    if (rotationY !== 0) {
      container.rotation.y = rotationY;
    }

    const existing = this.loaded.get(id);
    if (existing) {
      this.applyOverrideToContainer(container, existing);
      onReplaced?.(existing);
    } else {
      container.add(proceduralNode);
      const list = this.pendingTargets.get(id) ?? [];
      list.push({ container, onReplaced });
      this.pendingTargets.set(id, list);
    }

    return container;
  }

  private applyOverrideToContainer(container: THREE.Group, asset: LoadedOverrideAsset): void {
    while (container.children.length > 0) {
      container.remove(container.children[0]);
    }
    const clone = asset.scene.clone(true);
    clone.name = `glb-override:${asset.id}`;
    container.add(clone);
  }
}
