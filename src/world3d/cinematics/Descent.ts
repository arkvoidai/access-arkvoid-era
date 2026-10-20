import * as THREE from 'three';
import { EYE_HEIGHT, LANDMARKS, SISTER } from '../../world/bible.ts';

export interface CinematicKeyframe {
  t: number; // seconds from start
  pos: readonly [number, number, number];
  lookAt: readonly [number, number, number];
  fov: number;
  roll?: number; // radians
}

export interface CinematicOverlayState {
  active: boolean;
  elapsed: number;
  duration: number;
  canSkip: boolean;
  paperFadeOpacity: number;
  line1Visible: boolean; // "Arkvoid."
  line2Visible: boolean; // "A world that *remembers* you."
  stepInsideVisible: boolean; // "Step inside."
}

export interface CinematicTargetEngine {
  setCinematicPose: (
    pos: THREE.Vector3,
    lookAt: THREE.Vector3,
    fov: number,
    rollRad: number
  ) => void;
  exitCinematicPose: () => void;
  isReducedMotion: () => boolean;
  onCinematicOverlayChange?: (state: CinematicOverlayState) => void;
}

let _pendingOpeningDescent = false;

export function queueOpeningDescent(): void {
  _pendingOpeningDescent = true;
}

export function consumeOpeningDescentRequest(): boolean {
  const pending = _pendingOpeningDescent;
  _pendingOpeningDescent = false;
  return pending;
}

function smoothstep01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

const _posCurvePts: THREE.Vector3[] = [];
const _lookCurvePts: THREE.Vector3[] = [];
const _evalPos = new THREE.Vector3();
const _evalLook = new THREE.Vector3();

/**
 * Reusable spline keyframe cinematic runner (shared by the Descent, the Ascent, and the Director).
 */
export function playCinematic(
  engine: CinematicTargetEngine,
  keyframes: ReadonlyArray<CinematicKeyframe>,
  options?: {
    onProgress?: (elapsedSec: number, durationSec: number) => void;
    signal?: { skipped: boolean };
  }
): Promise<void> {
  if (keyframes.length < 2) {
    return Promise.resolve();
  }

  const duration = keyframes[keyframes.length - 1].t;
  _posCurvePts.length = 0;
  _lookCurvePts.length = 0;
  for (const kf of keyframes) {
    _posCurvePts.push(new THREE.Vector3(kf.pos[0], kf.pos[1], kf.pos[2]));
    _lookCurvePts.push(new THREE.Vector3(kf.lookAt[0], kf.lookAt[1], kf.lookAt[2]));
  }

  const posSpline = new THREE.CatmullRomCurve3(_posCurvePts, false, 'centripetal', 0.5);
  const lookSpline = new THREE.CatmullRomCurve3(_lookCurvePts, false, 'centripetal', 0.5);

  return new Promise<void>((resolve) => {
    const startTs = performance.now();
    let rafId: number | null = null;

    const finish = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const last = keyframes[keyframes.length - 1];
      _evalPos.set(last.pos[0], last.pos[1], last.pos[2]);
      _evalLook.set(last.lookAt[0], last.lookAt[1], last.lookAt[2]);
      engine.setCinematicPose(_evalPos, _evalLook, last.fov, 0);
      engine.exitCinematicPose();
      resolve();
    };

    const stepFrame = (nowTs: number) => {
      if (options?.signal?.skipped) {
        finish();
        return;
      }

      const elapsed = (nowTs - startTs) / 1000;
      if (elapsed >= duration) {
        options?.onProgress?.(duration, duration);
        finish();
        return;
      }

      // Find active keyframe segment for piecewise timing & FOV/roll interpolation
      let segIdx = 0;
      for (let i = 0; i < keyframes.length - 1; i++) {
        if (elapsed >= keyframes[i].t && elapsed <= keyframes[i + 1].t) {
          segIdx = i;
          break;
        }
      }

      const k0 = keyframes[segIdx];
      const k1 = keyframes[segIdx + 1];
      const segSpan = Math.max(0.001, k1.t - k0.t);
      const localT = smoothstep01((elapsed - k0.t) / segSpan);

      const splineU = THREE.MathUtils.clamp(
        (segIdx + localT) / (keyframes.length - 1),
        0,
        1
      );

      posSpline.getPoint(splineU, _evalPos);
      lookSpline.getPoint(splineU, _evalLook);

      const fov = THREE.MathUtils.lerp(k0.fov, k1.fov, localT);
      const roll = THREE.MathUtils.lerp(k0.roll ?? 0, k1.roll ?? 0, localT);

      engine.setCinematicPose(_evalPos, _evalLook, fov, roll);
      options?.onProgress?.(elapsed, duration);

      rafId = requestAnimationFrame(stepFrame);
    };

    rafId = requestAnimationFrame(stepFrame);
  });
}

/**
 * Canonical keyframes for the 14-second opening Descent from Space (-110, 5200, -620)
 * through the volumetric Cloud Sea (250..335 m) down to the East Gate spawn (34, 141.65, 0).
 */
