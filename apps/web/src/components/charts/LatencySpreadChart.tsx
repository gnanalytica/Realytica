import type { ProviderPerformance } from '@realytica/shared';
import type { ProviderId } from '@realytica/shared';

const formatRoute = (_provider: ProviderId, model: string): string => model;
import {
  BaselineAxis,
  ChartContainer,
  ChartEmpty,
  ChartSvg,
  GridLine,
  TickText,
  niceTicks,
  scaleLinear,
  useMeasure,
} from './primitives';

export interface LatencySpreadChartProps {
  rows: ProviderPerformance[];
  height?: number;
}

const ROW_H = 30;
const AXIS_H = 24;
const LABEL_W = 186;

/**
 * Median and p95 together, because the gap between them is the finding.
 *
 * The table gives both numbers and puts them in separate columns, where the
 * relationship between them has to be computed by the reader. A route with a
 * median of 800ms and a p95 of 12s is a completely different proposition from
 * one at 1.2s and 1.5s — the first will feel broken to one user in twenty and
 * fine in every average — and that is a shape, not a pair of figures.
 *
 * Drawn as median dot plus a bar running to p95, so a long tail is literally
 * long. No mean anywhere: one ninety-second outlier should not define a
 * profile, which is why the summary reports a median in the first place.
 */
export default function LatencySpreadChart({ rows, height }: LatencySpreadChartProps) {
  const [containerRef, size] = useMeasure<HTMLDivElement>();

  const usable = rows.filter(r => r.calls > 0);
  const H = height ?? usable.length * ROW_H + AXIS_H + 10;

  if (usable.length === 0) {
    return (
      <ChartContainer innerRef={containerRef}>
        <ChartEmpty label="No model calls recorded in this window" height={H} />
      </ChartContainer>
    );
  }
  if (size.width <= 0) return <div ref={containerRef} style={{ height: H }} />;

  const W = size.width;
  const max = Math.max(...usable.map(r => r.p95DurationMs), 1);
  const x = scaleLinear([0, max], [LABEL_W, W - 46]);
  const axisY = H - AXIS_H;
  const secs = (msValue: number): string => (msValue >= 1000 ? `${(msValue / 1000).toFixed(1)}s` : `${Math.round(msValue)}ms`);

  return (
    <ChartContainer innerRef={containerRef}>
      <ChartSvg
        width={W}
        height={H}
        ariaLabel={`Latency by route: ${usable.map(r => `${formatRoute(r.provider, r.model)} median ${secs(r.medianDurationMs)}, p95 ${secs(r.p95DurationMs)}`).join('; ')}`}
        title="Latency by route"
        desc="Median shown as a dot, the bar running to the 95th percentile."
      >
        {niceTicks(0, max, 4).map(t => (
          <g key={t}>
            <GridLine x1={x(t)} y1={0} x2={x(t)} y2={axisY} />
            <TickText x={x(t)} y={axisY + 16} anchor="middle">
              {secs(t)}
            </TickText>
          </g>
        ))}
        {usable.map((r, i) => {
          const y = i * ROW_H + ROW_H / 2;
          const route = formatRoute(r.provider, r.model);
          return (
            <g key={route}>
              <TickText x={LABEL_W - 8} y={y + 4} anchor="end">
                {route.length > 26 ? `${route.slice(0, 25)}…` : route}
              </TickText>
              <line x1={x(r.medianDurationMs)} y1={y} x2={x(r.p95DurationMs)} y2={y} stroke="var(--series-4)" strokeWidth={6} strokeLinecap="round" opacity={0.5} />
              <circle cx={x(r.medianDurationMs)} cy={y} r={5} fill="var(--series-1)" />
              <text x={x(r.p95DurationMs) + 8} y={y + 4} className="fill-[var(--text-muted)] text-[10px] tabular">
                {secs(r.p95DurationMs)}
              </text>
              <title>{`${route}: median ${secs(r.medianDurationMs)}, p95 ${secs(r.p95DurationMs)}, ${r.calls} call(s)`}</title>
            </g>
          );
        })}
        <BaselineAxis x1={LABEL_W} y1={axisY} x2={W - 46} y2={axisY} />
      </ChartSvg>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--series-1)' }} /> median
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full" style={{ background: 'var(--series-4)', opacity: 0.5 }} /> to 95th percentile
        </span>
      </div>
    </ChartContainer>
  );
}
