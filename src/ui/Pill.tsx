import type { HTMLAttributes, ReactNode } from 'react';

export interface PillProps extends HTMLAttributes<HTMLDivElement> {
  surface?: 'paper' | 'ink';
  children: ReactNode;
}

export function Pill({ surface = 'paper', className = '', children, ...rest }: PillProps) {
  const surfaceClass =
    surface === 'ink'
      ? 'bg-[var(--hud-ink)] text-[#FAF8F5] border border-[#FAF8F5]/15'
      : 'bg-[var(--hud-paper)] text-[#14151A] border border-[var(--line)]';

  return (
    <div
      className={`inline-flex items-center rounded-full hud-shadow ${surfaceClass} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
