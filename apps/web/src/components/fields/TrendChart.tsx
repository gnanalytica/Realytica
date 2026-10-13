/**
 * A field drawn over time: a line or bars, one point a period, and where the
 * field says so a second field drawn against it as a dashed line (planned
 * against actual). The points are shaped by `fieldTrend`; this only draws.
 *
 * Small on purpose: it lives inside the popover a field's label opens, and
 * under the progress board's ring. The first and last periods are named
 * below it, and every figure is in the title of its mark.
 */

import type { FieldTrend } from '@realytica/shared';

export function TrendChart({ trend, width = 280, height = 96 }: { trend: FieldTrend; width?: number; height?: number }) {
  const pad = { left: 6, right: 6, top: 8, bottom: 6 };
  const beside = trend.against?.points ?? [];
  // One place along the foot for each period either line has, in order.
  const xs = [...new Set([...trend.points, ...beside].map((point) => point.x))].sort();
  const all = [...trend.points, ...beside].map((point) => point.y);
  // Bars stand on nought. A line is drawn over the range it moves in, with a little room under it, so a figure that creeps is seen to creep.
  const [least, high] = [Math.min(...all), Math.max(...all)];
  const low = trend.mark === 'bar' ? Math.min(0, least) : least - (high - least || Math.abs(high) || 1) * 0.15;
  const span = high - low || 1;
  const step = (width - pad.left - pad.right) / Math.max(1, xs.length - (trend.mark === 'bar' ? 0 : 1));
  const xOf = (x: string) => pad.left + xs.indexOf(x) * step + (trend.mark === 'bar' ? step / 2 : 0);
  const yOf = (y: number) => height - pad.bottom - ((y - low) / span) * (height - pad.top - pad.bottom);
  const line = (points: FieldTrend['points']) => points.map((point) => `${xOf(point.x).toFixed(1)},${yOf(point.y).toFixed(1)}`).join(' ');
  const bar = Math.max(3, Math.min(22, step * 0.62));
  // The foot names the first and the last period drawn, whichever line they are of: a plan runs on past what has been reported.
  const named = new Map([...beside, ...trend.points].map((point) => [point.x, point.label]));
  const [first, last] = [{ label: named.get(xs[0]!)! }, { label: named.get(xs[xs.length - 1]!)! }];
  return (
    <figure className="m-0" data-trend={trend.mark}>
      <svg role="img" aria-label={`${trend.label}: ${trend.said}`} width="100%" viewBox={`0 0 ${width} ${height}`} className="block max-w-full" style={{ maxWidth: width }}>
        <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="text-ink-muted" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
        {beside.length > 1 ? <polyline fill="none" className="text-ink-muted" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" points={line(beside)} /> : null}
        {trend.mark === 'bar' ? (
          trend.points.map((point) => (
            <rect key={point.x} x={xOf(point.x) - bar / 2} width={bar} y={Math.min(yOf(point.y), yOf(Math.max(low, 0)))} height={Math.max(1, Math.abs(yOf(Math.max(low, 0)) - yOf(point.y)))} rx="1.5" className="text-brand" fill="currentColor" fillOpacity={point.open ? 0.45 : 1}>
              <title>{`${point.label}: ${point.said}`}</title>
            </rect>
          ))
        ) : (
          <>
            <polyline fill="none" className="text-brand" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={line(trend.points)} />
            {trend.points.map((point) => (
              <circle key={point.x} cx={xOf(point.x)} cy={yOf(point.y)} r="2.5" className="text-brand" fill={point.open ? 'var(--surface, white)' : 'currentColor'} stroke="currentColor" strokeWidth="1.5">
                <title>{`${point.label}: ${point.said}`}</title>
              </circle>
            ))}
          </>
        )}
      </svg>
      <figcaption className="mt-0.5 flex justify-between gap-2 text-[11px] text-ink-muted">
        <span>{first.label}</span>
        {trend.against ? (
          <span>
            <span className="text-brand">━</span> {trend.label.toLowerCase()} · <span>╌</span> {trend.against.label.toLowerCase()}
          </span>
        ) : null}
        <span>{last.label}</span>
      </figcaption>
    </figure>
  );
}
