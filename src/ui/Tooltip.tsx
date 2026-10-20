import type { ReactNode } from 'react';

export interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
}

export function Tooltip({ label, shortcut, children }: TooltipProps) {
  return (
    <div className="relative group inline-flex">
      {children}
      <div
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-full bg-[#14151A] text-[#FAF8F5] text-[12px] whitespace-nowrap z-50 flex items-center gap-2 border border-[#FAF8F5]/15"
      >
        <span>{label}</span>
        {shortcut && (
          <span className="font-mono text-[11px] text-[#D1D0D0]">{shortcut}</span>
        )}
      </div>
    </div>
  );
}
