import type { ConfidenceBand } from '@realytica/shared';
import { confidenceTone, titleCase } from '../../lib/format';
import { STATUS_FILL, STATUS_TEXT, arcPath, polarToCartesian, type StatusKey } from './primitives';

export interface ConfidenceGaugeProps {
  score: number;
  band: ConfidenceBand;
  size?: number;
  label?: string;
}

const START_DEG = -90;
const END_DEG = 90;

/**
 * A semicircular arc meter. The score is the hero figure and the band word
 * beneath it is what actually carries the meaning — colour only reinforces
 * it, per the confidence band's reserved status colour.
 *
 * A bare gauge with no plot: no hover layer, per the chart rules' one exception.
 */
export default function ConfidenceGauge({ score, band, size = 168, label = 'Confidence' }: ConfidenceGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const frac = clamped / 100;
  const tone = confidenceTone(band) as StatusKey;
  const color = STATUS_FILL[tone];
  const textColor = STATUS_TEXT[tone];

  const strokeW = Math.max(9, size * 0.09);
  const r = size / 2 - strokeW / 2 - 2;
  const cx = size / 2;
  const cy = r + strokeW / 2 + 2;
  const height = cy + strokeW / 2 + 6;

  const trackD = arcPath(cx, cy, r, START_DEG, END_DEG);
  const valueDeg = START_DEG + (END_DEG - START_DEG) * frac;
  const valueD = frac > 0 ? arcPath(cx, cy, r, START_DEG, valueDeg) : '';
  const knob = polarToCartesian(cx, cy, r, valueDeg);

  const ariaLabel = `${label}: ${Math.round(clamped)} out of 100, ${titleCase(band)} confidence`;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg role="img" aria-label={ariaLabel} width={size} height={height} viewBox={`0 0 ${size} ${height}`}>
        <title>{label}</title>
        <desc>{ariaLabel}</desc>
        <path d={trackD} fill="none" stroke="var(--axis)" strokeWidth={strokeW} strokeLinecap="round" opacity={0.35} />
        {valueD ? <path d={valueD} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" /> : null}
        {frac > 0 ? <circle cx={knob.x} cy={knob.y} r={strokeW / 2 + 1.5} fill={color} stroke="var(--page)" strokeWidth={2} /> : null}
        <text x={cx} y={cy - r * 0.32} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.24} fontWeight={600} fill="var(--text-primary)">
          {Math.round(clamped)}
        </text>
        <text x={cx} y={cy - r * 0.32 + size * 0.16} textAnchor="middle" dominantBaseline="hanging" fontSize={size * 0.08} fontWeight={600} fill={textColor}>
          {titleCase(band)}
        </text>
      </svg>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
    </div>
  );
}
