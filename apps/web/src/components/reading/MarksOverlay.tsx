import { useMemo } from 'react';
import type { FactMarks, MarkRect } from '@realytica/shared';

/** The marks' bounding box, for the ring round a value that runs over more than one line. */
function union(rects: MarkRect[]): MarkRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

/**
 * A fact's words marked on its page, the way a person would mark them: the
 * quote run over with a highlighter line by line, then the value itself
 * ringed. Laid over a page box of any size — the marks are fractions of the
 * page — and drawn afresh whenever `markId` changes.
 */
export function MarksOverlay({ marks, markId }: { marks: FactMarks; markId?: string }) {
  const ring = useMemo(() => union(marks.value ?? []), [marks]);
  return (
    <div key={markId} className="pointer-events-none absolute inset-0" aria-hidden>
      {marks.quote.map((r, i) => (
        <span
          key={i}
          className="absolute origin-left animate-mark-sweep rounded-[2px] bg-mark/45 mix-blend-multiply"
          style={{ left: pct(r.x - 0.004), top: pct(r.y - 0.002), width: pct(r.w + 0.008), height: pct(r.h + 0.004), animationDelay: `${i * 110}ms` }}
        />
      ))}
      {ring ? (
        <svg
          className="absolute overflow-visible"
          style={{ left: pct(ring.x - 0.02), top: pct(ring.y - 0.012), width: pct(ring.w + 0.04), height: pct(ring.h + 0.024) }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <ellipse
            cx="50"
            cy="50"
            rx="49"
            ry="47"
            pathLength={1}
            fill="none"
            stroke="var(--provenance-text)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="1"
            className="animate-ring-draw"
            style={{ animationDelay: `${marks.quote.length * 110 + 160}ms` }}
            transform="rotate(-2 50 50)"
          />
        </svg>
      ) : null}
    </div>
  );
}
