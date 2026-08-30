import { STATUS_FILL, STATUS_TEXT, arcPath, type StatusKey } from './primitives';

export interface CompletenessRingProps {
  score: number;
  size?: number;
  label?: string;
}

function completenessBand(score: number): { tone: StatusKey; word: string } {
  if (score >= 80) return { tone: 'good', word: 'Complete' };
  if (score >= 50) return { tone: 'warning', word: 'Partial' };
  return { tone: 'critical', word: 'Incomplete' };
}

/**
 * A full-circle ring meter for document completeness. Like `ConfidenceGauge`,
 * the number is the hero figure and the band word beneath it carries the
 * meaning; colour only reinforces it. A bare gauge — no hover layer.
 */
export default function CompletenessRing({ score, size = 152, label = 'Completeness' }: CompletenessRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const frac = clamped / 100;
  const { tone, word } = completenessBand(clamped);
  const color = STATUS_FILL[tone];
  const textColor = STATUS_TEXT[tone];

  const strokeW = Math.max(9, size * 0.1);
  const r = size / 2 - strokeW / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;

  const isFull = frac >= 0.999;
  const valueD = !isFull && frac > 0 ? arcPath(cx, cy, r, 0, 360 * frac) : '';

  const ariaLabel = `${label}: ${Math.round(clamped)} out of 100 — ${word}`;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg role="img" aria-label={ariaLabel} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <title>{label}</title>
        <desc>{ariaLabel}</desc>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--axis)" strokeWidth={strokeW} opacity={0.35} />
        {isFull ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
        ) : valueD ? (
          <path d={valueD} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
        ) : null}
        <text x={cx} y={cy - size * 0.06} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.24} fontWeight={600} fill="var(--text-primary)">
          {Math.round(clamped)}
        </text>
        <text x={cx} y={cy + size * 0.15} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.09} fontWeight={600} fill={textColor}>
          {word}
        </text>
      </svg>
      <div className="mt-0.5 text-mini font-medium uppercase tracking-[0.06em] text-ink-muted">{label}</div>
    </div>
  );
}
