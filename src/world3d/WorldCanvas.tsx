import { useEffect, useRef, useState } from 'react';
import { useArkvoidStore } from '../engine/store.ts';
import type { LocationId } from '../engine/types.ts';
import type { WorldApi } from '../screens/World.tsx';
import { PLACES } from '../world/bible.ts';
import {
  consumeOpeningDescentRequest,
  type CinematicOverlayState,
} from './cinematics/Descent.ts';
import type { QualityPreference } from './Quality.ts';
import { WorldEngine, type EngineTelemetry } from './WorldEngine.ts';

export interface WorldCanvasProps {
  onApiReady?: (api: WorldApi) => void;
  debugOpen?: boolean;
  onToggleDebug?: () => void;
}

export default function WorldCanvas({
  onApiReady,
  debugOpen = false,
  onToggleDebug,
}: WorldCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null);
  const [cinematic, setCinematic] = useState<CinematicOverlayState | null>(null);
  const [soundCaption, setSoundCaption] = useState<string | null>(null);

  const playerPlace = useArkvoidStore((s) => s.world.playerPlace);
  const openOverlay = useArkvoidStore((s) => s.openOverlay);
  const lastSyncedPlaceRef = useRef<LocationId>(playerPlace);

  // Initialize WebGLRenderer & WorldEngine once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let captionTimer: number | null = null;

    const engine = new WorldEngine(container, {
      onTelemetry: (snap) => {
        setTelemetry(snap);
      },
      onPlaceWalked: (newPlace) => {
        lastSyncedPlaceRef.current = newPlace;
        const currentStorePlace = useArkvoidStore.getState().world.playerPlace;
        if (currentStorePlace !== newPlace) {
          useArkvoidStore.getState().moveTo(newPlace);
        }
      },
      onCharacterClicked: (cid) => {
        openOverlay('encounter', cid);
      },
      onCinematicOverlay: (state) => {
        setCinematic(state.active ? state : null);
      },
      onSoundCaption: (caption) => {
        setSoundCaption(caption);
        if (captionTimer !== null) {
          window.clearTimeout(captionTimer);
        }
        captionTimer = window.setTimeout(() => {
          setSoundCaption(null);
        }, 3200);
      },
    });

    engineRef.current = engine;
    engine.start();
    engine.emitTelemetry();

    // If the user clicked "Explore the world" or "Watch the 4-minute guided demo" from Intro,
    // play the 14-second opening Descent from Space (-110, 5200, -620) to the East Gate
    if (consumeOpeningDescentRequest()) {
      engine.playOpeningDescent().catch(() => {});
    }

    const api: WorldApi = {
      start: () => engine.start(),
      stop: () => engine.stop(),
      resize: (w, h) => engine.resize(w, h),
      setTimeOfDay: (_part, minuteOfDay) => {
        engine.setWorldHour(minuteOfDay / 60);
      },
      focus: (targetId) => engine.focusTarget(targetId),
    };
    onApiReady?.(api);

    return () => {
      if (captionTimer !== null) {
        window.clearTimeout(captionTimer);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [onApiReady, openOverlay]);

  // Teleport 3D camera when user triggers moveTo(place) from UI buttons or Atlas
  useEffect(() => {
    if (!engineRef.current) return;
    if (lastSyncedPlaceRef.current !== playerPlace) {
      lastSyncedPlaceRef.current = playerPlace;
      engineRef.current.teleportToPlace(playerPlace);
    }
  }, [playerPlace]);

  const handleQualitySelect = (pref: QualityPreference) => {
    engineRef.current?.setQualityPreference(pref);
  };

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden">
      {/* Dedicated isolated WebGL canvas mount container */}
      <div
        ref={mountRef}
        data-testid="world-canvas-host"
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* THE DESCENT OPENING CINEMATIC OVERLAY (Section 8) */}
      {cinematic && cinematic.active && (
        <div
          data-testid="descent-cinematic-overlay"
          className="fixed inset-0 z-30 pointer-events-none flex flex-col items-center justify-center pb-28 sm:pb-36 px-6"
        >
          {/* Paper-to-ink crossfade curtain */}
          {cinematic.paperFadeOpacity > 0.01 && (
            <div
              aria-hidden="true"
              style={{ opacity: cinematic.paperFadeOpacity }}
              className="absolute inset-0 bg-[#F6F4EF] transition-opacity duration-300"
            />
          )}

          {/* Space Title: "Arkvoid." + "A world that *remembers* you." */}
          <div className="relative z-10 text-center space-y-3">
            <div className="overflow-hidden py-1">
              <div
                style={{
                  transform: cinematic.line1Visible ? 'translateY(0%)' : 'translateY(105%)',
                  opacity: cinematic.line1Visible ? 1 : 0,
                  transition: 'transform 650ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms ease',
                }}
                className="font-sans font-medium text-4xl sm:text-6xl tracking-tight text-[#FAF8F5]"
              >
                Arkvoid.
              </div>
            </div>

            <div className="overflow-hidden py-1">
              <div
                style={{
                  transform: cinematic.line2Visible ? 'translateY(0%)' : 'translateY(105%)',
                  opacity: cinematic.line2Visible ? 1 : 0,
                  transition: 'transform 650ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms ease',
                }}
                className="font-sans font-medium text-xl sm:text-3xl tracking-tight text-[#EDE5D8]"
              >
                A world that <em className="font-display italic font-normal text-[#FF9552]">remembers</em> you.
              </div>
            </div>

            {/* Cloud Sea fall cue: "Step inside." (5.2s..7.5s) */}
            <div className="overflow-hidden py-1">
              <div
                style={{
                  transform: cinematic.stepInsideVisible ? 'translateY(0%)' : 'translateY(105%)',
                  opacity: cinematic.stepInsideVisible ? 1 : 0,
                  transition: 'transform 550ms cubic-bezier(0.16, 1, 0.3, 1), opacity 450ms ease',
                }}
                className="font-display italic text-2xl sm:text-4xl text-[#FAF8F5]"
              >
                Step inside.
              </div>
            </div>
          </div>

          {/* Calm Skip button after 1.5 seconds */}
          {cinematic.canSkip && (
            <div className="fixed bottom-24 right-6 z-40 pointer-events-auto">
              <button
                type="button"
                data-testid="skip-descent-btn"
                onClick={() => engineRef.current?.skipOpeningDescent()}
                className="px-4 py-2 rounded-full bg-[#14151A] text-[#FAF8F5] border border-[#FAF8F5]/20 font-mono text-[11px] uppercase tracking-wider cursor-pointer hover:bg-[#23252D]"
              >
                Skip Intro
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sound Caption Bracketed Strip (Section 7) */}
      {soundCaption && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sound-caption-strip"
          className="fixed bottom-[132px] left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3.5 py-1 rounded-full bg-[#14151A] text-[#FAF8F5] font-mono text-[11px] tracking-wider"
        >
          {soundCaption}
        </div>
      )}

      {/* Renderer, Sky, Cloud Sea & Time Tools Debug Overlay (?debug=1 or Shift + H) */}
      {debugOpen && telemetry && (
        <aside
          aria-label="3D Engine & Sky Diagnostics"
          data-testid="renderer-debug-panel"
          className="fixed top-16 right-4 z-40 w-[min(92vw,376px)] max-h-[calc(100dvh-256px)] overflow-y-auto rounded-[20px] bg-[#FAF8F5] border border-[var(--line)] p-4 text-[12px] text-[#14151A] surface-shadow pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[var(--line)]">
            <div>
              <div className="font-mono-label text-[#4B4F56]">3D Engine Room · WebGL2</div>
              <div className="font-medium text-[14px]">
                Ink &amp; Ember Sky &amp; Cloud Pipeline ({telemetry.tier.toUpperCase()})
              </div>
            </div>
            {onToggleDebug && (
              <button
                type="button"
                onClick={onToggleDebug}
                className="px-2.5 py-1 rounded-full bg-[#F3F0EB] border border-[var(--line)] font-mono text-[11px] cursor-pointer"
              >
                Close
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3 font-mono tabular-nums">
            <div className="p-2 rounded-[12px] bg-[#F3F0EB]">
              <div className="text-[10px] text-[#4B4F56] uppercase">Frame</div>
              <div className="text-[13px] font-medium">
                {telemetry.avgFrameMs}ms ({telemetry.fps}fps)
              </div>
            </div>
            <div className="p-2 rounded-[12px] bg-[#F3F0EB]">
              <div className="text-[10px] text-[#4B4F56] uppercase">p95 / Cloud GPU</div>
              <div className="text-[13px] font-medium">
                {telemetry.p95FrameMs}ms /{' '}
                {telemetry.cloudGpuMs !== null ? `${telemetry.cloudGpuMs}ms` : 'n/a'}
              </div>
            </div>
            <div className="p-2 rounded-[12px] bg-[#F3F0EB]">
              <div className="text-[10px] text-[#4B4F56] uppercase">Draws / Tris</div>
              <div className="text-[13px] font-medium">
                {telemetry.drawCalls} / {Math.round(telemetry.triangles / 1000)}k
              </div>
            </div>
          </div>

          <div className="space-y-1 font-mono text-[11px] text-[#4B4F56] mb-3 tabular-nums">
            <div className="flex justify-between">
              <span>Player xyz (m):</span>
              <span className="text-[#14151A]">
                [{telemetry.playerPos[0]}, {telemetry.playerPos[1]}, {telemetry.playerPos[2]}]
              </span>
            </div>
            <div className="flex justify-between">
              <span>Bible placeAt / Surface:</span>
              <span className="text-[#14151A]">
                {PLACES[telemetry.currentPlace]?.label ?? telemetry.currentPlace} ·{' '}
                {telemetry.surface}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Terrain Chunks / Footpaths:</span>
              <span className="text-[#14151A]">
                {telemetry.visibleChunks}/{telemetry.activeChunks} chunks · {telemetry.wearSteps}{' '}
                steps (wear {Math.round(telemetry.wearSampleHere * 100)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Sun Elevation / Hour:</span>
              <span className="text-[#14151A]">
                {telemetry.sunElevationDeg}° · {telemetry.worldHours.toFixed(1)}h
              </span>
            </div>
          </div>

          {/* SECTION 9: Time of Day Slider (0..24h) & Jump-To Presets */}
          <div className="mb-3 pt-2.5 border-t border-[var(--line)]">
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="debug-time-slider"
                className="font-mono-label text-[#4B4F56]"
              >
                Time of Day (0 – 24 h)
              </label>
              <span className="font-mono text-[11px] text-[#14151A] tabular-nums">
                {telemetry.worldHours.toFixed(1)}h
              </span>
            </div>
            <input
              id="debug-time-slider"
              data-testid="debug-time-slider"
              type="range"
              min={0}
              max={24}
              step={0.1}
              value={telemetry.worldHours}
              onChange={(e) => {
                engineRef.current?.setWorldHour( parseFloat(e.target.value) );
              }}
              className="w-full accent-[#FB5607] cursor-pointer mb-2"
            />
            <div className="grid grid-cols-4 gap-1.5 mb-1.5">
              {(
                [
                  ['Dawn', 6.0],
                  ['Noon', 12.0],
                  ['Dusk', 18.08],
                  ['Midnight', 0.0],
                ] as const
              ).map(([label, hr]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => engineRef.current?.setWorldHour(hr)}
                  className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] uppercase cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => engineRef.current?.setCameraYawPitch(-0.97, 0.22)}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] uppercase cursor-pointer"
              >
                Look Sister
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.setCameraYawPitch(Math.PI, 0.12)}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] uppercase cursor-pointer"
              >
                Look West
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.setCameraYawPitch(0, 0.06)}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] uppercase cursor-pointer"
              >
                Look East
              </button>
            </div>
          </div>

          {/* SECTION 9: Fly Toggle, Altitude & Landmark Teleports */}
          <div className="mb-3 pt-2.5 border-t border-[var(--line)]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono-label text-[#4B4F56]">
                Terrain, Water &amp; Altitude
              </span>
              <button
                type="button"
                data-testid="debug-fly-toggle"
                onClick={() => engineRef.current?.setFlying(!telemetry.flying)}
                className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] uppercase border cursor-pointer ${
                  telemetry.flying
                    ? 'bg-[#FB5607] text-[#FAF8F5] border-[#FB5607]'
                    : 'bg-[#F3F0EB] text-[#14151A] border-[var(--line)]'
                }`}
              >
                Fly: {telemetry.flying ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              {([300, 800, 1500, 3000, 5200] as const).map((alt) => (
                <button
                  key={alt}
                  type="button"
                  onClick={() => engineRef.current?.teleportToAltitude(alt)}
                  className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] cursor-pointer"
                >
                  {alt} m
                </button>
              ))}
              <button
                type="button"
                onClick={() => engineRef.current?.teleportToPlace('east-gate')}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] cursor-pointer"
              >
                Gate (140 m)
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => engineRef.current?.teleportToCoords(-102, 430, -542, 0.78, 0.08)}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] cursor-pointer"
              >
                Hero Maple
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.teleportToCoords(-262, 96, 214, 2.35, -0.25)}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] cursor-pointer"
              >
                Valley Lake
              </button>
              <button
                type="button"
                data-testid="debug-stamp-wear"
                onClick={() => void engineRef.current?.stampFootpathDemo()}
                className="py-1 rounded-full bg-[#F3F0EB] hover:bg-[#E7E2D8] border border-[var(--line)] font-mono text-[10px] cursor-pointer"
              >
                Wear Path
              </button>
            </div>
          </div>

          {/* Quality Governor + Audio Captions + Replay Descent */}
          <div className="mb-2 pt-2.5 border-t border-[var(--line)]">
            <div className="font-mono-label text-[#4B4F56] mb-1.5">Quality Governor</div>
            <div className="grid grid-cols-4 gap-1.5 mb-2.5">
              {(['auto', 'high', 'mid', 'low'] as const).map((pref) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => handleQualitySelect(pref)}
                  className={`py-1 rounded-full font-mono text-[10px] uppercase border cursor-pointer ${
                    telemetry.preference === pref
                      ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
                      : 'bg-[#F3F0EB] text-[#14151A] border-[var(--line)]'
                  }`}
                >
                  {pref}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  engineRef.current?.setSoundCaptionsEnabled(!telemetry.soundCaptionsEnabled)
                }
                className={`py-1.5 rounded-full font-mono text-[10px] uppercase border cursor-pointer ${
                  telemetry.soundCaptionsEnabled
                    ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
                    : 'bg-[#F3F0EB] text-[#14151A] border-[var(--line)]'
                }`}
              >
                Captions: {telemetry.soundCaptionsEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.playOpeningDescent()}
                className="py-1.5 rounded-full bg-[#FB5607] text-[#FAF8F5] font-mono text-[10px] uppercase cursor-pointer"
              >
                Play Descent (14s)
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
