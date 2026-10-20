import { useArkvoidStore } from '../engine/store.ts';

export function ToastHost() {
  const toasts = useArkvoidStore((s) => s.ui.toasts);
  const dismissToast = useArkvoidStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-20 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {toasts.map((t) => {
        const toneStyle =
          t.tone === 'ember'
            ? 'bg-[#FFE9DE] text-[#14151A] border-[#D94400]/30'
            : t.tone === 'violet'
              ? 'bg-[#EFE7FD] text-[#4A1D96] border-[#4A1D96]/25'
              : 'bg-[var(--hud-paper)] text-[#14151A] border-[var(--line)]';
        return (
          <div
            key={t.id}
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto cursor-pointer px-4 py-3 rounded-[22px] border hud-shadow text-[14px] leading-snug transition-opacity duration-150 ${toneStyle}`}
          >
            {t.text}
          </div>
        );
      })}
    </div>
  );
}
