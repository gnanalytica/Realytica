# Design

The interface follows the **Copilot Desk** direction chosen on 29 September 2026: a conversation drives the work, and the canvas beside it shows whatever that conversation is about. This page lists the pieces every screen is built from. When a screen needs something not listed here, add it to the system rather than to the screen.

## Identity

| | Light | Dark | Used for |
|---|---|---|---|
| Ground | `#F4F5F7` | `#0E0F12` | The page. Cards are white sheets laid on it |
| Surface | `#FFFFFF` | `#17191D` | Cards, the chat column, bars |
| Sunken | `#EEF0F3` | `#111317` | Tracks, chips, hover |
| Ink | `#15171A` | `#F3F4F6` | Text, and the **action** colour: a primary button commits something |
| Teal | `#0B6464` | `rgb(86 190 184)` | Links, citations, the selected thing, focus |
| Rose | `#B0245A` | `rgb(232 112 160)` | Anything a model wrote that no person has accepted: the AI mark, proposal outlines, values waiting on a page |
| Good / Warning / Serious / Critical | `#16794A` · `#E0A100` · `#D8692F` · `#B42318` | lighter equivalents | Verdicts and statuses only. Amber and orange each have a darker text colour (`--status-warning-text`, `--status-serious-text`) |

All of them are CSS custom properties in `apps/web/src/index.css`, exposed through Tailwind as `page`, `surface`, `sunken`, `ink`, `action`, `brand`, `ai`, `good`, `warning`, `serious`, `critical` and `provenance` (which is rose). Never write a hex value in a component; a colour that exists only in one theme is the classic unreadable-in-dark-mode bug.

**Type.** Schibsted Grotesk for everything, DM Mono for figures, codes, counts and citations. Both are bundled (`@fontsource`), so the app makes no font request of its own. Kannada and Telugu come from Google Fonts for the originals a deed is written in. Sizes stay on an integer ladder of 10, 11, 12, 13, 14 and 15 px, with larger sizes for display; `pnpm lint:type` fails the build on half-pixel sizes.

## Motion

`apps/web/src/lib/motion.tsx`, on [`motion`](https://motion.dev). `MotionRoot` wraps the app with `reducedMotion="user"`: under the system's reduce-motion setting, transforms and layout animations arrive at once and only opacity fades. The stylesheet applies the same rule to CSS transitions.

| Piece | Use it for |
|---|---|
| `SPRING.snappy` | A control answering a touch: tab underlines, segment pills, toggles |
| `SPRING.settle` | Something arriving or moving into place |
| `SPRING.layer` | A dialog, sheet or toast |
| `Reveal` | A section of a page arriving, once, not every element on it |
| `Stagger` / `StaggerItem` | A list dealt row by row the first time it is drawn (35 ms apart) |
| `AnimatedNumber` | A figure that changes in place; it counts to the new value |
| `ScreenEnter` | A routed screen arriving (no exit, so navigation never waits) |
| `layoutId` | One selection that travels: a tab underline, a segment pill, the command bar's highlight |

Folds stay `<details>`, so find-in-page and print reach inside them, and they open to their height through CSS `::details-content`.

## Components

`apps/web/src/components/ui/kit.tsx` holds the shared components:

- **Card** and **CardHeader**: icons sit in a small tile.
- **Button**: primary is ink; presses scale.
- **Badge**: chips coloured by tone.
- **AiMark**: the rose "AI" square, on everything a model wrote.
- **Tabs**: the underline travels between tabs.
- **Modal**: a spring dialog on wide screens; below 640 px a bottom sheet, dragged down by its handle or header to close.
- **Tooltip**: appears after the pointer rests for 140 ms; on focus it appears at once.
- **Toast host**: toasts stack with a timer line.
- **ProgressBar**: fills when it appears.
- **Skeleton**: carries a sweep while content loads.

Department marks are in `components/departments/icons.ts`.

## Layout

- **Inside a project on desktop:** one project bar (back to Portfolio, the stage timeline, the review walk, health, alerts, the command bar, focus), then a single row of tabs, then the conversation on the left and the canvas on the right.
- **Inside a project on a phone:** the cockpit is the only header, a bottom bar switches between chat and the canvas, and the stage, the alerts and the stage record open as sheets.
- **Breakpoints:** panes lay themselves out with container queries (`[@container(min-width:…)]`), because a pane's width is whatever the chat leaves rather than the window's.
- **Touch targets:** they grow to 44 px under `coarse:`, a pointer media query rather than a width breakpoint.

## Checking a change

```bash
pnpm check
```

This runs typecheck, eslint, the dead-class check, the type-scale check and the tests. For anything visual, also look at the screen at 1440 × 900 and at 390 × 844 with touch, in both themes.
