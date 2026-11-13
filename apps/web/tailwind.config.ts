import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-subtle': 'var(--surface-subtle)',
        fg: 'var(--fg)',
        muted: { DEFAULT: 'var(--muted)', 2: 'var(--muted-2)' },
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
          fg: 'var(--accent-fg)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          deep: 'var(--brand-deep)',
          mint: 'var(--brand-mint)',
          hover: 'var(--brand-hover)',
          on: 'var(--on-brand)',
          'on-2': 'var(--on-brand-2)',
        },
        tertiary: { DEFAULT: 'var(--tertiary)', soft: 'var(--tertiary-soft)', ink: 'var(--tertiary-ink)' },
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)', ink: 'var(--success-ink)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', ink: 'var(--danger-ink)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
        offline: { soft: 'var(--offline-soft)', ink: 'var(--offline-ink)' },
        neutral: 'var(--neutral)',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '13px',
        pill: '999px',
      },
      boxShadow: {
        sm: 'var(--sh-sm)',
        md: 'var(--sh-md)',
        lg: 'var(--sh-lg)',
        fab: 'var(--sh-fab)',
        'fab-plus': 'var(--sh-fab-plus)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [animate],
};

export default config;
