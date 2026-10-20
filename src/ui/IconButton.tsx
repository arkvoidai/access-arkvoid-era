import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  active = false,
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-12 h-12 min-w-[48px] min-h-[48px] rounded-full border transition-colors duration-150 cursor-pointer shrink-0 ${
        active
          ? 'bg-[#14151A] text-[#FAF8F5] border-[#14151A]'
          : 'bg-[var(--hud-paper)] text-[#14151A] border-[var(--line)] hover:bg-[#F3F0EB]'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
