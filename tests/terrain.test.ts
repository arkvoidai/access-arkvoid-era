import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  domainWarp2D,
  fbm2D,
  gradientNoise2D,
  ridgedFbm2D,
  valueNoise2D,
  WORLD_SEED,
} from '../src/world/noise.ts';
import {
  heightAt,
  normalAt,
  regionAt,
  slopeAt,
  surfaceAt,
  waterLevelAt,
} from '../src/world/terrainFn.ts';
import { ColliderGrid } from '../src/world3d/life/Colliders.ts';
import { buildTerrainChunkData } from '../src/world3d/terrain/terrain.worker.ts';
import { rleDecode, rleEncode } from '../src/world3d/terrain/Wear.ts';

describe('Prompt 4 — Seeded Noise & Pure Terrain Function (terrainFn.ts)', () => {
  it('uses deterministic WORLD_SEED = 0xA4C01D with zero Math.random variance', () => {
    assert.equal(WORLD_SEED, 0xa4c01d);
    const v1 = valueNoise2D(42.5, -19.2);
    const v2 = valueNoise2D(42.5, -19.2);
    assert.equal(v1, v2);

    const g1 = gradientNoise2D(12.3, 88.1);
    const g2 = gradientNoise2D(12.3, 88.1);
    assert.equal(g1, g2);

    const f1 = fbm2D(-120, 340, 4);
    const r1 = ridgedFbm2D(220, -410, 4);
    const [wx, wz] = domainWarp2D(50, -60, 15, 0.01);
    assert.ok(Number.isFinite(f1) && Number.isFinite(r1));
    assert.ok(Number.isFinite(wx) && Number.isFinite(wz));
  });

  it('hits every World Bible landmark elevation accurately', () => {
    // Town spur terraces
    assert.ok(Math.abs(heightAt(30, 0) - 140) < 0.25, `Courtyard height: ${heightAt(30, 0)}`);
    assert.ok(Math.abs(heightAt(64, 0) - 140) < 0.5, `East Gate height: ${heightAt(64, 0)}`);
    assert.ok(
      Math.abs(heightAt(-45, -10) - 150) < 0.25,
      `Upper terrace height: ${heightAt(-45, -10)}`
    );
    assert.ok(
      Math.abs(heightAt(-5, 48) - 131) < 0.25,
      `Lower court height: ${heightAt(-5, 48)}`
    );

    // Overlook platform & Hero Maple
    assert.ok(
      Math.abs(heightAt(-110, -540) - 432) < 0.35,
      `Overlook platform height: ${heightAt(-110, -540)}`
    );

    // Valley Lake bed & Lantern Terrace
    assert.ok(
      Math.abs(heightAt(-330, 300) - 52) < 0.4,
      `Valley Lake bed height: ${heightAt(-330, 300)}`
    );
    assert.equal(waterLevelAt(-330, 300), 58);
    assert.ok(
      Math.abs(heightAt(-262, 214) - 96) < 0.4,
      `Lantern Terrace height: ${heightAt(-262, 214)}`
    );

    // Beast Ridge nest ledge
    assert.ok(
      Math.abs(heightAt(545, -92) - 254) < 0.5,
      `Beast Ridge nest ledge height: ${heightAt(545, -92)}`
    );

    // Ashen March ravine entrance (-760, 380 -> 120 m) & anchor promontory (-1100, 600 -> 66 m)
    const lawSealH = heightAt(-760, 380);
    assert.ok(Math.abs(lawSealH - 120) < 0.5, `Law Seal ravine height: ${lawSealH}`);
    const ashAnchorH = heightAt(-1100, 600);
    assert.ok(Math.abs(ashAnchorH - 66) < 0.5, `Ashen March anchor height: ${ashAnchorH}`);
  });

  it('computes unit surface normals, slopes, regions, and all 7 surface kinds', () => {
    const n = normalAt(30, 0);
    const len = Math.hypot(n.x, n.y, n.z);
    assert.ok(Math.abs(len - 1) < 1e-5);
    assert.ok(n.y > 0.98, 'Flat courtyard has vertical normal');
    assert.ok(slopeAt(30, 0) < 0.05);

    assert.equal(surfaceAt(34, 0), 'stone');
    assert.equal(surfaceAt(-330, 300), 'water');
    assert.equal(surfaceAt(-1100, 600), 'ash');
    assert.equal(surfaceAt(160, -12), 'path');
    assert.equal(surfaceAt(-262, 214), 'wood');
    assert.equal(regionAt(-1100, 600), 'ashen');
    assert.equal(regionAt(-330, 300), 'valley');
  });

  it('builds indexed terrain chunk geometry with 6 m vertical skirts and zero NaNs', () => {
    const chunk = buildTerrainChunkData({
      id: '0:0@32',
      chunkX: 64,
      chunkZ: 64,
      size: 128,
      segments: 32,
    });
    const gridVerts = 33 * 33;
    const skirtVerts = 4 * 33;
    assert.equal(chunk.positions.length, (gridVerts + skirtVerts) * 3);
    assert.ok(chunk.indices.length > 0);
    for (let i = 0; i < chunk.positions.length; i++) {
      assert.ok(Number.isFinite(chunk.positions[i]));
    }
  });

  it('resolves circle and box collisions in ColliderGrid and encodes WearMap RLE losslessly', () => {
    const grid = new ColliderGrid();
    grid.addBatch('test', [
      { kind: 'circle', id: 'tree1', x: 10, z: 10, radius: 1.0 },
      { kind: 'box', id: 'wall1', cx: 20, cz: 10, halfX: 2.0, halfZ: 1.0 },
    ]);

    const out = { x: 0, z: 0 };
    const hitCircle = grid.resolveCircle(10.5, 10.0, 0.5, out);
    assert.equal(hitCircle, true);
    assert.ok(Math.abs(out.x - 11.5) < 1e-4);

    const sampleWear = new Uint8Array(1024);
    sampleWear[100] = 64;
    sampleWear[101] = 64;
    sampleWear[500] = 220;
    const rle = rleEncode(sampleWear);
    const decoded = rleDecode(rle, 1024);
    assert.deepEqual(decoded, sampleWear);
  });
});
