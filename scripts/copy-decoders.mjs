import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function copyDirSafe(srcRel, destRel) {
  try {
    const src = path.resolve(root, srcRel);
    const dest = path.resolve(root, destRel);
    if (!fs.existsSync(src)) {
      return;
    }
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const sPath = path.join(src, entry.name);
      const dPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirSafe(path.relative(root, sPath), path.relative(root, dPath));
      } else if (entry.isFile()) {
        fs.copyFileSync(sPath, dPath);
      }
    }
  } catch {
    // Never fail install or build if decoder source path is absent
  }
}

copyDirSafe('node_modules/three/examples/jsm/libs/draco/gltf', 'public/draco');
copyDirSafe('node_modules/three/examples/jsm/libs/basis', 'public/basis');

/**
 * Generates a valid glTF 2.0 binary (`public/world/models/well.glb`) for the
 * Section 9 / Section 11 Model Override system if not already present.
 */
function writeTestWellGlb() {
  try {
    const modelsDir = path.resolve(root, 'public/world/models');
    fs.mkdirSync(modelsDir, { recursive: true });
    const wellPath = path.join(modelsDir, 'well.glb');

    // Build an octagonal well curb + roof canopy mesh in binary buffer
    const positions = [];
    const normals = [];
    const indices = [];

    function addBox(w, h, d, cx, cy, cz) {
      const hw = w * 0.5;
      const hh = h * 0.5;
      const hd = d * 0.5;
      const faces = [
        { n: [0, 0, 1], v: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]] },
        { n: [0, 0, -1], v: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]] },
        { n: [0, 1, 0], v: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]] },
        { n: [0, -1, 0], v: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]] },
        { n: [1, 0, 0], v: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]] },
        { n: [-1, 0, 0], v: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]] },
      ];
      for (const f of faces) {
        const base = positions.length / 3;
        for (const [vx, vy, vz] of f.v) {
          positions.push(cx + vx, cy + vy, cz + vz);
          normals.push(f.n[0], f.n[1], f.n[2]);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }

    // Stone well base curb + 2 timber posts + roof beam
    addBox(2.2, 0.95, 2.2, 0, 0.475, 0);
    addBox(0.18, 2.1, 0.18, -0.95, 1.5, 0);
    addBox(0.18, 2.1, 0.18, 0.95, 1.5, 0);
    addBox(2.5, 0.35, 1.9, 0, 2.65, 0);

    const posArray = new Float32Array(positions);
    const normArray = new Float32Array(normals);
    const idxArray = new Uint16Array(indices);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < posArray.length; i += 3) {
      minX = Math.min(minX, posArray[i]);
      minY = Math.min(minY, posArray[i + 1]);
      minZ = Math.min(minZ, posArray[i + 2]);
      maxX = Math.max(maxX, posArray[i]);
      maxY = Math.max(maxY, posArray[i + 1]);
      maxZ = Math.max(maxZ, posArray[i + 2]);
    }

    const posBytes = Buffer.from(posArray.buffer);
    const normBytes = Buffer.from(normArray.buffer);
    const idxBytes = Buffer.from(idxArray.buffer);
    const idxPad = (4 - (idxBytes.length % 4)) % 4;
    const binBuffer = Buffer.concat([
      posBytes,
      normBytes,
      idxBytes,
      Buffer.alloc(idxPad, 0),
    ]);

    const gltfJson = {
      asset: { version: '2.0', generator: 'arkvoid-well-generator' },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [
        { name: 'well_mesh', mesh: 0 },
        { name: 'lamp_well', translation: [0, 2.35, 0] },
        { name: 'interact_well', translation: [0, 1.0, 1.1] },
      ],
      materials: [
        {
          name: 'WellStone',
          pbrMetallicRoughness: {
            baseColorFactor: [0.68, 0.63, 0.56, 1.0],
            metallicFactor: 0.05,
            roughnessFactor: 0.86,
          },
        },
      ],
      meshes: [
        {
          name: 'Well',
          primitives: [
            {
              attributes: { POSITION: 0, NORMAL: 1 },
              indices: 2,
              material: 0,
            },
          ],
        },
      ],
      buffers: [{ byteLength: binBuffer.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
        { buffer: 0, byteOffset: posBytes.length, byteLength: normBytes.length, target: 34962 },
        {
          buffer: 0,
          byteOffset: posBytes.length + normBytes.length,
          byteLength: idxBytes.length,
          target: 34963,
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: posArray.length / 3,
          type: 'VEC3',
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: normArray.length / 3,
          type: 'VEC3',
        },
        {
          bufferView: 2,
          componentType: 5123,
          count: idxArray.length,
          type: 'SCALAR',
        },
      ],
    };

    const jsonRaw = Buffer.from(JSON.stringify(gltfJson), 'utf8');
    const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
    const jsonBuffer = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);

    const totalLen = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // 'glTF'
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLen, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuffer.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

    const glb = Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
    fs.writeFileSync(wellPath, glb);
  } catch {
    // Ignore errors
  }
}

writeTestWellGlb();

