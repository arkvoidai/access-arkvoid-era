import { useMemo, useState } from 'react';
import { CHARACTERS, CHARACTER_ORDER, LOCATIONS, REALM_NAMES } from '../config/app.config.ts';
import { capitalizePartOfDay, dayOf, formatClockDigits, formatWorld, partOfDay } from '../engine/clock.ts';
import { getLastRetrieval } from '../engine/memory.ts';
import { getRemovedInventedSourcesCount, getRuleLog } from '../engine/rules.ts';
import { runEngineSelfTest, type SelfTestItemResult } from '../engine/selfTest.ts';
import { useArkvoidStore } from '../engine/store.ts';
import type { CharacterId, LocationId } from '../engine/types.ts';
import { Button } from '../ui/Button.tsx';
import { Chip } from '../ui/Chip.tsx';
import { Icon } from '../ui/Icon.tsx';

type ConsoleTab = 'ledger' | 'rules' | 'tests';

export default function EngineConsole() {
  const world = useArkvoidStore((s) => s.world);
  const ledgerInstance = useArkvoidStore((s) => s.ledgerInstance);
  const ledgerEvents = useArkvoidStore((s) => s.ledgerEvents);
  const meter = useArkvoidStore((s) => s.meter);
  const ai = useArkvoidStore((s) => s.ai);
  const clockPlaying = useArkvoidStore((s) => s.ui.clockPlaying);
  const toggleClockPlaying = useArkvoidStore((s) => s.toggleClockPlaying);
  const advanceTime = useArkvoidStore((s) => s.advanceTime);
  const moveTo = useArkvoidStore((s) => s.moveTo);
  const resetWorld = useArkvoidStore((s) => s.resetWorld);
  const openOverlay = useArkvoidStore((s) => s.openOverlay);
  const setScreen = useArkvoidStore((s) => s.setScreen);
  const commitProposal = useArkvoidStore((s) => s.commitProposal);
  const syncFromEngine = useArkvoidStore((s) => s.syncFromEngine);

  const [activeTab, setActiveTab] = useState<ConsoleTab>('ledger');
  const [selectedChainEventId, setSelectedChainEventId] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [testResults, setTestResults] = useState<SelfTestItemResult[] | null>(null);

  const reversedLedger = useMemo(() => [...ledgerEvents].reverse(), [ledgerEvents]);
  const causalChain = useMemo(() => {
    if (!selectedChainEventId) return [];
    return ledgerInstance.chain(selectedChainEventId);
  }, [ledgerInstance, selectedChainEventId, ledgerEvents]);

  const ruleLog = getRuleLog();
  const removedSourcesCount = getRemovedInventedSourcesCount();
  const lastRetrieval = getLastRetrieval();

  const handleRunSelfTest = () => {
    const out = runEngineSelfTest();
    setTestResults(out);
    syncFromEngine();
  };

  const allTestsPassed =
    testResults !== null && testResults.length > 0 && testResults.every((t) => t.passed);

  return (
    <div className="min-h-dvh w-full bg-[var(--paper)] text-[var(--ink)] pt-24 pb-32 px-4 sm:px-8 max-w-[1440px] mx-auto">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b border-[var(--line)]">
        <div>
          <div className="font-mono-label text-[#4B4F56] mb-1">
            Engine Inspector · Permanent Record & Deterministic Rules
          </div>
          <h1 className="font-display text-2xl sm:text-3xl text-[#14151A]">
            World Engine Console
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="paper"
            onClick={() => ledgerInstance.exportJson()}
          >
            <Icon name="download" size={18} />
            <span>Export ledger</span>
          </Button>

          {!confirmingReset ? (
            <Button
              variant="paper"
              onClick={() => setConfirmingReset(true)}
            >
              <Icon name="refresh" size={18} />
              <span>Reset world</span>
            </Button>
          ) : (
            <div className="inline-flex items-center gap-2 p-1 rounded-full bg-[#FFE9DE] border border-[#D94400]/30">
              <Button
                variant="ember"
                onClick={async () => {
                  await resetWorld();
                  setConfirmingReset(false);
                  setSelectedChainEventId(null);
                }}
              >
                Confirm reset
              </Button>
              <Button
                variant="paper"
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </Button>
            </div>
          )}

          <Button variant="ink" onClick={() => setScreen('world')}>
            <span>Return to World</span>
          </Button>
        </div>
      </div>

      {/* Two-column layout on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Clock, Player state, Characters, Session TierMeter */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* 1. World Clock Card */}
          <section className="rounded-[22px] md:rounded-[28px] bg-[#F3F0EB] border border-[var(--line)] p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-mono-label text-[#4B4F56]">World Clock</span>
              <Chip tone={clockPlaying ? 'ember' : 'neutral'}>
                {clockPlaying ? 'Running (0.1m/s)' : 'Paused'}
              </Chip>
            </div>

            <div className="flex items-baseline justify-between gap-4 mb-5">
              <div>
                <div className="font-display text-3xl text-[#14151A] tabular-nums">
                  Day {dayOf(world.now)} · {capitalizePartOfDay(partOfDay(world.now))}
                </div>
                <div className="font-mono text-[14px] text-[#4B4F56] tabular-nums">
                  Exact time: {formatClockDigits(world.now)} (minute {Math.floor(world.now)})
                </div>
              </div>
              <Button
                variant="ink"
                onClick={toggleClockPlaying}
                aria-label={clockPlaying ? 'Pause world clock' : 'Play world clock'}
              >
                <Icon name={clockPlaying ? 'pause' : 'play'} size={16} />
                <span>{clockPlaying ? 'Pause' : 'Play'}</span>
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <Button variant="paper" onClick={() => advanceTime(60)}>
                +1 hour
              </Button>
              <Button variant="paper" onClick={() => advanceTime(360)}>
                +6 hours
              </Button>
              <Button variant="paper" onClick={() => advanceTime(1440)}>
                +1 day
              </Button>
            </div>
          </section>

          {/* 2. Player State Card */}
          <section className="rounded-[22px] md:rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] p-6 surface-shadow">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="font-mono-label text-[#4B4F56]">Player State</span>
              <span className="font-mono text-[12px] text-[#4B4F56] tabular-nums">
                Seed #{world.seed}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3.5 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)]">
                <div className="font-mono-label text-[#4B4F56] mb-1">Location</div>
                <div className="font-medium text-[#14151A]">
                  {LOCATIONS[world.playerPlace]?.name ?? world.playerPlace}
                </div>
              </div>
              <div className="p-3.5 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)]">
                <div className="font-mono-label text-[#4B4F56] mb-1">Realm & Spirit</div>
                <div className="font-medium text-[#14151A] tabular-nums">
                  Realm {world.playerRealm} ({REALM_NAMES[world.playerRealm]}) · {world.spirit}%
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="font-mono-label text-[#4B4F56] mb-2">Inventory</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(world.inventory).filter(([, c]) => c > 0).length === 0 ? (
                  <span className="text-[14px] text-[#4B4F56]">Empty pack</span>
                ) : (
                  Object.entries(world.inventory)
                    .filter(([, count]) => count > 0)
                    .map(([item, count]) => (
                      <Chip key={item} tone="neutral">
                        {item.replace(/-/g, ' ')} × {count}
                      </Chip>
                    ))
                )}
              </div>
            </div>

            <div>
              <div className="font-mono-label text-[#4B4F56] mb-2">
                Move Player (checks R6 Realm Gates)
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(LOCATIONS) as LocationId[]).map((locId) => {
                  const loc = LOCATIONS[locId];
                  const active = world.playerPlace === locId;
                  return (
                    <button
                      key={locId}
                      type="button"
                      onClick={() => moveTo(locId)}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-full text-[13px] border transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
                          : 'bg-[#F3F0EB] text-[#14151A] border-[var(--line)] hover:bg-[#E9ECEF]'
                      }`}
                    >
                      {loc.name}
                      {loc.minRealm > 1 ? ` (R${loc.minRealm})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 3. Characters Live Place & Activity */}
          <section className="rounded-[22px] md:rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] p-6 surface-shadow">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="font-mono-label text-[#4B4F56]">
                Characters (Tier 0 Routines)
              </span>
              <span className="text-[13px] text-[#4B4F56]">5 active</span>
            </div>

            <div className="flex flex-col divide-y divide-[var(--line)]">
              {CHARACTER_ORDER.map((cid: CharacterId) => {
                const c = CHARACTERS[cid];
                const placeId = world.npcPlace[cid];
                const placeLabel = LOCATIONS[placeId]?.name ?? placeId;
                const samePlace = placeId === world.playerPlace;
                return (
                  <div
                    key={cid}
                    className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#14151A]">{c.name}</span>
                        <span className="text-[#988686]">·</span>
                        <span className="text-[14px] text-[#4B4F56]">{placeLabel}</span>
                        <span className="text-[#988686]">·</span>
                        <span className="font-mono text-[12px] text-[#4B4F56] tabular-nums">
                          Trust {world.trust[cid]}
                        </span>
                      </div>
                      <div className="text-[14px] text-[#4B4F56] truncate">
                        {world.npcActivity[cid]}
                      </div>
                    </div>
                    <Button
                      variant={samePlace ? 'ember' : 'paper'}
                      onClick={() => openOverlay('encounter', cid)}
                    >
                      {samePlace ? 'Speak' : 'Test R1'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 4. TierMeter Efficiency Readout (labelled "this session" and "estimate") */}
          <section className="rounded-[22px] md:rounded-[28px] bg-[#F3F0EB] border border-[var(--line)] p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-mono-label text-[#4B4F56]">
                Simulation Tiers (this session)
              </span>
              <Chip tone={ai.mode === 'live' ? 'violet' : 'neutral'}>
                {ai.mode === 'live' ? 'Live Mistral API' : 'Offline voice'}
              </Chip>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-4 tabular-nums">
              <div className="p-3 rounded-[16px] bg-[#FAF8F5] border border-[var(--line)]">
                <div className="font-mono-label text-[#4B4F56]">Tier 0 steps</div>
                <div className="font-display text-2xl text-[#14151A]">{meter.t0Steps}</div>
                <div className="text-[12px] text-[#4B4F56]">this session</div>
              </div>
              <div className="p-3 rounded-[16px] bg-[#FAF8F5] border border-[var(--line)]">
                <div className="font-mono-label text-[#4B4F56]">Tier 1 turns</div>
                <div className="font-display text-2xl text-[#14151A]">{meter.t1Narrations}</div>
                <div className="text-[12px] text-[#4B4F56]">this session</div>
              </div>
              <div className="p-3 rounded-[16px] bg-[#FAF8F5] border border-[var(--line)]">
                <div className="font-mono-label text-[#4B4F56]">Tier 2 calls</div>
                <div className="font-display text-2xl text-[#14151A]">{meter.t2Calls}</div>
                <div className="text-[12px] text-[#4B4F56]">this session</div>
              </div>
            </div>

            <div className="text-[14px] text-[#4B4F56] space-y-1 tabular-nums">
              <div>
                Naive hourly-call baseline (estimate):{' '}
                <span className="font-medium text-[#14151A]">{meter.baselineCalls} calls</span>
              </div>
              <div>
                Model call reduction vs. naive baseline (estimate):{' '}
                <span className="font-medium text-[#14151A]">
                  {Math.round(meter.savingsRatio * 100)}%
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Tabs for Ledger, Rules, Tests */}
        <div className="lg:col-span-7 rounded-[22px] md:rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] p-6 sm:p-8 surface-shadow">
          {/* Segmented Tab Controls */}
          <div
            role="tablist"
            aria-label="Engine Inspector Tabs"
            className="flex flex-wrap items-center gap-2 pb-5 mb-6 border-b border-[var(--line)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'ledger'}
              onClick={() => setActiveTab('ledger')}
              className={`min-h-[48px] px-5 py-2.5 rounded-full font-medium text-[15px] transition-colors cursor-pointer ${
                activeTab === 'ledger'
                  ? 'bg-[#14151A] text-[#FAF8F5]'
                  : 'bg-[#F3F0EB] text-[#14151A] hover:bg-[#E9ECEF]'
              }`}
            >
              Ledger ({ledgerEvents.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rules'}
              onClick={() => setActiveTab('rules')}
              className={`min-h-[48px] px-5 py-2.5 rounded-full font-medium text-[15px] transition-colors cursor-pointer ${
                activeTab === 'rules'
                  ? 'bg-[#14151A] text-[#FAF8F5]'
                  : 'bg-[#F3F0EB] text-[#14151A] hover:bg-[#E9ECEF]'
              }`}
            >
              Rules ({ruleLog.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'tests'}
              onClick={() => setActiveTab('tests')}
              className={`min-h-[48px] px-5 py-2.5 rounded-full font-medium text-[15px] transition-colors cursor-pointer ${
                activeTab === 'tests'
                  ? 'bg-[#14151A] text-[#FAF8F5]'
                  : 'bg-[#F3F0EB] text-[#14151A] hover:bg-[#E9ECEF]'
              }`}
            >
              Tests
            </button>
          </div>

          {/* TAB 1: LEDGER */}
          {activeTab === 'ledger' && (
            <div>
              {selectedChainEventId && (
                <div className="mb-6 p-5 rounded-[20px] bg-[#EFE7FD]/60 border border-[#4A1D96]/25">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="font-mono-label text-[#4A1D96]">
                      Causal Chain for {selectedChainEventId} ({causalChain.length} events)
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedChainEventId(null)}
                      className="text-[13px] text-[#4A1D96] underline cursor-pointer"
                    >
                      Clear chain view
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    {causalChain.map((ev, idx) => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-[14px] bg-[#FAF8F5] border border-[var(--line)] flex items-start gap-3"
                      >
                        <span className="font-mono text-[12px] text-[#4A1D96] tabular-nums shrink-0">
                          {idx + 1}. [{ev.id}]
                        </span>
                        <div className="text-[14px] text-[#14151A]">
                          <span className="font-mono text-[12px] text-[#4B4F56] mr-2">
                            {formatWorld(ev.t, 'time')}
                          </span>
                          {ev.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {reversedLedger.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-4 rounded-[18px] bg-[#F3F0EB]/70 border border-[var(--line)] flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-[#4B4F56] tabular-nums">
                          {ev.id} · {formatWorld(ev.t, 'time')}
                        </span>
                        <Chip tone="neutral">{ev.type}</Chip>
                        <Chip
                          tone={
                            ev.tier === 2
                              ? 'violet'
                              : ev.tier === 1
                                ? 'ember'
                                : 'neutral'
                          }
                        >
                          Tier {ev.tier}
                        </Chip>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedChainEventId(ev.id)}
                        className="min-h-[36px] px-3 py-1 rounded-full bg-[#FAF8F5] border border-[var(--line)] text-[12px] font-mono text-[#14151A] hover:bg-[#E9ECEF] cursor-pointer"
                      >
                        Cause chain ({ev.causes.length})
                      </button>
                    </div>

                    <p className="text-[#14151A] text-[15px] leading-snug">
                      {ev.summary}
                    </p>

                    <div className="text-[12px] text-[#4B4F56] flex flex-wrap items-center gap-2">
                      <span>Place: {LOCATIONS[ev.place]?.name ?? ev.place}</span>
                      <span>·</span>
                      <span>Actors: {ev.actors.join(', ')}</span>
                      <span>·</span>
                      <span>Importance: {ev.importance}/5</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: RULES */}
          {activeTab === 'rules' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)] mb-5">
                <div>
                  <div className="font-mono-label text-[#4B4F56]">
                    R7 Citation Integrity (this session)
                  </div>
                  <div className="text-[15px] text-[#14151A]">
                    Removed invented sources:{' '}
                    <span className="font-mono font-medium tabular-nums">
                      {removedSourcesCount}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="paper"
                    onClick={() =>
                      commitProposal('player', {
                        type: 'GIVE_ITEM',
                        item: 'spirit-root',
                        recipient: 'seren',
                      })
                    }
                  >
                    Test R2 Give Root
                  </Button>
                  <Button
                    variant="paper"
                    onClick={() => moveTo('sky-realms')}
                  >
                    Test R6 Sky Realms
                  </Button>
                </div>
              </div>

              {lastRetrieval && (
                <div className="mb-5 p-4 rounded-[18px] bg-[#FAF8F5] border border-[var(--line)]">
                  <div className="font-mono-label text-[#4B4F56] mb-2">
                    Last Memory Retrieval Trace ({lastRetrieval.characterId})
                  </div>
                  <div className="space-y-1.5">
                    {lastRetrieval.results.slice(0, 4).map((m) => (
                      <div
                        key={m.event.id}
                        className="text-[13px] text-[#4B4F56] flex items-center justify-between gap-2 tabular-nums"
                      >
                        <span className="truncate text-[#14151A]">
                          [{m.event.id}] {m.event.summary}
                        </span>
                        <span className="font-mono shrink-0">
                          score {m.score.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ruleLog.length === 0 ? (
                <p className="text-[#4B4F56] py-6">
                  No rule checks recorded yet in this session. Speak with a character, test a proposal above, or run the engine self-test.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {ruleLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3.5 rounded-[16px] bg-[#F3F0EB]/60 border border-[var(--line)] flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full font-mono text-[11px] font-medium shrink-0 ${
                            entry.ok
                              ? 'bg-[#FAF8F5] text-[#14151A] border border-[var(--line)]'
                              : 'bg-[#FFE9DE] text-[#14151A] border border-[#D94400]/30'
                          }`}
                        >
                          {entry.ok ? 'PASS' : 'FAIL'} · {entry.ruleId}
                        </span>
                        <div>
                          <div className="text-[14px] text-[#14151A] font-medium">
                            {entry.reason}
                          </div>
                          <div className="text-[12px] text-[#4B4F56] font-mono tabular-nums">
                            Actor: {entry.actor} · Proposal: {entry.proposalType} ·{' '}
                            {formatWorld(entry.worldMinute, 'time')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TESTS */}
          {activeTab === 'tests' && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-[20px] bg-[#F3F0EB] border border-[var(--line)] mb-6">
                <div>
                  <h2 className="font-display text-lg text-[#14151A] mb-1">
                    Deterministic Engine Self-Test Suite
                  </h2>
                  <p className="text-[14px] text-[#4B4F56]">
                    Verifies append-only ledger immutability, causal chains, rules R1 through R8 (both pass and fail cases), memory retrieval ranking, and seeded simulation determinism.
                  </p>
                </div>
                <Button variant="ember" size="lg" onClick={handleRunSelfTest}>
                  Run engine self-test
                </Button>
              </div>

              {testResults && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3.5 rounded-[16px] bg-[#FAF8F5] border border-[var(--line)]">
                    <span className="font-mono-label text-[#14151A]">
                      Suite Summary ({testResults.filter((t) => t.passed).length}/{testResults.length} passed)
                    </span>
                    <Chip tone={allTestsPassed ? 'ink' : 'ember'}>
                      {allTestsPassed ? 'ALL TESTS PASS' : 'FAILURES DETECTED'}
                    </Chip>
                  </div>

                  {testResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-[18px] bg-[#F3F0EB]/60 border border-[var(--line)] flex items-start justify-between gap-4"
                    >
                      <div>
                        <div className="font-medium text-[#14151A] text-[15px] mb-1">
                          {item.name}
                        </div>
                        <div className="text-[13px] text-[#4B4F56]">{item.detail}</div>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full font-mono text-[12px] font-medium shrink-0 ${
                          item.passed
                            ? 'bg-[#14151A] text-[#FAF8F5]'
                            : 'bg-[#FFE9DE] text-[#14151A] border border-[#D94400]'
                        }`}
                      >
                        {item.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
