import type { SchematicYield } from '@realytica/shared';

export interface ParkingMeterChartProps {
  yieldResult: SchematicYield;
  /** How to render an area in the reader's chosen unit. */
  formatArea: (sqm: number) => string;
}

/**
 * Whether the parking fits, and how far down you have to dig for it.
 *
 * Two stat tiles said "285 car spaces" and "2 basement levels" and left the
 * arithmetic between them to the reader. The number that actually decides a
 * Bengaluru scheme is neither: it is the *overshoot* — how far the last
 * basement's capacity is exceeded by the requirement, because a norm missed
 * by eleven cars costs a whole extra excavated level, and an excavated level
 * is the single largest line in a mid-rise budget that nobody prices at
 * first pass.
 *
 * So this draws the requirement against the levels, as a stack filling up.
 * A level that fills completely is spent; the last one shows how much of it
 * is used, which is the slack a smaller unit mix or a mechanical stacker
 * could still claw back.
 *
 * One hue, stepping by level, because these are the same quantity being
 * accumulated rather than categories being compared. Status colour appears
 * only when the last level is nearly full, where it means something.
 */

const LEVEL_H = 26;
const GAP = 2;

export default function ParkingMeterChart({ yieldResult: y, formatArea }: ParkingMeterChartProps) {
  const required = y.parkingSpacesRequired;
  const perLevel = y.parkingSpacesPerBasement;
  const levels = y.basementLevelsNeeded;

  if (required <= 0 || perLevel <= 0 || levels <= 0) {
    return null;
  }

  const capacity = perLevel * levels;
  const spare = capacity - required;
  /*
   * How full the last level is. Everything above it is full by construction —
   * the level count is `ceil(required / perLevel)` — so only the last one has
   * a partial fill, and it is the only one whose number tells you anything.
   */
  const onLastLevel = required - perLevel * (levels - 1);
  const lastLevelPct = Math.round((onLastLevel / perLevel) * 100);
  // Within one level's capacity of needing another. That is the state worth
  // flagging: it is where a small change in the unit mix changes the dig.
  const tight = spare < perLevel * 0.15;

  // A plain div, not `ChartContainer`: nothing here is an SVG that needs
  // measuring, so the container's `innerRef` would be a ref to nowhere.
  return (
    <div className="relative w-full">
      <div className="flex flex-col gap-[2px]" role="img" aria-label={`${required} car spaces required, ${levels} basement level${levels === 1 ? '' : 's'} at ${perLevel} spaces each, ${spare} spaces spare`}>
        {Array.from({ length: levels }, (_, i) => {
          // Top of the stack is the deepest level, so the diagram reads
          // downward the way the building does.
          const levelIndex = levels - 1 - i;
          const filled = levelIndex === levels - 1 ? onLastLevel : perLevel;
          const pct = (filled / perLevel) * 100;
          return (
            <div key={levelIndex} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-right font-mono text-mini tabular-nums text-ink-muted">
                B{levelIndex + 1}
              </span>
              <div className="flex-1 overflow-hidden rounded-md bg-sunken" style={{ height: LEVEL_H }}>
                <div
                  className="h-full rounded-md transition-[width] duration-base"
                  style={{
                    width: `${pct}%`,
                    // Deeper levels sit lighter: one hue stepping, not four
                    // colours competing.
                    background: 'var(--series-1)',
                    opacity: 1 - levelIndex * 0.14,
                    marginRight: GAP,
                  }}
                />
              </div>
              {/*
                * Outside the bar, not on it. A full level's fill reaches the
                * right edge, so a label sitting there was dark text on a
                * saturated blue — unreadable at exactly the level that
                * matters most. Its own column also keeps the counts aligned
                * down the stack.
                */}
              <span className="w-[74px] shrink-0 text-right font-mono text-mini tabular-nums text-ink-secondary">
                {filled} / {perLevel}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-mini leading-relaxed text-ink-secondary">
        <span className="font-semibold tabular-nums text-ink">{required}</span> spaces required;{' '}
        <span className="font-semibold tabular-nums text-ink">{levels}</span> level
        {levels === 1 ? '' : 's'} at {perLevel} each holds{' '}
        <span className="tabular-nums">{capacity}</span>.{' '}
        {tight ? (
          <span className="font-medium text-ink">
            The last level is {lastLevelPct}% full — {spare} space{spare === 1 ? '' : 's'} of slack. A slightly larger
            scheme digs another level.
          </span>
        ) : (
          <>
            The last level is {lastLevelPct}% full, leaving {spare} space{spare === 1 ? '' : 's'} of slack.
          </>
        )}
      </p>
      <p className="m-0 mt-1 text-mini text-ink-muted">
        Capacity assumes {formatArea(y.footprintSqm)} of basement plate per level at the norm&rsquo;s area per space.
        A real basement loses ramps, cores and services off that, so treat this as the optimistic count.
      </p>
    </div>
  );
}
