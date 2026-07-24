import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0b0d0c',
        foreground: '#f1f3ef',
        card: '#111412',
        muted: '#181c19',
        primary: {
          DEFAULT: '#567563',
          foreground: '#f2f6f3',
        },
        gold: '#b79a58',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
