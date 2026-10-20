import * as THREE from 'three';

export type QualityTier = 'high' | 'mid' | 'low';
export type QualityPreference = 'auto' | QualityTier;

export interface QualityPostConfig {
  bloom: boolean;
  dof: boolean;
  ssao: boolean;
  grain: boolean;
}

export interface QualityConfig {
  tier: QualityTier;
  dprCap: number;
  renderScale: number;
  msaa: number;
  shadowNearSize: number;
  shadowFarSize: number;
  viewDistance: number;
  terrainLod0Radius: number;
  grassRadius: number;
  grassDensity: number;
  treeDensity: number;
  cloudSteps: number;
  waterQuality: number;
  crowdMax: number;
  particleScale: number;
  post: QualityPostConfig;
}

export const QUALITY: Readonly<Record<QualityTier, QualityConfig>> = {
  high: {
    tier: 'high',
    dprCap: 2,
    renderScale: 1,
    msaa: 4,
    shadowNearSize: 2048,
    shadowFarSize: 1024,
    viewDistance: 5500,
    terrainLod0Radius: 320,
    grassRadius: 70,
    grassDensity: 1,
    treeDensity: 1,
    cloudSteps: 28,
    waterQuality: 2,
    crowdMax: 400,
    particleScale: 1,
    post: {
      bloom: true,
      dof: true,
      ssao: true,
      grain: true,
    },
  },
  mid: {
    tier: 'mid',
    dprCap: 1.5,
    renderScale: 0.9,
    msaa: 0,
    shadowNearSize: 1536,
    shadowFarSize: 0,
    viewDistance: 3500,
    terrainLod0Radius: 240,
    grassRadius: 45,
    grassDensity: 0.6,
    treeDensity: 0.65,
    cloudSteps: 14,
    waterQuality: 1,
    crowdMax: 180,
    particleScale: 0.6,
    post: {
      bloom: true,
      dof: false,
      ssao: false,
      grain: true,
    },
  },
  low: {
    tier: 'low',
    dprCap: 1,
    renderScale: 0.75,
    msaa: 0,
    shadowNearSize: 0,
    shadowFarSize: 0,
    viewDistance: 1800,
    terrainLod0Radius: 160,
    grassRadius: 0,
    grassDensity: 0,
    treeDensity: 0.35,
    cloudSteps: 6,
    waterQuality: 0,
    crowdMax: 60,
    particleScale: 0.3,
    post: {
      bloom: false,
      dof: false,
      ssao: false,
      grain: false,
    },
  },
};

export function isHeadlessBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean(navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));
}

export function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Selects the initial quality tier from hardware hints and a fast GPU probe.
 * Phones (coarse pointer) start on `mid` at best.
 */
export function detectInitialQualityTier(renderer?: THREE.WebGLRenderer): QualityTier {
  if (typeof navigator === 'undefined') return 'mid';

  const coarse = isCoarsePointerDevice();
  const navWithMem = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = typeof navWithMem.deviceMemory === 'number' ? navWithMem.deviceMemory : 8;
  const cores = navigator.hardwareConcurrency || 4;

  if (deviceMemory <= 2 || cores <= 2) {
    return 'low';
  }

  // Fast synthetic GPU draw probe if a WebGLRenderer is supplied
  let probeMs = 4;
  if (renderer && !isHeadlessBrowser()) {
    try {
      const target = new THREE.WebGLRenderTarget(256, 256);
      const probeScene = new THREE.Scene();
      const probeCam = new THREE.PerspectiveCamera(60, 1, 0.1, 50);
      probeCam.position.set(0, 0, 5);
      const geo = new THREE.SphereGeometry(1, 32, 32);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
      const mesh = new THREE.Mesh(geo, mat);
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(2, 3, 4);
      probeScene.add(mesh, light);

      const prevTarget = renderer.getRenderTarget();
      const t0 = performance.now();
      for (let i = 0; i < 6; i++) {
        mesh.rotation.y += 0.2;
        renderer.setRenderTarget(target);
        renderer.render(probeScene, probeCam);
      }
      probeMs = (performance.now() - t0) / 6;
      renderer.setRenderTarget(prevTarget);
      geo.dispose();
      mat.dispose();
      target.dispose();
    } catch {
      probeMs = 8;
    }
  }

  if (coarse) {
    return probeMs > 14 || deviceMemory < 4 ? 'low' : 'mid';
  }

  if (isHeadlessBrowser()) {
    return 'low';
  }

  if (probeMs < 8 && deviceMemory >= 8 && cores >= 6) {
    return 'high';
  }
  if (probeMs > 18) {
    return 'low';
  }
  return 'mid';
}

export interface GovernorLogEntry {
  atSeconds: number;
  from: QualityTier;
  to: QualityTier;
  avgFrameMs: number;
  reason: string;
}

