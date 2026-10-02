/**
 * Motion, in one vocabulary.
 *
 * The CSS layer (`tailwind.config.js`: three durations, two curves) covers
 * what a stylesheet can: hover, press, focus, a fold opening. This covers what
 * it cannot — something leaving before it is removed, a figure counting to
 * its new value, a selection sliding from one tab to the next, a list
 * arriving one row after another — on `motion`, with springs named for what
 * they are used for rather than for their numbers.
 *
 * `MotionRoot` sets `reducedMotion="user"`: under the system's reduce-motion
 * setting every transform and layout animation below arrives at once, and
 * only opacity still fades. The CSS guard in `index.css` does the same for
 * the stylesheet, so the two layers agree.
 */

import { animate, AnimatePresence, MotionConfig, motion, useDragControls, useInView, useReducedMotion, type Transition, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export { AnimatePresence, motion, useDragControls };

/** The springs, by job. */
export const SPRING = {
  /** A control answering a touch: fast, no overshoot. Tabs, toggles, segment pills. */
  snappy: { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 },
  /** Something arriving or moving into place: settles rather than stops. */
  settle: { type: 'spring', stiffness: 300, damping: 32 },
  /** A layer over the page — a dialog, a sheet, a toast. Heavier, so it reads as a surface. */
  layer: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 },
} satisfies Record<string, Transition>;

/** Decelerate: for anything arriving. The same curve as `ease-enter` in the stylesheet. */
export const EASE_ENTER = [0.16, 1, 0.3, 1] as const;

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={SPRING.settle}>
      {children}
    </MotionConfig>
  );
}

/**
 * Rises into place the first time it is shown.
 *
 * For a section of a page, not for every element on it: one block arriving
 * is a page settling, twenty of them is a page that cannot sit still.
 */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_ENTER, delay }}
    >
      {children}
    </motion.div>
  );
}

const STAGGER_PARENT: Variants = {
  hidden: {},
  shown: (gap: number = 0.035) => ({ transition: { staggerChildren: gap, delayChildren: 0.02 } }),
};

const STAGGER_CHILD: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_ENTER } },
};

/**
 * A list whose rows arrive one after another, the first time it is drawn.
 *
 * The gap is short (35ms) and capped by the list itself: twelve rows take
 * under half a second, which reads as the list being dealt rather than as a
 * wait. A list that changes later does not replay it.
 */
export function Stagger({
  children,
  className,
  gap,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  as?: 'div' | 'ul' | 'ol' | 'section';
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={STAGGER_PARENT} custom={gap} initial="hidden" animate="shown">
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article';
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={STAGGER_CHILD}>
      {children}
    </Tag>
  );
}

/**
 * A figure that travels to its new value.
 *
 * A count that changes in place — fifty-seven to review, then fifty-five — is
 * the clearest signal that something just happened, and a number that snaps
 * is one most people never notice changed. It counts once when it comes into
 * view and again on every change, and under reduced motion it simply shows
 * the value.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString('en-IN'),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const shown = useRef(0);
  const [text, setText] = useState(() => format(reduce ? value : 0));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      shown.current = value;
      setText(format(value));
      return;
    }
    const controls = animate(shown.current, value, {
      duration: Math.min(0.9, 0.35 + Math.abs(value - shown.current) / 400),
      ease: EASE_ENTER,
      onUpdate: (n) => {
        shown.current = n;
        setText(format(n));
      },
    });
    return () => controls.stop();
    // `format` is a presentation choice; a new function identity each render
    // must not restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, reduce]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}

/**
 * A routed screen arriving.
 *
 * Keyed by the caller (the path), so each screen enters on its own; the old
 * one is not held back to animate out, because a navigation that waits for an
 * exit is a navigation that feels slow.
 */
export function ScreenEnter({ children, id, className }: { children: ReactNode; id: string; className?: string }) {
  return (
    <motion.div
      key={id}
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_ENTER }}
    >
      {children}
    </motion.div>
  );
}
