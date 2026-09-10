import type { Config } from 'tailwindcss';

// The HUD token set. Defined once, in DECISIONS.md and here, before any panel
// is styled (C-7). Panels are cool slate glass so they hold their own over a
// warm desert scene without competing with it; teal is the single bold accent.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: 'rgb(16 20 28 / <alpha-value>)',
        ink: '#E9EEF5',
        'ink-muted': '#9AA6B8',
        accent: '#37D2C6',
        warn: '#FFB547',
        error: '#FF5E6C',
        ok: '#62D889',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // The type scale: 11 / 12 / 13 / 15 / 18 / 24.
        '2xs': ['11px', '14px'],
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['15px', '22px'],
        lg: ['18px', '26px'],
        xl: ['24px', '30px'],
      },
      borderRadius: {
        panel: '6px',
      },
    },
  },
  plugins: [],
};

export default config;
