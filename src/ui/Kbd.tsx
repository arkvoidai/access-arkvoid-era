import type { ReactNode } from 'react';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className = '' }: KbdProps) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-[26px] h-[24px] px-2 rounded-md bg-[#F3F0EB] border border-[var(--line)] font-mono text-[12px] text-[#212529] tabular-nums shrink-0 ${className}`}
    >
      {children}
    </kbd>
  );
}
