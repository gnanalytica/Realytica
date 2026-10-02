/**
 * How the site app moves: one small vocabulary of springs and arrivals, so
 * every screen moves the same way.
 *
 * Motion here is feedback, not decoration: a control gives under the thumb,
 * a list arrives in reading order, a bar fills to its new value, a sheet can
 * be pulled away. All of it follows the phone's Reduce Motion setting —
 * ReduceMotion.System makes these land instantly, and the components that
 * loop or travel (pulses, spinners, the press scale) check useReducedMotion()
 * and keep still.
 */
import { Platform } from 'react-native';
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
  ZoomIn,
  type StyleProps,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

/** Press-in and release: quick, critically damped, never overshoots. */
export const PRESS_SPRING: WithSpringConfig = { mass: 1, stiffness: 600, damping: 45, overshootClamping: true, reduceMotion: ReduceMotion.System };

/** Something gliding to where it belongs: a slider thumb, a tab indicator, a sheet. */
export const SETTLE_SPRING: WithSpringConfig = { mass: 1, stiffness: 280, damping: 30, reduceMotion: ReduceMotion.System };

/** Fades and colour changes. */
export const FADE: WithTimingConfig = { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System };

/** Bars and rings filling to their value. */
export const FILL: WithTimingConfig = { duration: 700, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };

/** How long a count takes to tick to a new value. */
export const TICK_MS = 600;

/** Lists arrive one after another, this far apart... */
export const STAGGER_MS = 35;
/** ...up to here, so even a long list is in place in under half a second. */
const STAGGER_CAP_MS = 210;

function staggered(index: number): number {
  return Math.min(Math.max(0, index) * STAGGER_MS, STAGGER_CAP_MS);
}

/**
 * Start an arrival from a shorter distance than the preset's. Phones only:
 * Reanimated's web build pins any element whose entering animation has custom
 * initial values to an absolute position once it ends, which breaks the page
 * around it, so the (development-only) web build keeps the preset's distance.
 */
export function travel<T extends { withInitialValues: (values: StyleProps) => T }>(builder: T, values: StyleProps): T {
  return Platform.OS === 'web' ? builder : builder.withInitialValues(values);
}

/** A card or row arriving: up from 10pt below, fading in, on a spring. */
export function arrive(index = 0) {
  return travel(FadeInDown.springify().mass(1).stiffness(300).damping(30), { opacity: 0, transform: [{ translateY: 10 }] })
    .delay(staggered(index))
    .reduceMotion(ReduceMotion.System);
}

/** Something small appearing in place: a photo thumbnail, a badge, a tick. */
export function pop(index = 0) {
  return ZoomIn.springify().mass(1).stiffness(380).damping(22).delay(staggered(index)).reduceMotion(ReduceMotion.System);
}

// The builders below are shared instances: pass them as they are. Chaining
// on one (`.delay(…)`) would change it for every screen that uses it.

/** A quiet arrival with no travel, for text that replaces other text. */
export const appear = FadeIn.duration(220).reduceMotion(ReduceMotion.System);

/** Arriving from above: a toast, the no-signal strip. */
export const dropIn = FadeInUp.springify().mass(1).stiffness(320).damping(28).reduceMotion(ReduceMotion.System);

/** A row leaving the list. */
export const leave = FadeOut.duration(160).reduceMotion(ReduceMotion.System);

/** Leaving upwards: a toast, the no-signal strip. */
export const liftOut = FadeOutUp.duration(200).reduceMotion(ReduceMotion.System);

/** The rows that stay, closing the gap a removed one left. */
export const reflow = LinearTransition.springify().mass(1).stiffness(300).damping(32).reduceMotion(ReduceMotion.System);
