import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DESCENT_KEYFRAMES } from '../world3d/cinematics/Descent.ts';
import { QUALITY, QualityGovernor } from '../world3d/Quality.ts';
import { generateCloudVolumeBytes } from '../world3d/sky/CloudNoise.worker.ts';
import { skyColorAt } from '../world3d/sky/SkyPass.ts';
import { atmosphereAt, PRESETS } from '../world3d/sky/timeOfDay.ts';
import { groundHeightAt, roadMaskAt } from '../world3d/terrainMath.ts';
import { U, updateSharedUniforms } from '../world3d/uniforms.ts';
import {
  CLOUD_SEA,
  EYE_HEIGHT,
  GLIDE,
  LANDMARKS,
  PLACES,
  RUN,
  SISTER,
  SPACE_FULL,
  SPACE_START,
  WALK,
  WORLD,
  placeAt,
} from './bible.ts';

test('world bible constants match specification', () => {
  assert.equal(EYE_HEIGHT, 1.65);
  assert.equal(WALK, 3.2);
  assert.equal(RUN, 6.4);
  assert.equal(GLIDE, 14);
  assert.deepEqual(WORLD, { minX: -1700, maxX: 1100, minZ: -1000, maxZ: 1000 });
  assert.equal(SPACE_START, 2500);
  assert.equal(SPACE_FULL, 4500);
  assert.deepEqual(CLOUD_SEA, { y0: 250, y1: 335 });
  assert.deepEqual(SISTER.center, [14300, 5700, -20800]);
  assert.equal(SISTER.radius, 4800);
  assert.equal(LANDMARKS.skyIslands.length, 7);
});

test('placeAt resolves ground anchors, Sky Realms, and Open Cosmos accurately', () => {
  assert.equal(placeAt(34, 140, 0), 'east-gate');
  assert.equal(placeAt(-262, 96, 214), 'lantern-terrace');
  assert.equal(placeAt(70, 150, -318), 'hall-of-records');
  assert.equal(placeAt(6000, 0, 6030), 'hall-of-records');
  assert.equal(placeAt(508, 262, -70), 'beast-ridge');
  assert.equal(placeAt(-120, 432, -560), 'overlook');
  assert.equal(placeAt(-110, 985, -620), 'sky-realms');
  assert.equal(placeAt(-1100, 66, 600), 'ashen-march');
  assert.equal(placeAt(-110, 5200, -620), 'open-cosmos');
  assert.equal(PLACES['east-gate'].label, 'The East Gate');
});

test('groundHeightAt aligns with world bible landmark elevations', () => {
  assert.ok(Math.abs(groundHeightAt(34, 0) - 140) < 0.5);
  assert.ok(Math.abs(groundHeightAt(64, 0) - 140) < 0.5);
  assert.ok(Math.abs(groundHeightAt(-262, 214) - 96) < 0.5);
  assert.ok(Math.abs(groundHeightAt(70, -318) - 150) < 0.5);
  assert.ok(Math.abs(groundHeightAt(508, -70) - 262) < 0.5);
  assert.ok(Math.abs(groundHeightAt(-120, -560) - 432) < 0.5);
  assert.ok(Math.abs(groundHeightAt(-1100, 600) - 66) < 0.5);
  assert.equal(groundHeightAt(6000, 6030), 0);
  assert.ok(roadMaskAt(34, 0) > 0.8);
});

test('QualityGovernor steps down after >22ms for 3s and respects 6s cooldown', () => {
  assert.equal(QUALITY.high.shadowNearSize, 2048);
  assert.equal(QUALITY.mid.shadowNearSize, 1536);
  assert.equal(QUALITY.low.shadowNearSize, 0);

  const gov = new QualityGovernor('high');
  for (let i = 0; i < 130; i++) {
    gov.recordFrame(28);
  }
  assert.equal(gov.getTier(), 'mid');

  for (let i = 0; i < 120; i++) {
    gov.recordFrame(28);
  }
  assert.equal(gov.getTier(), 'mid');

  for (let i = 0; i < 120; i++) {
    gov.recordFrame(28);
  }
  assert.equal(gov.getTier(), 'low');
});

