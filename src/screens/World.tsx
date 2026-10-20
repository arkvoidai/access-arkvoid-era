import { useEffect, useRef } from 'react';
import { CHARACTERS, CHARACTER_ORDER, LOCATIONS, REALM_NAMES } from '../config/app.config.ts';
import { WORLD_PLACEHOLDER_COPY } from '../config/copy.ts';
import { formatWorld, partOfDay, type PartOfDay } from '../engine/clock.ts';
import { useArkvoidStore } from '../engine/store.ts';
import type { CharacterId, LocationId } from '../engine/types.ts';
import { Button } from '../ui/Button.tsx';
import { Chip } from '../ui/Chip.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Kbd } from '../ui/Kbd.tsx';

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
}

export function WorldHost({ onApiReady }: WorldHostProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onApiReady?.(noopWorldApi);
    return () => {
      noopWorldApi.stop();
    };
  }, [onApiReady]);

  return (
    <div
      ref={mountRef}
      data-testid="world-canvas-host"
      className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center overflow-hidden"
    >
      {/* Faint architectural arch outline in the background */}
      <svg
        viewBox="0 0 640 640"
        fill="none"
        aria-hidden="true"
        className="w-[min(78vw,560px)] h-[min(78vw,560px)] text-[#14151A]/[0.06]"
      >
        <path
          d="M100 560V300C100 178.5 198.5 80 320 80S540 178.5 540 300V560"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M200 560V340C200 273.7 253.7 220 320 220S440 273.7 440 340V560"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="320" cy="410" r="14" fill="#FB5607" fillOpacity="0.22" />
      </svg>
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

  const placeMeta = LOCATIONS[world.playerPlace];
  const charactersHere = CHARACTER_ORDER.filter(
    (cid) => world.npcPlace[cid] === world.playerPlace
  );
  const openPromises = world.promises.filter((p) => p.status === 'open');

  return (
    <div className="relative min-h-dvh w-full bg-[var(--paper-2)] text-[var(--ink)] flex flex-col justify-between pt-20 pb-28 px-4 sm:px-8 overflow-x-hidden">
      {/* 3D Canvas Mount Host */}
      <WorldHost />

      {/* Center calm stage panel */}
      <div className="relative z-10 w-full max-w-[1040px] mx-auto my-auto">
        <div className="rounded-[22px] md:rounded-[28px] bg-[var(--hud-paper)] border border-[var(--line)] p-5 sm:p-7 md:p-8 surface-shadow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="font-mono-label text-[#4B4F56]">
              {placeMeta.region} · {formatWorld(world.now, 'both')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="neutral">
                Realm {world.playerRealm} · {REALM_NAMES[world.playerRealm]}
              </Chip>
              <Chip tone="ember">Spirit {world.spirit}/100</Chip>
            </div>
          </div>

          <h1
            className="font-display text-[#14151A] mb-1.5"
            style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)' }}
          >
            {placeMeta.name}
          </h1>
          <p className="text-[#4B4F56] text-[16px] md:text-[17px] max-w-2xl mb-5">
            {placeMeta.description}
          </p>

          <div className="p-4 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)] mb-5">
            <div className="font-mono-label text-[#4B4F56] mb-1">
              3D Renderer Host · Stage 1 Shell
            </div>
            <p className="text-[#14151A] font-medium mb-0.5">
              {WORLD_PLACEHOLDER_COPY.heading}
            </p>
            <p className="text-[15px] text-[#4B4F56]">
              {WORLD_PLACEHOLDER_COPY.subline}
            </p>
          </div>

          {/* People present at this location + Neighbouring paths */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <div className="font-mono-label text-[#4B4F56] mb-2.5">
                People at {placeMeta.name} ({charactersHere.length})
              </div>
              {charactersHere.length === 0 ? (
                <p className="text-[15px] text-[#4B4F56] py-3">
                  No one is standing watch here at this hour ({partOfDay(world.now)}). Advance the clock or walk to another terrace.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {charactersHere.map((cid) => {
                    const c = CHARACTERS[cid];
                    return (
                      <div
                        key={cid}
                        className="flex items-center justify-between gap-3 p-3.5 rounded-[18px] bg-[#FAF8F5] border border-[var(--line)]"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#14151A] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>{c.name}</span>
                            <span className="text-[#988686]">·</span>
                            <span className="text-[14px] text-[#4B4F56] font-normal">
                              {c.role}
                            </span>
                          </div>
                          <div className="text-[14px] text-[#4B4F56] leading-snug">
                            {world.npcActivity[cid]} · Trust {world.trust[cid]}
                          </div>
                        </div>
                        <Button
                          variant="ember"
                          onClick={() => openOverlay('encounter', cid)}
                        >
                          <span>Speak</span>
                          <Kbd>E</Kbd>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="font-mono-label text-[#4B4F56] mb-3">
                Paths from {placeMeta.name}
              </div>
              <div className="flex flex-wrap gap-2.5 mb-5">
                {placeMeta.neighbors.map((destId) => {
                  const dest = LOCATIONS[destId];
                  const locked = world.playerRealm < dest.minRealm;
                  return (
                    <Button
                      key={destId}
                      variant="paper"
                      onClick={() => moveTo(destId)}
                    >
                      <span>Walk to {dest.name}</span>
                      {locked && (
                        <span className="font-mono text-[11px] text-[#4A1D96]">
                          Realm {dest.minRealm}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              <div className="font-mono-label text-[#4B4F56] mb-2.5">
                Quick actions
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="paper" onClick={practiceBreath}>
                  <span>Practice breath</span>
                  <Kbd>B</Kbd>
                </Button>
                <Button variant="paper" onClick={() => advanceTime(60)}>
                  <span>Wait 1 hour</span>
                </Button>
                <Button variant="ink" onClick={() => setScreen('inspector')}>
                  <Icon name="inspector" size={18} />
                  <span>Inspect Engine</span>
                  <Kbd>I</Kbd>
                </Button>
              </div>
            </div>
          </div>

          {openPromises.length > 0 && (
            <div className="mt-6 pt-5 border-t border-[var(--line)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[14px]">
              <div className="text-[#4B4F56]">
                <span className="font-mono-label text-[#14151A] mr-2">Open Oath</span>
                <span>{openPromises[0].text}</span>
              </div>
              {openPromises[0].dueBy !== null && (
                <span className="font-mono text-[12px] text-[#4B4F56] tabular-nums shrink-0">
                  Due by {formatWorld(openPromises[0].dueBy, 'time')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
