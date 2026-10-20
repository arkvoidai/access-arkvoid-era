import gsap from 'gsap';
import {
  Component,
  type ErrorInfo,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CHARACTERS, CHARACTER_ORDER, LOCATIONS, REALM_NAMES } from './config/app.config.ts';
import { KEYMAP } from './config/keymap.ts';
import { formatWorld, TIME_SCALE } from './engine/clock.ts';
import { useArkvoidStore, type ScreenId } from './engine/store.ts';
import { useKeys } from './hooks/useKeys.ts';
import { useReducedMotion } from './hooks/useReducedMotion.ts';
import Intro from './screens/Intro.tsx';
import World from './screens/World.tsx';
import { Button } from './ui/Button.tsx';
import { Chip } from './ui/Chip.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { IconButton } from './ui/IconButton.tsx';
import { Kbd } from './ui/Kbd.tsx';
import { Logo } from './ui/Logo.tsx';
import { Pill } from './ui/Pill.tsx';
import { Sheet } from './ui/Sheet.tsx';
import { ToastHost } from './ui/Toast.tsx';
import { ValleyParchmentMap } from './ui/ValleyParchmentMap.tsx';

const EngineConsole = lazy(() => import('./screens/EngineConsole.tsx'));

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Handled by calm full-screen UI
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full bg-[#FAF8F5] text-[#14151A] flex flex-col items-center justify-center p-6 text-center">
          <Logo size={48} className="mb-4" />
          <h1 className="font-display text-2xl mb-2">The scene paused unexpectedly.</h1>
          <p className="text-[#4B4F56] max-w-md mb-6">
            Your permanent record is saved locally. Reload the page to step back into the world.
          </p>
          <Button variant="ink" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingMark() {
  return (
    <div className="min-h-dvh w-full bg-[#FAF8F5] text-[#14151A] flex flex-col items-center justify-center p-6">
      <Logo size={44} className="mb-4" />
      <div className="w-32 h-[2px] bg-[#E9ECEF] rounded-full overflow-hidden">
        <div className="w-1/2 h-full bg-[#FB5607]" />
      </div>
    </div>
  );
}

const DOCK_ITEMS: ReadonlyArray<{
  id: ScreenId;
  label: string;
  icon: IconName;
  shortcut: string;
  mobilePrimary?: boolean;
}> = [
  { id: 'world', label: 'World', icon: 'world', shortcut: 'Esc', mobilePrimary: true },
  { id: 'atlas', label: 'Atlas', icon: 'atlas', shortcut: 'M', mobilePrimary: true },
  { id: 'people', label: 'People', icon: 'people', shortcut: 'E' },
  { id: 'journal', label: 'Journal', icon: 'journal', shortcut: 'J', mobilePrimary: true },
  { id: 'cultivate', label: 'Cultivate', icon: 'cultivate', shortcut: 'C' },
  { id: 'time', label: 'Time', icon: 'time', shortcut: 'T' },
  { id: 'inspector', label: 'Inspector', icon: 'inspector', shortcut: 'I', mobilePrimary: true },
  { id: 'glasses', label: 'Glasses', icon: 'glasses', shortcut: 'G' },
];

export default function App() {
  const screen = useArkvoidStore((s) => s.ui.screen);
  const overlay = useArkvoidStore((s) => s.ui.overlay);
  const selectedCharacter = useArkvoidStore((s) => s.ui.selectedCharacter);
  const soundOn = useArkvoidStore((s) => s.ui.soundOn);
  const clockPlaying = useArkvoidStore((s) => s.ui.clockPlaying);
  const timeLensSpeed = useArkvoidStore((s) => s.ui.timeLensSpeed);
  const glassesQuiet = useArkvoidStore((s) => s.ui.glassesQuiet);
  const world = useArkvoidStore((s) => s.world);
  const ledgerEvents = useArkvoidStore((s) => s.ledgerEvents);
  const awayEvents = useArkvoidStore((s) => s.awayEvents);
  const awayMinutes = useArkvoidStore((s) => s.awayMinutes);
  const ai = useArkvoidStore((s) => s.ai);

  const hydrate = useArkvoidStore((s) => s.hydrate);
  const setScreen = useArkvoidStore((s) => s.setScreen);
  const openOverlay = useArkvoidStore((s) => s.openOverlay);
  const closeOverlay = useArkvoidStore((s) => s.closeOverlay);
  const selectCharacter = useArkvoidStore((s) => s.selectCharacter);
  const toggleSound = useArkvoidStore((s) => s.toggleSound);
  const advanceTime = useArkvoidStore((s) => s.advanceTime);
  const moveTo = useArkvoidStore((s) => s.moveTo);
  const talkToCharacter = useArkvoidStore((s) => s.talkToCharacter);
  const setTimeLensSpeed = useArkvoidStore((s) => s.setTimeLensSpeed);
  const toggleSpiritSense = useArkvoidStore((s) => s.toggleSpiritSense);
  const toggleGlassesQuiet = useArkvoidStore((s) => s.toggleGlassesQuiet);
  const practiceBreath = useArkvoidStore((s) => s.practiceBreath);
  const pushToast = useArkvoidStore((s) => s.pushToast);

  const [playerInput, setPlayerInput] = useState('');
  const screenWrapRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const minuteAccumulator = useRef(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Screen transition with GSAP (opacity and 12px translate)
  useEffect(() => {
    if (reducedMotion || !screenWrapRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        screenWrapRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }
      );
    }, screenWrapRef);
    return () => ctx.revert();
  }, [screen, reducedMotion]);

  // World clock real-time progression (0.1 world min/sec default)
  useEffect(() => {
    if (screen === 'intro' || !clockPlaying) return;
    // Pause during overlays except in Glasses quiet mode
    if (overlay && !(screen === 'glasses' && glassesQuiet)) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      minuteAccumulator.current += TIME_SCALE * timeLensSpeed;
      if (minuteAccumulator.current >= 15) {
        const stepsToRun = Math.floor(minuteAccumulator.current / 15) * 15;
        minuteAccumulator.current -= stepsToRun;
        advanceTime(stepsToRun);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [screen, clockPlaying, overlay, glassesQuiet, timeLensSpeed, advanceTime]);

  const toggleFullscreen = () => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  };

  // Global keyboard shortcuts from single source of truth KEYMAP
  const keyHandlers = useMemo(
    () => ({
      escape: () => {
        if (overlay) {
          closeOverlay();
        } else if (screen !== 'world' && screen !== 'intro') {
          setScreen('world');
        }
      },
      interact: () => {
        if (screen === 'intro') return;
        const present = CHARACTER_ORDER.find((c) => world.npcPlace[c] === world.playerPlace);
        openOverlay('encounter', present ?? selectedCharacter);
      },
      atlas: () => setScreen(screen === 'atlas' ? 'world' : 'atlas'),
      journal: () => setScreen(screen === 'journal' ? 'world' : 'journal'),
      cultivate: () => setScreen(screen === 'cultivate' ? 'world' : 'cultivate'),
      inspector: () => setScreen(screen === 'inspector' ? 'world' : 'inspector'),
      glasses: () => setScreen(screen === 'glasses' ? 'world' : 'glasses'),
      timeLens: () => setScreen(screen === 'time' ? 'world' : 'time'),
      spiritSense: () => {
        toggleSpiritSense();
        pushToast('Spirit sense toggled.', 'violet');
      },
      breathPractice: () => practiceBreath(),
      photoMode: () => pushToast('Photo framing active. Press Esc to restore HUD.', 'neutral'),
      presenterNotes: () => openOverlay('director'),
      quietGlasses: () => toggleGlassesQuiet(),
      recenterGlasses: () => pushToast('Glasses horizon recentered.', 'neutral'),
      fullscreen: () => toggleFullscreen(),
      director: () => openOverlay('director'),
      vision: () => setScreen(screen === 'vision' ? 'world' : 'vision'),
      devTools: () => {
        if (screen !== 'world') {
          setScreen('inspector');
        }
      },
    }),
    [
      overlay,
      screen,
      world.npcPlace,
      world.playerPlace,
      selectedCharacter,
      closeOverlay,
      setScreen,
      openOverlay,
      toggleSpiritSense,
      pushToast,
      practiceBreath,
      toggleGlassesQuiet,
    ]
  );

  useKeys(keyHandlers, true);

  const handleSendLine = async (text?: string) => {
    const line = (text ?? playerInput).trim();
    if (!line || ai.isTalking) return;
    setPlayerInput('');
    await talkToCharacter(selectedCharacter, line);
  };

  const placeMeta = LOCATIONS[world.playerPlace];
  const activeChar = CHARACTERS[selectedCharacter];

  return (
    <AppErrorBoundary>
      <div className="min-h-dvh w-full bg-[var(--paper)] text-[var(--ink)] relative select-none">
        <ToastHost />

        {/* Top Bar (shown on all screens except Intro) */}
        {screen !== 'intro' && (
          <header className="fixed top-0 inset-x-0 z-40 px-3 sm:px-6 pt-3 pb-2 pointer-events-none">
            <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-1.5 sm:gap-3">
              {/* Left: Arch logo + current place name */}
              <Pill className="pointer-events-auto px-2.5 sm:px-3.5 py-1.5 gap-1.5 sm:gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setScreen('intro')}
                  aria-label="Return to title screen"
                  className="inline-flex items-center gap-2 cursor-pointer shrink-0"
                >
                  <Logo size={24} />
                  <span className="font-display text-[15px] text-[#14151A] hidden sm:inline">
                    Arkvoid
                  </span>
                </button>
                <span aria-hidden="true" className="text-[#988686]">
                  ·
                </span>
                <span className="text-[13px] sm:text-[14px] font-medium text-[#14151A] truncate max-w-[96px] sm:max-w-none">
                  {placeMeta.name}
                </span>
              </Pill>

              {/* Centre: World clock chip "Day 1 · Dusk" + Offline voice tag */}
              <Pill className="pointer-events-auto px-2.5 sm:px-4 py-1.5 sm:py-2 gap-1.5 sm:gap-2 whitespace-nowrap shrink-0">
                <span className="font-mono-label text-[#14151A] tabular-nums whitespace-nowrap">
                  {formatWorld(world.now, 'part')}
                </span>
                {ai.mode === 'offline' && (
                  <>
                    <span aria-hidden="true" className="text-[#988686] hidden sm:inline">
                      ·
                    </span>
                    <span className="font-mono text-[11px] text-[#4B4F56] uppercase tracking-wider hidden sm:inline">
                      Offline voice
                    </span>
                  </>
                )}
              </Pill>

              {/* Right: Keys, Sound, Fullscreen */}
              <div className="pointer-events-auto flex items-center gap-1 sm:gap-2 shrink-0">
                <IconButton
                  label="Keyboard shortcuts"
                  active={overlay === 'keys'}
                  onClick={() =>
                    overlay === 'keys' ? closeOverlay() : openOverlay('keys')
                  }
                >
                  <Icon name="keys" size={20} />
                </IconButton>
                <IconButton
                  label={soundOn ? 'Mute sound' : 'Turn sound on'}
                  active={soundOn}
                  onClick={toggleSound}
                >
                  <Icon name={soundOn ? 'soundOn' : 'soundOff'} size={20} />
                </IconButton>
                <IconButton
                  label="Toggle fullscreen"
                  onClick={toggleFullscreen}
                  className="hidden sm:inline-flex"
                >
                  <Icon name="fullscreen" size={20} />
                </IconButton>
              </div>
            </div>
          </header>
        )}

        {/* Active Screen */}
        <div ref={screenWrapRef} className="w-full min-h-dvh">
          {screen === 'intro' && <Intro />}
          {screen === 'world' && <World />}
          {screen === 'inspector' && (
            <Suspense fallback={<LoadingMark />}>
              <EngineConsole />
            </Suspense>
          )}

          {/* Secondary Shell Screens (Atlas, People, Journal, Cultivate, Time, Glasses, Vision) */}
          {screen === 'atlas' && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[1120px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">Valley Atlas · R6 Realm Gates</div>
              <h1 className="font-display text-3xl mb-6">Eight Places of the First World</h1>
              <ValleyParchmentMap currentPlace={world.playerPlace} onSelectPlace={moveTo} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>).map((locId) => {
                  const loc = LOCATIONS[locId];
                  const isHere = world.playerPlace === locId;
                  const hereChars = CHARACTER_ORDER.filter((c) => world.npcPlace[c] === locId);
                  return (
                    <div
                      key={locId}
                      className="p-6 rounded-[24px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow flex flex-col justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-mono-label text-[#4B4F56]">{loc.region}</span>
                          <Chip tone={world.playerRealm >= loc.minRealm ? 'neutral' : 'violet'}>
                            Realm {loc.minRealm}+
                          </Chip>
                        </div>
                        <h2 className="font-display text-xl mb-1">{loc.name}</h2>
                        <p className="text-[15px] text-[#4B4F56] mb-3">{loc.description}</p>
                        {hereChars.length > 0 && (
                          <div className="text-[13px] text-[#4B4F56]">
                            Present: {hereChars.map((c) => CHARACTERS[c].name).join(', ')}
                          </div>
                        )}
                      </div>
                      <Button
                        variant={isHere ? 'ink' : 'paper'}
                        disabled={isHere}
                        onClick={() => moveTo(locId)}
                      >
                        {isHere ? 'You are here' : `Walk to ${loc.name}`}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {screen === 'people' && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[1120px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">People of the Valley</div>
              <h1 className="font-display text-3xl mb-6">Routines, Goals & Trust</h1>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CHARACTER_ORDER.map((cid) => {
                  const c = CHARACTERS[cid];
                  const place = LOCATIONS[world.npcPlace[cid]];
                  const canSpeak = world.npcPlace[cid] === world.playerPlace;
                  return (
                    <div
                      key={cid}
                      className="p-6 rounded-[24px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow flex flex-col justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-mono-label text-[#4B4F56]">{c.role}</span>
                          <Chip tone="neutral">Trust {world.trust[cid]}</Chip>
                        </div>
                        <h2 className="font-display text-2xl mb-1">{c.name}</h2>
                        <p className="text-[15px] text-[#4B4F56] mb-3">
                          Currently at <strong className="text-[#14151A]">{place.name}</strong> —{' '}
                          {world.npcActivity[cid]}.
                        </p>
                        <div className="text-[14px] text-[#4B4F56]">
                          Goals: {c.goals.join(' · ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Button
                          variant={canSpeak ? 'ember' : 'paper'}
                          onClick={() => openOverlay('encounter', cid)}
                        >
                          {canSpeak ? `Speak with ${c.name}` : `At ${place.name} (Walk there)`}
                        </Button>
                        {!canSpeak && (
                          <Button variant="ink" onClick={() => moveTo(world.npcPlace[cid])}>
                            Walk to {place.name}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {screen === 'journal' && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[960px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">Permanent Record</div>
              <h1 className="font-display text-3xl mb-6">Oaths & Ledger Chronicle</h1>
              <div className="p-6 rounded-[24px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow mb-6">
                <div className="font-mono-label text-[#4B4F56] mb-3">Promises</div>
                <div className="space-y-3">
                  {world.promises.map((p) => (
                    <div
                      key={p.id}
                      className="p-4 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)] flex items-center justify-between gap-4"
                    >
                      <div>
                        <div className="font-medium text-[#14151A]">{p.text}</div>
                        <div className="text-[13px] text-[#4B4F56] font-mono tabular-nums">
                          Source event: {p.sourceEvent} · Made at {formatWorld(p.madeAt, 'time')}
                        </div>
                      </div>
                      <Chip tone={p.status === 'kept' ? 'ink' : p.status === 'open' ? 'ember' : 'neutral'}>
                        {p.status}
                      </Chip>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {[...ledgerEvents].reverse().map((ev) => (
                  <div
                    key={ev.id}
                    className="p-4 rounded-[18px] bg-[#FAF8F5] border border-[var(--line)] flex items-start justify-between gap-4"
                  >
                    <div>
                      <div className="font-mono text-[12px] text-[#4B4F56] mb-1 tabular-nums">
                        {formatWorld(ev.t, 'both')} · {LOCATIONS[ev.place]?.name ?? ev.place}
                      </div>
                      <div className="text-[#14151A]">{ev.summary}</div>
                    </div>
                    <Chip tone="neutral">{ev.id}</Chip>
                  </div>
                ))}
              </div>
            </div>
          )}

          {screen === 'cultivate' && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[820px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">Breath & Realm Progression</div>
              <h1 className="font-display text-3xl mb-6">
                Realm {world.playerRealm} · {REALM_NAMES[world.playerRealm]}
              </h1>
              <div className="p-8 rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow">
                <p className="text-[#4B4F56] mb-6">
                  Steady breath practice gathers spirit from the valley air. Reaching 100 spirit opens the next realm and unlocks higher places such as the Sky Realms (Realm 3) and Ashen March (Realm 5).
                </p>
                <div className="mb-6">
                  <div className="flex justify-between font-mono text-[13px] mb-2 tabular-nums">
                    <span>Current spirit</span>
                    <span>{world.spirit} / 100</span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-[#F3F0EB] overflow-hidden border border-[var(--line)]">
                    <div
                      className="h-full bg-[#FB5607] transition-all duration-300"
                      style={{ width: `${world.spirit}%` }}
                    />
                  </div>
                </div>
                <Button variant="ember" size="lg" onClick={practiceBreath}>
                  Practice breath (+18 spirit · 15m)
                </Button>
              </div>
            </div>
          )}

          {screen === 'time' && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[820px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">Time Lens</div>
              <h1 className="font-display text-3xl mb-6">{formatWorld(world.now, 'both')}</h1>
              <div className="p-8 rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow space-y-6">
                <p className="text-[#4B4F56]">
                  By default 0.1 world minutes pass per real second. Step time forward to watch characters follow their daily routines without language model calls.
                </p>
                <div className="flex flex-wrap gap-3">
                  {([1, 4, 16] as const).map((spd) => (
                    <Button
                      key={spd}
                      variant={timeLensSpeed === spd ? 'ink' : 'paper'}
                      onClick={() => setTimeLensSpeed(spd)}
                    >
                      {spd}× speed
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 pt-2 border-t border-[var(--line)]">
                  <Button variant="paper" onClick={() => advanceTime(60)}>
                    Advance 1 hour
                  </Button>
                  <Button variant="paper" onClick={() => advanceTime(360)}>
                    Advance 6 hours
                  </Button>
                  <Button variant="paper" onClick={() => advanceTime(1440)}>
                    Advance 1 day
                  </Button>
                </div>
              </div>
            </div>
          )}

          {(screen === 'glasses' || screen === 'vision') && (
            <div className="min-h-dvh pt-24 pb-32 px-4 sm:px-8 max-w-[920px] mx-auto">
              <div className="font-mono-label text-[#4B4F56] mb-1">
                Design Concept Only · Not a Released Hardware Product
              </div>
              <h1 className="font-display text-3xl mb-4">
                {screen === 'glasses' ? 'Glasses Concept Preview' : 'Arkvoid Vision Notes'}
              </h1>
              <div className="p-8 rounded-[28px] bg-[#FAF8F5] border border-[var(--line)] surface-shadow space-y-4">
                <p className="text-[#4B4F56]">
                  Long-term, the persistent world of Arkvoid is designed to be glimpsed through lightweight optical glasses. Arkvoid glasses are a design concept only.
                </p>
                <div className="p-5 rounded-[20px] bg-[#F3F0EB] border border-[var(--line)] flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono-label text-[#4B4F56] mb-1">
                      Live Anchor · {placeMeta.name}
                    </div>
                    <div className="font-medium text-[#14151A]">
                      {formatWorld(world.now, 'both')} · Quiet mode {glassesQuiet ? 'On' : 'Off'}
                    </div>
                  </div>
                  <Button variant="paper" onClick={toggleGlassesQuiet}>
                    Toggle Quiet Mode (Q)
                  </Button>
                </div>
                <Button variant="ink" onClick={() => setScreen('world')}>
                  Return to World
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Floating Dock (hidden on Intro) */}
        {screen !== 'intro' && (
          <nav
            aria-label="Primary world navigation"
            className="fixed bottom-3 sm:bottom-4 inset-x-0 z-40 flex justify-center px-3 pointer-events-none"
          >
            {/* Desktop 8-item dock */}
            <div className="hidden md:flex pointer-events-auto">
              <Pill className="p-1.5 gap-1">
                {DOCK_ITEMS.map((item) => {
                  const active = screen === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setScreen(item.id)}
                      className={`min-h-[48px] px-3.5 py-1.5 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#14151A]/[0.07] text-[#14151A] font-medium'
                          : 'text-[#4B4F56] hover:text-[#14151A] hover:bg-[#14151A]/[0.04]'
                      }`}
                    >
                      <Icon name={item.icon} size={22} />
                      <span className="text-[11px] leading-none tracking-tight">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </Pill>
            </div>

            {/* Mobile 5-icon dock with "More" sheet */}
            <div className="flex md:hidden pointer-events-auto">
              <Pill className="p-1.5 gap-1">
                {DOCK_ITEMS.filter((i) => i.mobilePrimary).map((item) => {
                  const active = screen === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setScreen(item.id)}
                      className={`min-w-[56px] min-h-[48px] px-2 py-1 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#14151A]/[0.07] text-[#14151A] font-medium'
                          : 'text-[#4B4F56]'
                      }`}
                    >
                      <Icon name={item.icon} size={20} />
                      <span className="text-[11px] leading-none">{item.label}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => openOverlay('more')}
                  className={`min-w-[56px] min-h-[48px] px-2 py-1 rounded-full flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                    overlay === 'more'
                      ? 'bg-[#14151A]/[0.07] text-[#14151A] font-medium'
                      : 'text-[#4B4F56]'
                  }`}
                >
                  <Icon name="more" size={20} />
                  <span className="text-[11px] leading-none">More</span>
                </button>
              </Pill>
            </div>
          </nav>
        )}

        {/* OVERLAY 1: Character Encounter Sheet */}
        <Sheet
          open={overlay === 'encounter'}
          onClose={closeOverlay}
          subtitle={`${activeChar.role} · ${LOCATIONS[world.npcPlace[selectedCharacter]].name}`}
          title={activeChar.name}
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="neutral">Trust {world.trust[selectedCharacter]}</Chip>
              <Chip tone={ai.mode === 'live' ? 'violet' : 'neutral'}>
                {ai.mode === 'live' ? 'Live voice' : 'Offline voice'}
              </Chip>
              {(Object.keys(CHARACTERS) as Array<keyof typeof CHARACTERS>).map((cid) => (
                <button
                  key={cid}
                  type="button"
                  onClick={() => selectCharacter(cid)}
                  className={`px-2.5 py-1 rounded-full text-[12px] border cursor-pointer ${
                    selectedCharacter === cid
                      ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
                      : 'bg-[#F3F0EB] text-[#4B4F56] border-[var(--line)]'
                  }`}
                >
                  {CHARACTERS[cid].name}
                </button>
              ))}
            </div>

            <div className="p-4 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)] text-[14px] text-[#4B4F56]">
              Currently {world.npcActivity[selectedCharacter]} at{' '}
              <strong className="text-[#14151A]">
                {LOCATIONS[world.npcPlace[selectedCharacter]].name}
              </strong>
              .
            </div>

            {ai.lastTurnResult && (
              <div className="p-4 rounded-[20px] bg-[#FAF8F5] border border-[var(--line)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Chip tone="ember">{ai.lastTurnResult.turn.emotion}</Chip>
                  <span className="font-mono text-[11px] text-[#4B4F56] tabular-nums">
                    {ai.lastTurnResult.source} · {ai.lastTurnResult.latencyMs}ms
                  </span>
                </div>
                <p className="text-[#14151A] text-[16px] leading-relaxed">
                  “{ai.lastTurnResult.turn.utterance}”
                </p>
                {ai.lastTurnResult.turn.citations.length > 0 && (
                  <div className="text-[12px] font-mono text-[#4B4F56]">
                    Cited ledger memories: {ai.lastTurnResult.turn.citations.join(', ')}
                  </div>
                )}
                {ai.lastTurnResult.checks.length > 0 && (
                  <div className="pt-2 border-t border-[var(--line)] space-y-1.5">
                    <div className="font-mono-label text-[#4B4F56]">
                      World Rule Checks
                    </div>
                    {ai.lastTurnResult.checks.map((chk, idx) => (
                      <div key={idx} className="text-[13px] flex items-center gap-2">
                        <span className="font-mono font-medium">
                          [{chk.result.ruleId} {chk.result.ok ? 'PASS' : 'FAIL'}]
                        </span>
                        <span className="text-[#4B4F56]">{chk.result.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick dialogue prompts */}
            <div className="space-y-2">
              <div className="font-mono-label text-[#4B4F56]">Speak with {activeChar.name}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="paper"
                  onClick={() => void handleSendLine('What worries you about the gate tonight?')}
                >
                  Ask about worry
                </Button>
                <Button
                  variant="paper"
                  onClick={() =>
                    void handleSendLine('I brought the dry spirit-root for the brazier.')
                  }
                >
                  Give spirit-root
                </Button>
                <Button
                  variant="paper"
                  onClick={() => void handleSendLine('May I hold the gate key?')}
                >
                  Ask for gate key
                </Button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSendLine();
              }}
              className="flex items-center gap-2 pt-2"
            >
              <label htmlFor="encounter-input" className="sr-only">
                Say something to {activeChar.name}
              </label>
              <input
                id="encounter-input"
                type="text"
                maxLength={280}
                value={playerInput}
                onChange={(e) => setPlayerInput(e.target.value)}
                placeholder={`Speak to ${activeChar.name}...`}
                className="flex-1 min-h-[48px] px-4 rounded-full bg-[#F3F0EB] border border-[var(--line)] text-[#14151A] placeholder:text-[#988686] text-[15px]"
              />
              <Button type="submit" variant="ink" disabled={ai.isTalking || !playerInput.trim()}>
                {ai.isTalking ? '...' : 'Send'}
              </Button>
            </form>
          </div>
        </Sheet>

        {/* OVERLAY 2: Keyboard Shortcuts Sheet */}
        <Sheet
          open={overlay === 'keys'}
          onClose={closeOverlay}
          subtitle="Single Source of Truth"
          title="Keyboard Shortcuts"
        >
          <div className="space-y-3">
            {KEYMAP.filter((k) => !k.devOnly || import.meta.env.DEV).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 border-b border-[var(--line)] last:border-b-0"
              >
                <span className="text-[15px] text-[#14151A]">{item.label}</span>
                <Kbd>{item.display}</Kbd>
              </div>
            ))}
          </div>
        </Sheet>

        {/* OVERLAY 3: Mobile "More" Sheet */}
        <Sheet
          open={overlay === 'more'}
          onClose={closeOverlay}
          subtitle="Navigation"
          title="More Screens"
        >
          <div className="grid grid-cols-2 gap-3">
            {DOCK_ITEMS.map((item) => (
              <Button
                key={item.id}
                variant={screen === item.id ? 'ink' : 'paper'}
                onClick={() => setScreen(item.id)}
                className="justify-start"
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </Button>
            ))}
          </div>
        </Sheet>

        {/* OVERLAY 4: While You Were Away Sheet */}
        <Sheet
          open={overlay === 'away'}
          onClose={closeOverlay}
          subtitle={`${awayMinutes} world minutes elapsed`}
          title="While you were away"
        >
          <div className="space-y-4">
            <p className="text-[15px] text-[#4B4F56]">
              The world continued running on deterministic Tier 0 routines while you were away.
            </p>
            {awayEvents.map((ev) => (
              <div
                key={ev.id}
                className="p-4 rounded-[18px] bg-[#F3F0EB] border border-[var(--line)]"
              >
                <div className="font-mono text-[12px] text-[#4B4F56] mb-1">
                  {formatWorld(ev.t, 'both')}
                </div>
                <div className="text-[15px] text-[#14151A]">{ev.summary}</div>
              </div>
            ))}
          </div>
        </Sheet>

        {/* OVERLAY 5: Investor Demo / Director Tour Sheet */}
        <Sheet
          open={overlay === 'director'}
          onClose={closeOverlay}
          subtitle="Guided Four-Minute Demo"
          title="Investor Demo Tour"
        >
          <div className="space-y-4">
            <p className="text-[15px] text-[#4B4F56]">
              Every claim in Arkvoid is verifiable live in this browser session, even with zero Wi-Fi:
            </p>
            <ol className="space-y-3 text-[15px] text-[#14151A] list-decimal list-inside">
              <li>
                <strong>Permanent Ledger:</strong> Every event has an immutable ID and causal chain.
              </li>
              <li>
                <strong>Memory Retrieval:</strong> Characters cite only ledger event IDs they witnessed or heard about.
              </li>
              <li>
                <strong>Rules Engine (R1–R8):</strong> Characters propose actions; the world checks presence, possession, promises, and realm gates.
              </li>
              <li>
                <strong>Tier 0 Background Simulation:</strong> Advancing time moves characters by routine with zero language model calls.
              </li>
            </ol>
            <div className="pt-3 flex flex-col gap-2.5">
              <Button
                variant="ember"
                onClick={() => openOverlay('encounter', 'seren')}
              >
                1. Speak with Seren at East Gate
              </Button>
              <Button
                variant="ink"
                onClick={() => setScreen('inspector')}
              >
                2. Open Engine Inspector & Run Self-Test
              </Button>
            </div>
          </div>
        </Sheet>
      </div>
    </AppErrorBoundary>
  );
}
