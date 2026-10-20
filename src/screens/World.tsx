import { lazy, Suspense, useEffect, useState } from 'react';
import { CHARACTERS, CHARACTER_ORDER, LOCATIONS, REALM_NAMES } from '../config/app.config.ts';
import { formatWorld, partOfDay, type PartOfDay } from '../engine/clock.ts';
import { useArkvoidStore } from '../engine/store.ts';
import type { CharacterId, LocationId } from '../engine/types.ts';
import { Button } from '../ui/Button.tsx';
import { Chip } from '../ui/Chip.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Kbd } from '../ui/Kbd.tsx';

const WorldCanvas = lazy(() => import('../world3d/WorldCanvas.tsx'));

export interface WorldApi {
  start: () => void;
  stop: () => void;
  resize: (width: number, height: number) => void;
  setTimeOfDay: (part: PartOfDay, minuteOfDay: number) => void;
  focus: (targetId: CharacterId | LocationId) => void;
}

export const noopWorldApi: WorldApi = {
  start: () => {},
  stop: () => {},
  resize: () => {},
  setTimeOfDay: () => {},
  focus: () => {},
};

export interface WorldHostProps {
  onApiReady?: (api: WorldApi) => void;
  debugOpen?: boolean;
  onToggleDebug?: () => void;
}

export function WorldHost({ onApiReady, debugOpen, onToggleDebug }: WorldHostProps) {
  return (
    <div className="fixed inset-0 z-0 w-full h-full overflow-hidden bg-[#EADCCB]">
      <Suspense
        fallback={
          <div
            data-testid="world-canvas-loading"
            className="w-full h-full flex items-center justify-center bg-[#EADCCB] text-[#14151A] font-mono text-[12px] uppercase tracking-wider"
          >
            Entering the valley...
          </div>
        }
      >
        <WorldCanvas
          onApiReady={onApiReady}
          debugOpen={debugOpen}
          onToggleDebug={onToggleDebug}
        />
      </Suspense>
    </div>
  );
}

