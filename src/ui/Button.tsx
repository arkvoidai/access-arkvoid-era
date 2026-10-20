import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ember' | 'ink' | 'paper' | 'subtle';
  size?: 'md' | 'lg';
  children: ReactNode;
}

export function Button({
  variant = 'ink',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-transform duration-150 active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer';

  const sizeClass =
    size === 'lg'
      ? 'min-h-[52px] px-6 py-3 text-[16px]'
      : 'min-h-[48px] px-5 py-2.5 text-[15px]';

  // Design rule: text on ember is ink (#14151A)
  const variantClass =
    variant === 'ember'
      ? 'bg-[#FB5607] text-[#14151A] hover:bg-[#D94400] border border-[#14151A]/10'
      : variant === 'ink'
        ? 'bg-[#14151A] text-[#FAF8F5] hover:bg-[#212529] border border-[#14151A]'
        : variant === 'paper'
          ? 'bg-[var(--hud-paper)] text-[#14151A] hover:bg-[#F3F0EB] border border-[var(--line)]'
          : 'bg-transparent text-[#14151A] hover:bg-[#14151A]/[0.06] border border-transparent';

  return (
    <button
      type="button"
      className={`${base} ${sizeClass} ${variantClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
