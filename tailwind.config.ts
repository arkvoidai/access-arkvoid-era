import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'var(--paper)',
          2: 'var(--paper-2)',
        },
        mist: 'var(--mist)',
        line: 'var(--line)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          soft: 'var(--ink-soft)',
        },
        stone: 'var(--stone)',
        taupe: 'var(--taupe)',
        ember: {
          DEFAULT: 'var(--ember)',
          deep: 'var(--ember-deep)',
          wash: 'var(--ember-wash)',
        },
        violet: {
          DEFAULT: 'var(--violet)',
          deep: 'var(--violet-deep)',
          wash: 'var(--violet-wash)',
        },
        hud: {
          paper: 'var(--hud-paper)',
          ink: 'var(--hud-ink)',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      borderRadius: {
        sheet: '28px',
        'sheet-sm': '22px',
      },
    },
  },
  plugins: [],
} satisfies Config;
