import gsap from 'gsap';
import { type ReactNode, useEffect, useRef } from 'react';
import { useMedia } from '../hooks/useMedia.ts';
import { useReducedMotion } from '../hooks/useReducedMotion.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  widthClass?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  widthClass = 'md:w-[440px]',
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const isMobile = useMedia('(max-width: 767px)', false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const el = panelRef.current;
    if (reducedMotion) {
      gsap.set(el, { opacity: 1, x: 0, y: 0 });
      return;
    }
    if (isMobile) {
      gsap.fromTo(
        el,
        { opacity: 0, y: 36 },
        { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }
      );
    } else {
      gsap.fromTo(
        el,
        { opacity: 0, x: 28 },
        { opacity: 1, x: 0, duration: 0.55, ease: 'expo.out' }
      );
    }
  }, [open, isMobile, reducedMotion]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    dragStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || dragStartY.current === null || !panelRef.current) return;
    const dy = Math.max(0, e.touches[0].clientY - dragStartY.current);
    panelRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || dragStartY.current === null || !panelRef.current) return;
    const dy = e.changedTouches[0].clientY - dragStartY.current;
    dragStartY.current = null;
    if (dy > 90) {
      onClose();
    } else {
      panelRef.current.style.transform = 'translate3d(0, 0, 0)';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-stretch justify-end bg-[#14151A]/25 p-0 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`w-full ${widthClass} max-h-[88dvh] md:max-h-full bg-[#FAF8F5] text-[#14151A] border border-[var(--line)] rounded-t-[22px] md:rounded-[28px] hud-shadow flex flex-col overflow-hidden`}
      >
        {isMobile && (
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#D1D0D0]" />
          </div>
        )}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--line)]">
          <div>
            {subtitle && (
              <div className="font-mono-label text-[#4B4F56] mb-1">{subtitle}</div>
            )}
            <h2 className="font-display text-xl text-[#14151A]">{title}</h2>
          </div>
          <IconButton label={`Close ${title}`} onClick={onClose}>
            <Icon name="close" size={20} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