export default function World() {
  const world = useArkvoidStore((s) => s.world);
  const openOverlay = useArkvoidStore((s) => s.openOverlay);
  const setScreen = useArkvoidStore((s) => s.setScreen);
  const moveTo = useArkvoidStore((s) => s.moveTo);
  const advanceTime = useArkvoidStore((s) => s.advanceTime);
  const practiceBreath = useArkvoidStore((s) => s.practiceBreath);

  const [hudExpanded, setHudExpanded] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const [debugOpen, setDebugOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });

  // Listen for Shift + H to toggle 3D renderer debug overlay while in the 3D world
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setDebugOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const placeMeta = LOCATIONS[world.playerPlace];
  const charactersHere = CHARACTER_ORDER.filter(
    (cid) => world.npcPlace[cid] === world.playerPlace
  );
  const openPromises = world.promises.filter((p) => p.status === 'open');

  return (
    <div className="relative min-h-dvh w-full text-[var(--ink)] overflow-hidden pointer-events-none">
      {/* Real-time 3D WebGL2 World Canvas (100% unobstructed center viewport) */}
      <WorldHost
        debugOpen={debugOpen}
        onToggleDebug={() => setDebugOpen((v) => !v)}
      />

      {/* Subtle top-left location & movement whisper (desktop & tablet) */}
      <div className="fixed top-16 left-4 sm:left-6 z-20 pointer-events-auto flex items-center gap-2">
        <div className="px-3 py-1 rounded-full bg-[var(--hud-paper)] border border-[var(--line)] surface-shadow flex items-center gap-2 text-[11px]">
          <span className="hidden sm:inline font-mono uppercase tracking-wider text-[#4B4F56]">
            WASD Walk · Drag Look · Click Character
          </span>
          <span className="hidden sm:inline text-[#988686]">·</span>
          <button
            type="button"
            onClick={() => {
              const next = !debugOpen;
              setDebugOpen(next);
              if (next && typeof window !== 'undefined' && window.innerWidth < 640) {
                setHudExpanded(false);
              }
            }}
            className="font-mono text-[11px] text-[#14151A] underline underline-offset-2 cursor-pointer"
          >
            {debugOpen ? 'Hide 3D Stats' : '3D Stats (Shift+H)'}
          </button>
        </div>
      </div>

      {/* Collapsible Bottom Control Dock (sleek low-profile strip leaving the East Gate arch & characters unobstructed) */}
      <div className="fixed bottom-[72px] inset-x-0 z-20 px-3 sm:px-6 flex flex-col items-center pointer-events-none">
        <div className="w-full max-w-[960px] flex flex-col items-center">
          {/* Collapse / Expand Pill Tab */}
          <div className="pointer-events-auto mb-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !hudExpanded;
                setHudExpanded(next);
                if (next && typeof window !== 'undefined' && window.innerWidth < 640) {
                  setDebugOpen(false);
                }
              }}
              aria-expanded={hudExpanded}
              className="px-3.5 py-1 rounded-full bg-[var(--hud-paper)] border border-[var(--line)] surface-shadow font-mono text-[11px] uppercase tracking-wider text-[#14151A] hover:bg-[#F3F0EB] cursor-pointer flex items-center gap-2"
            >
              <span>
                {hudExpanded
                  ? 'Hide Valley HUD'
                  : `${placeMeta.name} · ${charactersHere.length} Present · Show HUD`}
              </span>
            </button>
          </div>

          {hudExpanded && (
            <div className="pointer-events-auto w-full max-h-[38vh] sm:max-h-none overflow-y-auto rounded-[20px] bg-[var(--hud-paper)] border border-[var(--line)] p-3 sm:p-4 surface-shadow">
              {/* Compact header row: Place name, Realm & Spirit, and Oath */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[var(--line)]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <h1 className="font-display text-base sm:text-lg text-[#14151A]">
                    {placeMeta.name}
                  </h1>
                  <span className="text-[#988686]">·</span>
                  <span className="font-mono text-[11px] text-[#4B4F56] uppercase tracking-wider">
                    {placeMeta.region} · {formatWorld(world.now, 'both')}
                  </span>
                  {openPromises.length > 0 && (
                    <span className="hidden lg:inline text-[12px] text-[#4B4F56] truncate max-w-[260px]">
                      · <strong className="font-mono uppercase text-[#14151A]">Oath:</strong>{' '}
                      {openPromises[0].text}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <Chip tone="neutral">
                    Realm {world.playerRealm} · {REALM_NAMES[world.playerRealm]}
                  </Chip>
                  <Chip tone="ember">Spirit {world.spirit}/100</Chip>
                </div>
              </div>

              {/* Sleek horizontal action strip: People present + Paths & Quick actions */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                {/* People at this location */}
                <div className="flex flex-wrap items-center gap-2">
                  {charactersHere.length === 0 ? (
                    <p className="text-[12px] text-[#4B4F56]">
                      No one standing watch here at {partOfDay(world.now)}.
                    </p>
                  ) : (
                    charactersHere.map((cid) => {
                      const c = CHARACTERS[cid];
                      return (
                        <div
                          key={cid}
                          className="flex items-center justify-between gap-2.5 pl-3 pr-1.5 py-1 rounded-full bg-[#FAF8F5] border border-[var(--line)]"
                        >
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="text-[13px] font-medium text-[#14151A]">
                              {c.name}
                            </span>
                            <span className="text-[11px] font-mono text-[#4B4F56]">
                              · T{world.trust[cid]}
                            </span>
                          </div>
                          <Button
                            variant="ember"
                            size="md"
                            onClick={() => openOverlay('encounter', cid)}
                          >
                            <span>Speak</span>
                            <Kbd>E</Kbd>
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Paths + Quick Actions */}
                <div className="flex flex-wrap items-center lg:justify-end gap-1.5">
                  {placeMeta.neighbors.map((destId) => {
                    const dest = LOCATIONS[destId];
                    const locked = world.playerRealm < dest.minRealm;
                    return (
                      <Button
                        key={destId}
                        variant="paper"
                        size="md"
                        onClick={() => moveTo(destId)}
                      >
                        <span>Walk to {dest.name}</span>
                        {locked && (
                          <span className="font-mono text-[10px] text-[#4A1D96]">
                            R{dest.minRealm}
                          </span>
                        )}
                      </Button>
                    );
                  })}
                  <Button variant="paper" size="md" onClick={practiceBreath}>
                    <span>Practice breath</span>
                    <Kbd>B</Kbd>
                  </Button>
                  <Button variant="paper" size="md" onClick={() => advanceTime(60)}>
                    <span>Wait 1 hour</span>
                  </Button>
                  <Button variant="ink" size="md" onClick={() => setScreen('inspector')}>
                    <Icon name="inspector" size={16} />
                    <span>Inspect Engine</span>
                    <Kbd>I</Kbd>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