test('timeOfDay presets, sun path, and updateSharedUniforms match Prompt 3 specification', () => {
  assert.equal(PRESETS.day.zenith, '#C9C1B5');
  assert.equal(PRESETS.dawn.horizon, '#F2C29B');
  assert.equal(PRESETS.dusk.horizon, '#F29A62');
  assert.equal(PRESETS.night.sunColor, '#D9CDBA');

  // 06:00 sunrise in the East (+x)
  const dawnAtm = atmosphereAt(360);
  assert.ok(dawnAtm.sunDir.x > 0.98);
  assert.ok(Math.abs(dawnAtm.sunElevationDeg) < 0.5);
  assert.ok(dawnAtm.twilightWeight > 0.8);

  // 12:00 noon high and slightly South (+z)
  const noonAtm = atmosphereAt(720);
  assert.ok(noonAtm.sunDir.y > 0.85);
  assert.ok(noonAtm.sunDir.z > 0.25);
  assert.equal(noonAtm.dayWeight, 1);
  assert.ok(Math.abs(noonAtm.sunIntensity - 3.4) < 0.01);
  assert.equal(noonAtm.nightLamp, 0);

  // 18:00 sunset in the West (-x)
  const duskAtm = atmosphereAt(1080);
  assert.ok(duskAtm.sunDir.x < -0.98);
  assert.ok(duskAtm.horizon.r > duskAtm.horizon.b);

  // 00:00 midnight
  const nightAtm = atmosphereAt(0);
  assert.equal(nightAtm.nightWeight, 1);
  assert.equal(nightAtm.nightLamp, 1);
  assert.ok(Math.abs(nightAtm.sunIntensity - 0.45) < 0.01);

  updateSharedUniforms({
    realSeconds: 12.5,
    worldMinutes: 1085,
    playerPos: new THREE.Vector3(34, 140, 0),
    camPos: new THREE.Vector3(34, 141.65, 0),
    spirit01: 0.5,
  });
  assert.equal(U.uTime.value, 12.5);
  assert.equal(U.uFogBaseY.value, 165.0);
  assert.equal(U.uFogHeightFalloff.value, 0.010);
  assert.equal(U.uAltitude01.value, 0);
  assert.ok(U.uWindStrength.value >= 0.35 && U.uWindStrength.value <= 1.0);
  assert.ok(U.uFogColor.value.r > U.uFogColor.value.b);

  // skyColorAt CPU helper returns warm non-blue gradient
  const skyHoriz = skyColorAt(new THREE.Vector3(1, 0.05, 0).normalize());
  assert.ok(skyHoriz.r >= skyHoriz.b);

  updateSharedUniforms({
    realSeconds: 20,
    worldMinutes: 1085,
    playerPos: new THREE.Vector3(-110, 5200, -620),
    camPos: new THREE.Vector3(-110, 5201.65, -620),
    spirit01: 0.8,
  });
  assert.equal(U.uAltitude01.value, 1);
});

test('CloudNoise volume generator and Descent keyframes match specification', () => {
  const bytes = generateCloudVolumeBytes(16);
  assert.equal(bytes.length, 16 * 16 * 16);
  let nonZero = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0) nonZero++;
  }
  assert.ok(nonZero > 2000);

  assert.equal(DESCENT_KEYFRAMES[0].t, 0.0);
  assert.deepEqual(DESCENT_KEYFRAMES[0].pos, [-110, 5200, -620]);
  assert.equal(DESCENT_KEYFRAMES[0].fov, 46);

  const last = DESCENT_KEYFRAMES[DESCENT_KEYFRAMES.length - 1];
  assert.equal(last.t, 14.0);
  assert.deepEqual(last.pos, [34, 141.65, 0]);
  assert.equal(last.fov, 58);
});
