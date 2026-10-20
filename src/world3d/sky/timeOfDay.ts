import * as THREE from 'three';
import { SPACE_FULL, SPACE_START } from '../../world/bible.ts';

export interface AtmospherePreset {
  name: 'day' | 'dawn' | 'dusk' | 'night';
  zenith: string;
  horizon: string;
  sunColor: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  sunIntensity: number;
  hemiIntensity: number;
  fogDensity: number;
}

export const PRESETS: Readonly<Record<'day' | 'dawn' | 'dusk' | 'night', AtmospherePreset>> = {
  day: {
    name: 'day',
    zenith: '#C9C1B5',
    horizon: '#EDE5D8',
    sunColor: '#FFF0D2',
    fog: '#E6DED1',
    hemiSky: '#D9D1C4',
    hemiGround: '#8C7F70',
    sunIntensity: 3.4,
    hemiIntensity: 0.85,
    fogDensity: 0.00038,
  },
  dawn: {
    name: 'dawn',
    zenith: '#A89A8E',
    horizon: '#F2C29B',
    sunColor: '#FFC088',
    fog: '#EAC9AC',
    hemiSky: '#CBB8A6',
    hemiGround: '#7B6659',
    sunIntensity: 2.4,
    hemiIntensity: 0.65,
    fogDensity: 0.00046,
  },
  dusk: {
    name: 'dusk',
    zenith: '#8A7A73',
    horizon: '#F29A62',
    sunColor: '#FF9552',
    fog: '#E0AA84',
    hemiSky: '#BFA595',
    hemiGround: '#6E5A4E',
    sunIntensity: 2.2,
    hemiIntensity: 0.60,
    fogDensity: 0.00050,
  },
  night: {
    name: 'night',
    zenith: '#0D0C10',
    horizon: '#2B221F',
    sunColor: '#D9CDBA', // The Sister's light
    fog: '#1B1614',
    hemiSky: '#3A322E',
    hemiGround: '#1A1412',
    sunIntensity: 0.45,
    hemiIntensity: 0.35,
    fogDensity: 0.00055,
  },
};

