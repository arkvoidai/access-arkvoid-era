import type { HTMLAttributes, ReactNode } from 'react';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'ember' | 'violet' | 'ink';
  children: ReactNode;
}

export function Chip({ tone = 'neutral', className = '', children, ...rest }: ChipProps) {
  // Respect design rules:
  // - ember never as small text colour; text on ember is ink
  // - violet-deep (#4A1D96) for small violet text
  const toneClass =
    tone === 'ember'
      ? 'bg-[#FFE9DE] text-[#14151A] border-[#D94400]/25'
      : tone === 'violet'
        ? 'bg-[#EFE7FD] text-[#4A1D96] border-[#4A1D96]/20'
        : tone === 'ink'
          ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
          : 'bg-[#F3F0EB] text-[#212529] border-[var(--line)]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono-label text-[12px] leading-none whitespace-nowrap shrink-0 ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
