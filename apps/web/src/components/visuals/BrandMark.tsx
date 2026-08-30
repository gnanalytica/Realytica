import { useId } from 'react';
import { cn } from '../ui/kit';

/*
 * The mark.
 *
 * What was here was an equilateral triangle in a blue rounded square, which is
 * the shape a logo has when nobody has decided what the logo means. It said
 * "software", generically, and it appeared in the sidebar, the favicon and the
 * masthead — three places where the product introduces itself.
 *
 * This one is a parcel seen from above: the boundary as a rotated square, the
 * buildable footprint set inside it, and one survey peg on the corner the
 * dimension is taken from. It is drawn the way this product draws everything
 * else, so the mark and the artwork are the same idea at two sizes, and it
 * carries the identity ramp — the same four colours as the app frame, the
 * section rules and the progress fills.
 *
 * It survives being small. At 16px the inner square and the peg merge into a
 * single weight and the silhouette still reads as a diamond with a dot, which
 * is the test a favicon has to pass and the test a triangle-in-a-square passes
 * only by being unmemorable.
 */
export function BrandMark({ size = 28, className, animate = false }: { size?: number; className?: string; animate?: boolean }) {
  // Gradients live in `defs` and are referenced by id, so two marks on one page
  // (sidebar and masthead) would collide on a hard-coded id and the second
  // would silently take the first's colours.
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Realytica"
    >
      <defs>
        <linearGradient id={`bm-a-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-rgb))" />
          <stop offset="55%" stopColor="rgb(var(--violet-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--accent-rgb))" />
        </linearGradient>
        <linearGradient id={`bm-b-${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(var(--cyan-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--brand-rgb))" />
        </linearGradient>
      </defs>

      {/* The parcel. */}
      <path
        d="M24 3 L45 24 L24 45 L3 24 Z"
        fill="none"
        stroke={`url(#bm-a-${id})`}
        strokeWidth="4"
        strokeLinejoin="round"
        className={cn(animate && 'animate-trace')}
        style={animate ? ({ ['--trace-len']: 120, strokeDasharray: 120 } as React.CSSProperties) : undefined}
      />
      {/* The footprint, set in off-centre the way a real one sits behind its
          setback rather than in the middle of the plot. */}
      <path d="M24 15 L33 24 L24 33 L15 24 Z" fill={`url(#bm-b-${id})`} opacity="0.92" />
      {/* The peg. */}
      <circle cx="24" cy="3" r="3.6" fill="rgb(var(--accent-rgb))" />
    </svg>
  );
}

/** The mark with the name beside it, as the product signs itself. */
export function BrandLock({ className, size = 26 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark size={size} />
      <span className="font-display tracking-tight text-ink" style={{ fontSize: size * 0.66 }}>
        Realytica
      </span>
    </span>
  );
}