export interface BlendedAtmosphere {
  hours: number;
  sunPhi: number;
  sunDir: THREE.Vector3;
  sunElevationDeg: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  fogDensity: number;
  nightWeight: number;
  twilightWeight: number;
  dayWeight: number;
  nightLamp: number;
  grainStrength: number;
  vignetteStrength: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blend3Colors(
  out: THREE.Color,
  c0: THREE.Color,
  w0: number,
  c1: THREE.Color,
  w1: number,
  c2: THREE.Color,
  w2: number
): void {
  out.setRGB(
    c0.r * w0 + c1.r * w1 + c2.r * w2,
    c0.g * w0 + c1.g * w1 + c2.g * w2,
    c0.b * w0 + c1.b * w1 + c2.b * w2
  );
}

// Pre-allocated color cache for preset definitions
const _cDay = {
  zenith: new THREE.Color(PRESETS.day.zenith),
  horizon: new THREE.Color(PRESETS.day.horizon),
  sunColor: new THREE.Color(PRESETS.day.sunColor),
  fog: new THREE.Color(PRESETS.day.fog),
  hemiSky: new THREE.Color(PRESETS.day.hemiSky),
  hemiGround: new THREE.Color(PRESETS.day.hemiGround),
};

const _cDawn = {
  zenith: new THREE.Color(PRESETS.dawn.zenith),
  horizon: new THREE.Color(PRESETS.dawn.horizon),
  sunColor: new THREE.Color(PRESETS.dawn.sunColor),
  fog: new THREE.Color(PRESETS.dawn.fog),
  hemiSky: new THREE.Color(PRESETS.dawn.hemiSky),
  hemiGround: new THREE.Color(PRESETS.dawn.hemiGround),
};

const _cDusk = {
  zenith: new THREE.Color(PRESETS.dusk.zenith),
  horizon: new THREE.Color(PRESETS.dusk.horizon),
  sunColor: new THREE.Color(PRESETS.dusk.sunColor),
  fog: new THREE.Color(PRESETS.dusk.fog),
  hemiSky: new THREE.Color(PRESETS.dusk.hemiSky),
  hemiGround: new THREE.Color(PRESETS.dusk.hemiGround),
};

const _cNight = {
  zenith: new THREE.Color(PRESETS.night.zenith),
  horizon: new THREE.Color(PRESETS.night.horizon),
  sunColor: new THREE.Color(PRESETS.night.sunColor),
  fog: new THREE.Color(PRESETS.night.fog),
  hemiSky: new THREE.Color(PRESETS.night.hemiSky),
  hemiGround: new THREE.Color(PRESETS.night.hemiGround),
};

/**
 * Pure function computing the blended Ink & Ember atmosphere at any `worldMinutes`.
 * Sunrise at 06:00 in the East (+x), noon high and slightly South (+z), sunset at 18:00 in the West (-x).
 */
export function atmosphereAt(
  worldMinutes: number,
  target?: BlendedAtmosphere
): BlendedAtmosphere {
  const minuteOfDay = ((worldMinutes % 1440) + 1440) % 1440;
  const h = minuteOfDay / 60;
  const phi = ((h - 6) / 24) * Math.PI * 2;

  const out: BlendedAtmosphere = target ?? {
    hours: h,
    sunPhi: phi,
    sunDir: new THREE.Vector3(),
    sunElevationDeg: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunColor: new THREE.Color(),
    fog: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sunIntensity: PRESETS.day.sunIntensity,
    hemiIntensity: PRESETS.day.hemiIntensity,
    fogDensity: PRESETS.day.fogDensity,
    nightWeight: 0,
    twilightWeight: 0,
    dayWeight: 1,
    nightLamp: 0,
    grainStrength: 0.016,
    vignetteStrength: 0.30,
  };

  out.hours = h;
  out.sunPhi = phi;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  out.sunDir.set(cosPhi, sinPhi * 0.88, 0.30 * sinPhi).normalize();

  const elevRad = Math.asin( THREE.MathUtils.clamp(out.sunDir.y, -1, 1) );
  const e = THREE.MathUtils.radToDeg(elevRad);
  out.sunElevationDeg = e;

  // Blend by elevation `e` with smooth weights:
  // night below -8 deg, twilight from -8 to +12 deg (dawn before noon, dusk after noon), day above +12 deg
  let wNight = 0;
  let wTwilight = 0;
  let wDay = 0;

  if (e <= -8) {
    wNight = 1;
  } else if (e < 2) {
    // Transition from night (-8 deg) to peak twilight (+2 deg)
    const t = smoothstep(-8, 2, e);
    wNight = 1 - t;
    wTwilight = t;
  } else if (e < 12) {
    // Transition from peak twilight (+2 deg) to full day (+12 deg)
    const t = smoothstep(2, 12, e);
    wTwilight = 1 - t;
    wDay = t;
  } else {
    wDay = 1;
  }

  out.nightWeight = wNight;
  out.twilightWeight = wTwilight;
  out.dayWeight = wDay;

  const isMorning = h < 12;
  const twiColors = isMorning ? _cDawn : _cDusk;
  const twiPreset = isMorning ? PRESETS.dawn : PRESETS.dusk;

  blend3Colors(out.zenith, _cNight.zenith, wNight, twiColors.zenith, wTwilight, _cDay.zenith, wDay);
  blend3Colors(out.horizon, _cNight.horizon, wNight, twiColors.horizon, wTwilight, _cDay.horizon, wDay);
  blend3Colors(out.sunColor, _cNight.sunColor, wNight, twiColors.sunColor, wTwilight, _cDay.sunColor, wDay);
  blend3Colors(out.fog, _cNight.fog, wNight, twiColors.fog, wTwilight, _cDay.fog, wDay);
  blend3Colors(out.hemiSky, _cNight.hemiSky, wNight, twiColors.hemiSky, wTwilight, _cDay.hemiSky, wDay);
  blend3Colors(out.hemiGround, _cNight.hemiGround, wNight, twiColors.hemiGround, wTwilight, _cDay.hemiGround, wDay);

  out.sunIntensity =
    PRESETS.night.sunIntensity * wNight +
    twiPreset.sunIntensity * wTwilight +
    PRESETS.day.sunIntensity * wDay;

  out.hemiIntensity =
    PRESETS.night.hemiIntensity * wNight +
    twiPreset.hemiIntensity * wTwilight +
    PRESETS.day.hemiIntensity * wDay;

  out.fogDensity =
    PRESETS.night.fogDensity * wNight +
    twiPreset.fogDensity * wTwilight +
    PRESETS.day.fogDensity * wDay;

  // uNightLamp = smoothstep(4, -4, e) so lamps and windows ramp on at dusk and off at dawn
  out.nightLamp = smoothstep(4, -4, e);

  // Grade strength follows the preset slightly: night uses a little more grain and a deeper warm vignette
  out.grainStrength = 0.015 + wNight * 0.009 + wTwilight * 0.003;
  out.vignetteStrength = 0.28 + wNight * 0.14 + wTwilight * 0.05;

  return out;
}

/**
 * Smooth 1D gust noise on `uTime` for wind direction and strength.
 */
export function sampleWindAt(
  realSeconds: number,
  outDir: THREE.Vector2
): number {
  const driftAngle =
    0.42 +
    Math.sin(realSeconds * 0.023) * 0.28 +
    Math.cos(realSeconds * 0.061) * 0.12;
  outDir.set(Math.cos(driftAngle), Math.sin(driftAngle)).normalize();

  const baseGust =
    Math.sin(realSeconds * 0.37) * 0.5 +
    Math.sin(realSeconds * 0.83 + 1.7) * 0.3 +
    Math.cos(realSeconds * 1.49 + 0.6) * 0.2;
  const gust01 = THREE.MathUtils.clamp(baseGust * 0.5 + 0.5, 0, 1);
  return THREE.MathUtils.lerp(0.35, 1.0, gust01);
}

/**
 * Computes `uAltitude01 = smoothstep(SPACE_START, SPACE_FULL, cameraY)`.
 */
export function computeAltitude01(cameraY: number): number {
  return smoothstep(SPACE_START, SPACE_FULL, cameraY);
}