export const DESCENT_KEYFRAMES: ReadonlyArray<CinematicKeyframe> = [
  // 0.0s..3.5s: Space (-110, 5200, -620) gazing at the Sister planet (fov 46)
  {
    t: 0.0,
    pos: [-110, 5200, -620],
    lookAt: [SISTER.center[0], SISTER.center[1] - 250, SISTER.center[2]],
    fov: 46,
    roll: 0.0,
  },
  {
    t: 3.5,
    pos: [-92, 4850, -540],
    lookAt: [SISTER.center[0] * 0.65, SISTER.center[1] * 0.45, SISTER.center[2] * 0.65],
    fov: 47,
    roll: 0.02,
  },
  // 3.5s..8.0s: The steep fall with gentle roll into the Cloud Sea (at ~6s camera is inside 250..335m)
  {
    t: 5.8,
    pos: [-28, 320, -165],
    lookAt: [48, 255, -20],
    fov: 54,
    roll: -0.055,
  },
  {
    t: 7.4,
    pos: [4, 262, -62],
    lookAt: [56, 175, -8],
    fov: 56,
    roll: 0.03,
  },
  // 8.0s..14.0s: Break through cloud ceiling, valley mist below, decelerate and settle at spawn
  {
    t: 10.6,
    pos: [22, 162, -16],
    lookAt: [64, 144, 0],
    fov: 57,
    roll: -0.01,
  },
  {
    t: 14.0,
    pos: [
      LANDMARKS.gate.playerSpawn[0],
      LANDMARKS.gate.playerSpawn[1] + EYE_HEIGHT,
      LANDMARKS.gate.playerSpawn[2],
    ],
    lookAt: [64, 144.2, 0],
    fov: 58,
    roll: 0.0,
  },
];

/**
 * Plays the 14-second opening Descent from Space to the East Gate.
 * Skippable with any key, tap, or click; respects `prefers-reduced-motion` with a 3-second cross-fade.
 */
export async function playDescent(
  engine: CinematicTargetEngine,
  externalSignal?: { skip: () => void }
): Promise<void> {
  const signal = { skipped: false };
  const triggerSkip = () => {
    signal.skipped = true;
  };
  if (externalSignal) {
    externalSignal.skip = triggerSkip;
  }

  const onKeySkip = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    signal.skipped = true;
  };
  const onPointerSkip = () => {
    signal.skipped = true;
  };

  // Allow skipping via any key or tap after 0.6s so initial Enter click doesn't immediately cancel it
  const listenerTimer = window.setTimeout(() => {
    window.addEventListener('keydown', onKeySkip, { once: true });
    window.addEventListener('pointerdown', onPointerSkip, { once: true });
  }, 650);

  const reduced = engine.isReducedMotion();

  try {
    if (reduced) {
      // Reduced-motion mode: 3-second calm cross-fade from space view to arrival view keeping the text
      const duration = 3.0;
      const startTs = performance.now();
      await new Promise<void>((resolve) => {
        const stepReduced = (nowTs: number) => {
          if (signal.skipped) {
            resolve();
            return;
          }
          const elapsed = (nowTs - startTs) / 1000;
          if (elapsed >= duration) {
            resolve();
            return;
          }
          if (elapsed < 1.5) {
            const k0 = DESCENT_KEYFRAMES[0];
            _evalPos.set(k0.pos[0], k0.pos[1], k0.pos[2]);
            _evalLook.set(k0.lookAt[0], k0.lookAt[1], k0.lookAt[2]);
            engine.setCinematicPose(_evalPos, _evalLook, k0.fov, 0);
          } else {
            const kEnd = DESCENT_KEYFRAMES[DESCENT_KEYFRAMES.length - 1];
            _evalPos.set(kEnd.pos[0], kEnd.pos[1], kEnd.pos[2]);
            _evalLook.set(kEnd.lookAt[0], kEnd.lookAt[1], kEnd.lookAt[2]);
            engine.setCinematicPose(_evalPos, _evalLook, kEnd.fov, 0);
          }

          const crossFade = Math.exp(-Math.pow((elapsed - 1.5) * 3.2, 2));
          engine.onCinematicOverlayChange?.({
            active: true,
            elapsed,
            duration,
            canSkip: elapsed >= 0.8,
            paperFadeOpacity: crossFade * 0.85,
            line1Visible: elapsed >= 0.2 && elapsed <= 2.7,
            line2Visible: elapsed >= 0.5 && elapsed <= 2.7,
            stepInsideVisible: false,
          });
          requestAnimationFrame(stepReduced);
        };
        requestAnimationFrame(stepReduced);
      });

      const last = DESCENT_KEYFRAMES[DESCENT_KEYFRAMES.length - 1];
      _evalPos.set(last.pos[0], last.pos[1], last.pos[2]);
      _evalLook.set(last.lookAt[0], last.lookAt[1], last.lookAt[2]);
      engine.setCinematicPose(_evalPos, _evalLook, last.fov, 0);
      engine.exitCinematicPose();
    } else {
      await playCinematic(engine, DESCENT_KEYFRAMES, {
        signal,
        onProgress: (elapsed, duration) => {
          const paperFadeOpacity = Math.max(0, 1 - elapsed / 0.9);
          const line1Visible = elapsed >= 0.6 && elapsed <= 4.1;
          const line2Visible = elapsed >= 1.6 && elapsed <= 4.1;
          const stepInsideVisible = elapsed >= 5.2 && elapsed <= 7.5;

          engine.onCinematicOverlayChange?.({
            active: true,
            elapsed,
            duration,
            canSkip: elapsed >= 1.5,
            paperFadeOpacity,
            line1Visible,
            line2Visible,
            stepInsideVisible,
          });
        },
      });
    }
  } finally {
    window.clearTimeout(listenerTimer);
    window.removeEventListener('keydown', onKeySkip);
    window.removeEventListener('pointerdown', onPointerSkip);
    engine.onCinematicOverlayChange?.({
      active: false,
      elapsed: 14,
      duration: 14,
      canSkip: false,
      paperFadeOpacity: 0,
      line1Visible: false,
      line2Visible: false,
      stepInsideVisible: false,
    });
  }
}
