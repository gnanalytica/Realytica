/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces & ink resolve from CSS custom properties so light/dark swap in one place.
        page: 'var(--page)',
        surface: 'var(--surface-1)',
        raised: 'var(--surface-2)',
        sunken: 'var(--surface-3)',
        hairline: 'var(--hairline)',
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        // Tones are declared against RGB channel triplets so alpha modifiers
        // (bg-warning/15, ring-brand/25) actually compile. A bare `var(--x)`
        // colour cannot take one and emits no CSS at all.
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          strong: 'var(--brand-strong)',
          soft: 'rgb(var(--brand-soft-rgb) / <alpha-value>)',
          ink: 'var(--brand-ink)',
        },
        // Status palette — reserved, never reused as a series colour.
        good: 'rgb(var(--status-good-rgb) / <alpha-value>)',
        warning: 'rgb(var(--status-warning-rgb) / <alpha-value>)',
        serious: 'rgb(var(--status-serious-rgb) / <alpha-value>)',
        critical: 'rgb(var(--status-critical-rgb) / <alpha-value>)',
        // Categorical series slots, fixed order, never cycled.
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
          4: 'var(--series-4)',
          5: 'var(--series-5)',
          6: 'var(--series-6)',
          7: 'var(--series-7)',
          8: 'var(--series-8)',
        },
        grid: 'var(--gridline)',
        axis: 'var(--axis)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        /*
         * A serif, for display type only.
         *
         * The app itself is sans throughout and stays that way — this exists
         * so the front door can shift register into the one this product
         * belongs to: registries, statutes, title opinions. A system stack
         * rather than a webfont because nothing in this app makes an external
         * request, and Georgia is on effectively every machine that will open
         * it.
         */
        display: ['ui-serif', 'Georgia', 'Iowan Old Style', 'Times New Roman', 'serif'],
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem' },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 1px rgba(11,11,11,0.03)',
        pop: '0 8px 28px rgba(11,11,11,0.14)',
      },
      /*
       * Three durations and two curves, and nothing else.
       *
       * Before this the app had three duration declarations in total and no
       * easing vocabulary, so every transition that existed was whatever
       * Tailwind's default happened to be and every one that did not exist
       * simply snapped. A scale this small is deliberate: motion in a
       * diligence tool is there to make a change legible, and four people
       * picking four durations for the same gesture is what makes an interface
       * feel assembled rather than designed.
       *
       *   quick  — state you already expected: hover, press, focus.
       *   base   — something appearing or moving: a card, a panel, a row.
       *   slow   — something travelling far enough to need following.
       */
      transitionDuration: {
        quick: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        /* Decelerate. For anything arriving — it should settle, not stop dead. */
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        /* Symmetric. For a state flipping back and forth, where a bounce reads as indecision. */
        state: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        /* A message arriving in a conversation: from below, because that is where it came from. */
        'rise-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        /* A panel or disclosure opening in place. */
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        /*
         * A rule being drawn, and a line of type being set.
         *
         * Both belong to the front door, where the conceit is a document
         * being typeset rather than an interface appearing. They are declared
         * here rather than inline so they inherit the same reduced-motion
         * guard as everything else — a page with its own bespoke animation
         * system is a page that quietly opts out of that guard.
         */
        'draw-rule': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        'set-line': { from: { transform: 'translateY(105%)' }, to: { transform: 'translateY(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        shimmer: 'shimmer 1.4s infinite',
        'rise-in': 'rise-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'draw-rule': 'draw-rule 640ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'set-line': 'set-line 620ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
};
