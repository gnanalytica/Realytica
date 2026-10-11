/**
 * How many waiting places a turn shows before the rest fold behind
 * "+N more places". The chat points at where work waits; a wall of chips
 * under "from earlier" is not a way on.
 */
import type { TurnChip } from '@realytica/shared';

export const WAITING_CHIPS_SHOWN = 2;

/**
 * Waiting chips ranked by how many decisions wait (largest first), with
 * filed/graph chips always kept after them. When folded and there are more
 * waiting places than `WAITING_CHIPS_SHOWN`, only the top ones are in
 * `shown` and `hiddenWaiting` is the rest.
 */
export function visibleTurnChips(
  chips: readonly TurnChip[],
  expanded: boolean,
): { shown: TurnChip[]; hiddenWaiting: number } {
  const waiting = chips.filter((chip) => chip.kind === 'waiting');
  const other = chips.filter((chip) => chip.kind !== 'waiting');
  const ranked = [...waiting].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  if (expanded || ranked.length <= WAITING_CHIPS_SHOWN) {
    return { shown: [...ranked, ...other], hiddenWaiting: 0 };
  }

  return {
    shown: [...ranked.slice(0, WAITING_CHIPS_SHOWN), ...other],
    hiddenWaiting: ranked.length - WAITING_CHIPS_SHOWN,
  };
}
