import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

let sharedGltfLoader: GLTFLoader | null = null;
let sharedDracoLoader: DRACOLoader | null = null;
let sharedKtx2Loader: KTX2Loader | null = null;

/**
 * Returns a configured singleton GLTFLoader wired to same-origin `/draco/` and `/basis/` decoders.
 */
export function getWorldGLTFLoader(renderer?: THREE.WebGLRenderer): GLTFLoader {
  if (!sharedGltfLoader) {
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath('/draco/');

    sharedKtx2Loader = new KTX2Loader();
    sharedKtx2Loader.setTranscoderPath('/basis/');
    if (renderer) {
      sharedKtx2Loader.detectSupport(renderer);
    }

    sharedGltfLoader = new GLTFLoader();
    sharedGltfLoader.setDRACOLoader(sharedDracoLoader);
    sharedGltfLoader.setKTX2Loader(sharedKtx2Loader);
  } else if (renderer && sharedKtx2Loader) {
    sharedKtx2Loader.detectSupport(renderer);
  }
  return sharedGltfLoader;
}

/**
 * Generates a tileable grayscale procedural stone/grain micro-relief bump texture
 * in linear space (`NoColorSpace`) with maximum anisotropy.
 */
export function createStoneMicroReliefTexture(
  renderer: THREE.WebGLRenderer,
  size = 128
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const n1 = Math.sin(x * 0.25) * Math.cos(y * 0.25) * 0.5 + 0.5;
      const hash = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 255;
      const val = Math.floor(n1 * 90 + (hash / 255) * 165);
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

/**
 * Disposes all geometries, materials, and textures under an Object3D subtree.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) {
        for (const key of Object.keys(mat)) {
          const val = (mat as unknown as Record<string, unknown>)[key];
          if (val && typeof val === 'object' && 'isTexture' in val) {
            (val as THREE.Texture).dispose();
          }
        }
        mat.dispose();
      }
    }
  });
}