/**
 * Rolling 90-frame governor:
 * - Step DOWN when rolling average > 22 ms for 3 seconds.
 * - Step UP when rolling average < 12 ms for 12 seconds.
 * - Never change more than once every 6 seconds.
 */
export class QualityGovernor {
  private tier: QualityTier;
  private preference: QualityPreference = 'auto';
  private samples: number[] = [];
  private readonly maxSamples = 90;
  private highMsDuration = 0;
  private lowMsDuration = 0;
  private lastChangeTime = -999;
  private elapsedSeconds = 0;
  private logs: GovernorLogEntry[] = [];
  private onTierChange?: (tier: QualityTier, log?: GovernorLogEntry) => void;

  constructor(
    initialTier: QualityTier = 'mid',
    onTierChange?: (tier: QualityTier, log?: GovernorLogEntry) => void
  ) {
    this.tier = initialTier;
    this.onTierChange = onTierChange;
  }

  public getTier(): QualityTier {
    return this.tier;
  }

  public getConfig(): QualityConfig {
    return QUALITY[this.tier];
  }

  public getPreference(): QualityPreference {
    return this.preference;
  }

  public setPreference(pref: QualityPreference, fallbackAutoTier?: QualityTier): void {
    this.preference = pref;
    this.highMsDuration = 0;
    this.lowMsDuration = 0;
    if (pref !== 'auto' && pref !== this.tier) {
      const prev = this.tier;
      this.tier = pref;
      const entry: GovernorLogEntry = {
        atSeconds: Number(this.elapsedSeconds.toFixed(1)),
        from: prev,
        to: pref,
        avgFrameMs: this.getAverageFrameMs(),
        reason: `Manual override to ${pref}`,
      };
      this.logs.unshift(entry);
      if (this.logs.length > 25) this.logs.length = 25;
      this.onTierChange?.(this.tier, entry);
    } else if (pref === 'auto' && fallbackAutoTier && fallbackAutoTier !== this.tier) {
      this.tier = fallbackAutoTier;
      this.onTierChange?.(this.tier);
    }
  }

  public recordFrame(frameMs: number): QualityTier {
    const clampedMs = Math.max(0.5, Math.min(250, frameMs));
    const dtSec = clampedMs / 1000;
    this.elapsedSeconds += dtSec;

    this.samples.push(clampedMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    if (this.preference !== 'auto' || this.samples.length < 15) {
      return this.tier;
    }

    const avg = this.getAverageFrameMs();
    if (avg > 22) {
      this.highMsDuration += dtSec;
      this.lowMsDuration = 0;
    } else if (avg < 12) {
      this.lowMsDuration += dtSec;
      this.highMsDuration = 0;
    } else {
      this.highMsDuration = Math.max(0, this.highMsDuration - dtSec * 0.5);
      this.lowMsDuration = Math.max(0, this.lowMsDuration - dtSec * 0.5);
    }

    const canChange = this.elapsedSeconds - this.lastChangeTime >= 6.0;
    if (!canChange) {
      return this.tier;
    }

    if (this.highMsDuration >= 3.0 && this.tier !== 'low') {
      const prev = this.tier;
      const next: QualityTier = this.tier === 'high' ? 'mid' : 'low';
      this.applyStep(prev, next, avg, 'avg > 22ms for 3s');
    } else if (this.lowMsDuration >= 12.0 && this.tier !== 'high') {
      if (isCoarsePointerDevice() && this.tier === 'mid') {
        return this.tier;
      }
      const prev = this.tier;
      const next: QualityTier = this.tier === 'low' ? 'mid' : 'high';
      this.applyStep(prev, next, avg, 'avg < 12ms for 12s');
    }

    return this.tier;
  }

  private applyStep(
    from: QualityTier,
    to: QualityTier,
    avgFrameMs: number,
    reason: string
  ): void {
    this.tier = to;
    this.highMsDuration = 0;
    this.lowMsDuration = 0;
    this.lastChangeTime = this.elapsedSeconds;
    const entry: GovernorLogEntry = {
      atSeconds: Number(this.elapsedSeconds.toFixed(1)),
      from,
      to,
      avgFrameMs: Number(avgFrameMs.toFixed(1)),
      reason,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 25) this.logs.length = 25;
    this.onTierChange?.(this.tier, entry);
  }

  public getAverageFrameMs(): number {
    if (this.samples.length === 0) return 16.6;
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) {
      sum += this.samples[i];
    }
    return sum / this.samples.length;
  }

  public getP95FrameMs(): number {
    if (this.samples.length === 0) return 16.6;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx];
  }

  public getLogs(): readonly GovernorLogEntry[] {
    return this.logs;
  }
}
