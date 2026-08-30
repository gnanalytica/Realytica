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
        // Channel triplets, not resolved colours, so `border-ink/20` and
        // `bg-ink/25` compile. `--text-*` remain as resolved values alongside,
        // for inline SVG and plain CSS which cannot use the channel form.
        ink: {
          DEFAULT: 'rgb(var(--ink-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--ink-secondary-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted-rgb) / <alpha-value>)',
          inverse: 'var(--text-inverse)',
        },
        // Tones are declared against RGB channel triplets so alpha modifiers
        // (bg-warning/15, ring-brand/25) actually compile. A bare `var(--x)`
        // colour cannot take one and emits no CSS at all.
        //
        // The four below carry no verdict and are the product's identity:
        // they may be used freely for chrome, artwork and ambient colour.
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          strong: 'var(--brand-strong)',
          soft: 'rgb(var(--brand-soft-rgb) / <alpha-value>)',
          ink: 'var(--brand-ink)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          strong: 'var(--accent-strong)',
          soft: 'rgb(var(--accent-soft-rgb) / <alpha-value>)',
          ink: 'var(--accent-ink)',
        },
        violet: 'rgb(var(--violet-rgb) / <alpha-value>)',
        cyan: 'rgb(var(--cyan-rgb) / <alpha-value>)',
        // Status palette — reserved, never reused as a series or decorative colour.
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
      /*
       * The small end of the type scale, as tokens rather than 459 hand-set
       * pixel values.
       *
       * There were four sizes between 10 and 11.5px, which is not a scale —
       * a half-pixel distinction at that size is not a distinction anybody
       * can see, and having four of them meant no single place to change how
       * small "small" is. Two named steps replace them.
       *
       * The values resolve from CSS custom properties so `index.css` can
       * raise both under `pointer: coarse` in one block. That is the whole
       * reason for the indirection: 10px is legible on a monitor at arm's
       * length and is not legible on a phone in daylight, and Tailwind's
       * fontSize scale cannot itself be conditional on a media query.
       */
      fontSize: {
        micro: ['var(--text-micro)', { lineHeight: 'var(--leading-micro)' }],
        mini: ['var(--text-mini)', { lineHeight: 'var(--leading-mini)' }],
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
         *
         * Serif display over a saturated colour field is also the pairing
         * that keeps the product from looking like every other gradient
         * landing page: the colour is loud, the typography is not, and the
         * tension between them is the whole look.
         */
        display: ['ui-serif', 'Georgia', 'Iowan Old Style', 'Times New Roman', 'serif'],
      },
      borderRadius: { xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem' },
      /*
       * Every integer percentage, as an allowed alpha modifier.
       *
       * Tailwind's default opacity scale is coarse — 0, 5, 10, 20, 25, 30, 40,
       * 50 and up — and a modifier outside it does not error, warn, or fall
       * back. It emits nothing, and the utility is simply absent from the
       * stylesheet.
       *
       * That had already cost this codebase real pixels before anyone noticed.
       * `bg-warning/15`, `bg-good/12`, `ring-good/35`, `ring-warning/45` and
       * `ring-serious/45` are the fills and rings on every Badge, Callout and
       * verdict chip in the kit — none of them had ever rendered, so the
       * carefully-specified tone system was drawing borderless, fillless chips
       * and nobody could see what was missing because nothing was broken, only
       * absent.
       *
       * Declaring the full scale is free: the JIT still only emits the classes
       * the source actually uses. It just stops a designer's chosen value from
       * being silently discarded for not being a round number.
       */
      opacity: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), String(i / 100)])),
      /*
       * Named gradients, resolved from the token layer.
       *
       * Exposed as `bg-tile`, `bg-grad-good` and so on rather than written
       * inline, so a tone wash is one class everywhere and there is exactly
       * one definition of what "the warning wash" is. Inline gradients were
       * how the first pass at this drifted into five slightly different
       * blues.
       */
      backgroundImage: {
        tile: 'var(--grad-tile)',
        'tile-sunken': 'var(--grad-tile-sunken)',
        sheen: 'var(--tile-sheen)',
        band: 'var(--grad-band)',
        mesh: 'var(--grad-mesh)',
        aurora: 'var(--grad-aurora)',
        ramp: 'var(--grad-ramp)',
        // Named `ink-panel`, not `ink`: `colors.ink` already claims `bg-ink`,
        // and two definitions of one utility resolve by plugin order rather
        // than by intent — which showed up as a ticker whose text inherited
        // the page's dark ink onto a permanently dark panel and vanished in
        // light mode only.
        'ink-panel': 'var(--grad-ink)',
        spotlight: 'var(--grad-spotlight)',
        grain: 'var(--grain)',
        'grad-brand': 'var(--grad-brand)',
        'grad-accent': 'var(--grad-accent)',
        'grad-good': 'var(--grad-good)',
        'grad-warning': 'var(--grad-warning)',
        'grad-serious': 'var(--grad-serious)',
        'grad-critical': 'var(--grad-critical)',
      },
      /*
       * One elevation ramp, tinted and scaled by the theme.
       *
       * `--shadow-strength` is 1 on paper and 2.2 on a dark ground, because
       * the same alpha that reads as a soft lift on white is invisible on
       * near-black. Without it every tile in dark mode sat flat on the page
       * and the hover lift did nothing at all.
       *
       * `glow` and `glow-accent` are a separate register: coloured light
       * rather than cast shadow, for the few elements that should look
       * emissive — the primary call to action, a live agent, the brand mark.
       */
      boxShadow: {
        card: '0 1px 2px rgba(var(--shadow-tint), calc(0.04 * var(--shadow-strength))), 0 1px 1px rgba(var(--shadow-tint), calc(0.03 * var(--shadow-strength)))',
        tile: '0 1px 2px rgba(var(--shadow-tint), calc(0.05 * var(--shadow-strength))), 0 4px 12px -4px rgba(var(--shadow-tint), calc(0.06 * var(--shadow-strength)))',
        raised:
          '0 2px 4px rgba(var(--shadow-tint), calc(0.05 * var(--shadow-strength))), 0 10px 24px -8px rgba(var(--shadow-tint), calc(0.10 * var(--shadow-strength)))',
        pop: '0 8px 28px rgba(var(--shadow-tint), calc(0.14 * var(--shadow-strength)))',
        glow: 'var(--glow-brand)',
        'glow-accent': 'var(--glow-accent)',
      },
      /*
       * Durations and curves, kept to a vocabulary rather than a spectrum.
       *
       * Before this the app had three duration declarations in total and no
       * easing vocabulary, so every transition that existed was whatever
       * Tailwind's default happened to be and every one that did not exist
       * simply snapped. A small scale is deliberate: motion in a diligence
       * tool is there to make a change legible, and four people picking four
       * durations for the same gesture is what makes an interface feel
       * assembled rather than designed.
       *
       *   quick  — state you already expected: hover, press, focus.
       *   base   — something appearing or moving: a card, a panel, a row.
       *   slow   — something travelling far enough to need following.
       *   cine   — a rendered sequence: a survey sweep, a massing extrude.
       *            Long enough to read as footage rather than as a transition.
       */
      transitionDuration: {
        quick: '120ms',
        base: '200ms',
        slow: '320ms',
        cine: '900ms',
      },
      transitionTimingFunction: {
        /* Decelerate. For anything arriving — it should settle, not stop dead. */
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        /* Symmetric. For a state flipping back and forth, where a bounce reads as indecision. */
        state: 'cubic-bezier(0.4, 0, 0.2, 1)',
        /* Overshoot, slightly. Only for something that should feel physical. */
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
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

        /* ---------------------------------------------------------------- */
        /* Ambient — slow, edgeless, and never in front of anything readable */
        /* ---------------------------------------------------------------- */

        /*
         * Two field blobs drifting against each other is what turns a static
         * mesh gradient into something that looks alive. Deliberately long
         * and deliberately small in amplitude: a gradient you can watch move
         * is a distraction, one you notice only when you look back at the
         * screen is atmosphere.
         */
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(3%,-4%,0) scale(1.08)' },
          '66%': { transform: 'translate3d(-4%,2%,0) scale(0.95)' },
        },
        'drift-slow': {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1.05)' },
          '50%': { transform: 'translate3d(-5%,3%,0) scale(0.94)' },
        },
        orbit: { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
        breathe: {
          '0%,100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.04)' },
        },

        /* ---------------------------------------------------------------- */
        /* Cinematic — used by the rendered sequences                        */
        /* ---------------------------------------------------------------- */

        /* A survey line being traced. Paired with a dasharray set on the path. */
        trace: { from: { strokeDashoffset: 'var(--trace-len, 1000)' }, to: { strokeDashoffset: '0' } },
        /* A specular band crossing a surface: glass, a metal edge, a loading bar. */
        sweep: { from: { transform: 'translateX(-120%) skewX(-18deg)' }, to: { transform: 'translateX(220%) skewX(-18deg)' } },
        /* A massing block rising out of its footprint. */
        extrude: { from: { opacity: '0', transform: 'translateY(14px) scaleY(0.55)' }, to: { opacity: '1', transform: 'none' } },
        /* Arriving out of focus, the way a render resolves. */
        'blur-in': { from: { opacity: '0', filter: 'blur(12px)' }, to: { opacity: '1', filter: 'blur(0)' } },
        /* A marker settling onto a map. */
        drop: { from: { opacity: '0', transform: 'translateY(-40%) scale(0.6)' }, to: { opacity: '1', transform: 'none' } },
        /* An expanding ring, for a live pulse under a status dot. */
        ping: { from: { opacity: '0.55', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(2.4)' } },
        /* A continuous horizontal scroll, for a ticker of statutes. */
        ticker: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        shimmer: 'shimmer 1.4s infinite',
        'rise-in': 'rise-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'draw-rule': 'draw-rule 640ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'set-line': 'set-line 620ms cubic-bezier(0.16, 1, 0.3, 1) both',

        drift: 'drift 26s ease-in-out infinite',
        'drift-slow': 'drift-slow 38s ease-in-out infinite',
        orbit: 'orbit 44s linear infinite',
        breathe: 'breathe 7s ease-in-out infinite',

        trace: 'trace 1600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        sweep: 'sweep 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        extrude: 'extrude 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'blur-in': 'blur-in 800ms cubic-bezier(0.16, 1, 0.3, 1) both',
        drop: 'drop 620ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        ping: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        ticker: 'ticker 42s linear infinite',
      },
    },
  },
  plugins: [
    /*
     * `coarse:` — a media variant for touch, not a width breakpoint.
     *
     * The two are routinely conflated and they are different questions. `sm:`
     * asks how much room there is; this asks what is doing the pointing. A
     * 32px control is comfortable under a mouse and misses under a thumb, and
     * that is true of a 1024px tablet as much as a 375px phone — so a width
     * breakpoint would fix the phone and leave the tablet, while making every
     * desktop control bigger would give up the density this product is for
     * (see the aesthetic note in the design spec: data-dense where data
     * lives).
     *
     * WCAG 2.5.8 asks for 24px minimum and 2.5.5 for 44px enhanced. The
     * primitives below take 44 on coarse pointers, because a valuer standing
     * at a property with one hand on a gate is the actual use.
     */
    ({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
      addVariant('fine', '@media (pointer: fine)');
    },
  ],
};
