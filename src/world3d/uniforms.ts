import * as THREE from 'three';
import {
  atmosphereAt,
  computeAltitude01,
  sampleWindAt,
  type BlendedAtmosphere,
} from './sky/timeOfDay.ts';

function createDefaultWearTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export const U = {
  uTime: { value: 0 },
  uWorldMinutes: { value: 1085 },
  uDayFraction: { value: 1085 / 1440 },
  uSunDir: { value: new THREE.Vector3(-0.99, 0.08, 0.03).normalize() },
  uSunColor: { value: new THREE.Color('#FF9552') },
  uSunIntensity: { value: 2.2 },
  uSkyZenith: { value: new THREE.Color('#8A7A73') },
  uSkyHorizon: { value: new THREE.Color('#F29A62') },
  uFogColor: { value: new THREE.Color('#E0AA84') },
  uFogDensity: { value: 0.00050 },
  uFogHeightFalloff: { value: 0.010 },
  uFogBaseY: { value: 165.0 },
  uAltitude01: { value: 0.0 },
  uWindDir: { value: new THREE.Vector2(0.91, 0.41).normalize() },
  uWindStrength: { value: 0.55 },
  uPlayerPos: { value: new THREE.Vector3(34, 140, 0) },
  uCamPos: { value: new THREE.Vector3(34, 141.65, 0) },
  uWear: { value: createDefaultWearTexture() },
  uEmber: { value: 0.35 },
  uNightLamp: { value: 0.65 },
  uNightWeight: { value: 0.0 },
  uHemiSky: { value: new THREE.Color('#BFA595') },
  uHemiGround: { value: new THREE.Color('#6E5A4E') },
  uHemiIntensity: { value: 0.60 },
  uEdgeFade: { value: 0.0 },
};

export type SharedUniforms = typeof U;

const _scratchAtm = atmosphereAt(1085);

export function updateSharedUniforms(params: {
  realSeconds: number;
  worldMinutes: number;
  playerPos: THREE.Vector3;
  camPos: THREE.Vector3;
  spirit01?: number;
}): BlendedAtmosphere {
  const { realSeconds, worldMinutes, playerPos, camPos, spirit01 = 0.64 } = params;

  U.uTime.value = realSeconds;
  U.uWorldMinutes.value = worldMinutes;

  const minuteOfDay = ((worldMinutes % 1440) + 1440) % 1440;
  U.uDayFraction.value = minuteOfDay / 1440;

  U.uPlayerPos.value.copy(playerPos);
  U.uCamPos.value.copy(camPos);
  U.uAltitude01.value = computeAltitude01(camPos.y);

  // Height fog constants from Prompt 3 Section 2
  U.uFogBaseY.value = 165.0;
  U.uFogHeightFalloff.value = 0.010;

  // Wind drift and gusting
  U.uWindStrength.value = sampleWindAt(realSeconds, U.uWindDir.value);

  // Time-of-day preset blend
  const atm = atmosphereAt(worldMinutes, _scratchAtm);
  U.uSunDir.value.copy(atm.sunDir);
  U.uSunColor.value.copy(atm.sunColor);
  U.uSunIntensity.value = atm.sunIntensity;
  U.uSkyZenith.value.copy(atm.zenith);
  U.uSkyHorizon.value.copy(atm.horizon);
  U.uFogColor.value.copy(atm.fog);
  U.uFogDensity.value = atm.fogDensity;
  U.uNightLamp.value = atm.nightLamp;
  U.uNightWeight.value = atm.nightWeight;
  U.uHemiSky.value.copy(atm.hemiSky);
  U.uHemiGround.value.copy(atm.hemiGround);
  U.uHemiIntensity.value = atm.hemiIntensity;

  U.uEmber.value = THREE.MathUtils.clamp(0.2 + spirit01 * 0.45, 0, 1);

  return atm;
}
