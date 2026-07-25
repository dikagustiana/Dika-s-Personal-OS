import type { Config } from 'tailwindcss';

// The colour scale is a full override, not an extension: every colour a
// component can name resolves to a CSS variable from src/index.css (the
// Imperial-derived ramp). Tailwind's default palette (gray-600 etc.) is
// deliberately absent so an unmapped colour class produces no CSS and gets
// caught in review instead of silently shipping an off-palette value.
export default {
  // Inert: the app is light-only, there is no `.dark` class on the document
  // and no `dark:` variant anywhere in src/. Kept so the config keeps its
  // shape; it generates nothing.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      // True black, used only for scrims/overlays behind modals and drawers.
      black: '#000',
      background: 'hsl(var(--background))',
      foreground: {
        DEFAULT: 'hsl(var(--foreground))',
        secondary: 'hsl(var(--foreground-secondary))',
        muted: 'hsl(var(--foreground-muted))',
      },
      surface: {
        1: 'hsl(var(--surface-1))',
        2: 'hsl(var(--surface-2))',
        3: 'hsl(var(--surface-3))',
      },
      card: {
        DEFAULT: 'hsl(var(--surface-1))',
        foreground: 'hsl(var(--foreground))',
      },
      popover: {
        DEFAULT: 'hsl(var(--surface-2))',
        foreground: 'hsl(var(--foreground))',
      },
      primary: {
        DEFAULT: 'hsl(var(--primary))',
        dim: 'hsl(var(--primary-dim))',
        foreground: 'hsl(var(--primary-foreground))',
      },
      secondary: {
        DEFAULT: 'hsl(var(--surface-2))',
        foreground: 'hsl(var(--foreground-secondary))',
      },
      muted: {
        DEFAULT: 'hsl(var(--surface-3))',
        foreground: 'hsl(var(--foreground-muted))',
      },
      accent: {
        DEFAULT: 'hsl(var(--primary-dim))',
        foreground: 'hsl(var(--foreground))',
      },
      destructive: {
        DEFAULT: 'hsl(var(--destructive))',
        foreground: 'hsl(var(--destructive-foreground))',
      },
      // Done / completed / positive delta — never a warning, never an action.
      // Split out from `primary` when the theme went light: on navy a blue
      // "done" would have merged into the ground, which is why done used to
      // borrow the primary. On white the two roles can and should be
      // different colours.
      success: {
        DEFAULT: 'hsl(var(--success))',
        foreground: 'hsl(var(--success-foreground))',
      },
      // Amber marker for due-soon / escalation / TBC only — never positive
      // states (green) and never blocked (red).
      escalate: {
        DEFAULT: 'hsl(var(--escalate))',
        foreground: 'hsl(var(--escalate-foreground))',
      },
      border: {
        DEFAULT: 'hsl(var(--border))',
        subtle: 'hsl(var(--border-subtle))',
      },
      input: 'hsl(var(--input))',
      ring: 'hsl(var(--ring))',
      chart: {
        1: 'hsl(var(--chart-1))',
        2: 'hsl(var(--chart-2))',
        3: 'hsl(var(--chart-3))',
        4: 'hsl(var(--chart-4))',
      },
    },
    extend: {
      // Bare `border` / `divide-*` with no colour named falls back to the
      // subtle internal-divider tone rather than Tailwind's (removed) gray.
      borderColor: {
        DEFAULT: 'hsl(var(--border-subtle))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // The only card lift in the app. Navy-tinted, single layer — a light
      // theme separates elevation with a hairline border plus this, not with
      // a bigger lightness gap.
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      fontSize: {
        // Type scale roles beyond Tailwind defaults (body = text-sm 14/1.5,
        // caption = text-xs 12/1.4, both already right by default).
        'card-heading': ['1.1875rem', { lineHeight: '1.3' }],
        data: ['0.9375rem', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
} satisfies Config;
