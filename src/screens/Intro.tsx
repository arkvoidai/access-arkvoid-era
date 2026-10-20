import gsap from 'gsap';
import { useEffect, useRef } from 'react';
import { COMPANY_FACTS, INTRO_COPY } from '../config/copy.ts';
import { useArkvoidStore } from '../engine/store.ts';
import { useReducedMotion } from '../hooks/useReducedMotion.ts';
import { Button } from '../ui/Button.tsx';
import { Chip } from '../ui/Chip.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Logo } from '../ui/Logo.tsx';

export default function Intro() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setScreen = useArkvoidStore((s) => s.setScreen);
  const openOverlay = useArkvoidStore((s) => s.openOverlay);
  const soundOn = useArkvoidStore((s) => s.ui.soundOn);
  const toggleSound = useArkvoidStore((s) => s.toggleSound);
  const aiMode = useArkvoidStore((s) => s.ai.mode);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.state = 'title';
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) {
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setScreen('world');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setScreen]);

  useEffect(() => {
    if (reducedMotion || !containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '[data-intro-item]',
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.75,
          stagger: 0.08,
          ease: 'expo.out',
        }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [reducedMotion]);

  const handleCardSelect = (cardId: 'explore' | 'demo' | 'glasses') => {
    if (cardId === 'explore') {
      setScreen('world');
    } else if (cardId === 'demo') {
      setScreen('world');
      openOverlay('director');
    } else if (cardId === 'glasses') {
      setScreen('glasses');
    }
  };

  return (
    <main
      ref={containerRef}
      className="min-h-dvh w-full bg-[var(--paper)] text-[var(--ink)] flex flex-col justify-between px-5 sm:px-8 md:px-14 py-6 md:py-10 relative overflow-x-hidden"
    >
      {/* Subtle dusk wash in upper canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] dusk-wash opacity-60"
      />

      {/* Top row: Brand mark + sound toggle */}
      <div
        data-intro-item
        className="relative z-10 w-full max-w-[1280px] mx-auto flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-2.5 shrink-0">
          <Logo size={36} animateOnMount />
          <span className="font-display text-lg tracking-tight text-[#14151A] whitespace-nowrap shrink-0">
            Arkvoid
          </span>
          <span aria-hidden="true" className="text-[#988686] hidden sm:inline">
            ·
          </span>
          <span className="text-[13px] text-[#4B4F56] hidden sm:inline whitespace-nowrap">
            {COMPANY_FACTS.statusBadge}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {aiMode === 'offline' && (
            <div className="hidden sm:block">
              <Chip
                tone="neutral"
                title="Running deterministic memory-backed offline voice"
              >
                Offline voice
              </Chip>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundOn ? 'Mute sound' : 'Turn sound on'}
            className="inline-flex items-center gap-2 min-h-[48px] px-3.5 sm:px-4 py-2 rounded-full bg-[var(--hud-paper)] border border-[var(--line)] text-[14px] text-[#14151A] hover:bg-[#F3F0EB] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Icon name={soundOn ? 'soundOn' : 'soundOff'} size={18} />
            <span>{soundOn ? 'Sound on' : 'Sound off'}</span>
          </button>
        </div>
      </div>

      {/* Center hero & three large entry cards */}
      <div className="relative z-10 w-full max-w-[1280px] mx-auto my-auto py-8 md:py-12">
        <div data-intro-item className="max-w-2xl mb-8 md:mb-12">
          <div className="mb-4">
            <Logo size={56} animateOnMount />
          </div>
          <h1
            className="font-display text-[#14151A] tracking-[-0.04em] leading-[1.04] mb-4"
            style={{ fontSize: 'clamp(2.5rem, 5.5vw, 4.75rem)' }}
          >
            {INTRO_COPY.headlinePrefix}
            <span className="font-serif-accent font-normal text-[#14151A] pr-1">
              {INTRO_COPY.headlineAccent}
            </span>
            {INTRO_COPY.headlineSuffix}
          </h1>
          <p className="text-[17px] md:text-[20px] text-[#4B4F56] leading-relaxed max-w-xl">
            {INTRO_COPY.subline}
          </p>
        </div>

        <div
          data-intro-item
          className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-stretch"
        >
          {INTRO_COPY.cards.map((card, idx) => {
            const isPrimary = idx === 0;
            return (
              <div
                key={card.id}
                className={`group rounded-[22px] md:rounded-[28px] p-6 md:p-8 border transition-transform duration-200 flex flex-col justify-between surface-shadow ${
                  isPrimary
                    ? 'bg-[#FAF8F5] border-[#14151A]/20'
                    : 'bg-[#F3F0EB]/85 border-[var(--line)]'
                }`}
              >
                <div>
                  <div className="font-mono-label text-[#4B4F56] mb-3">
                    {card.label}
                  </div>
                  <h2 className="font-display text-2xl md:text-[26px] text-[#14151A] mb-2.5">
                    {card.title}
                  </h2>
                  <p className="text-[#4B4F56] text-[16px] md:text-[17px] leading-relaxed mb-8">
                    {card.description}
                  </p>
                </div>

                <div>
                  <Button
                    variant={isPrimary ? 'ember' : 'ink'}
                    size="lg"
                    data-start={isPrimary ? 'true' : undefined}
                    onClick={() => handleCardSelect(card.id)}
                    className="w-full justify-between"
                  >
                    <span>{card.cta}</span>
                    <Icon name="arrowRight" size={18} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quiet honest footer */}
      <footer
        data-intro-item
        className="relative z-10 w-full max-w-[1280px] mx-auto pt-4 border-t border-[var(--line)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[13px] text-[#4B4F56]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-[#14151A]">{INTRO_COPY.footerCompany}</span>
          <span aria-hidden="true">·</span>
          <span>Press Enter to enter world</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setScreen('inspector')}
            className="underline underline-offset-4 hover:text-[#14151A] cursor-pointer"
          >
            Open Engine Inspector (I)
          </button>
        </div>
        <p className="text-[13px] text-[#4B4F56] max-w-xl">
          {INTRO_COPY.footerDisclaimer}
        </p>
      </footer>
    </main>
  );
}
