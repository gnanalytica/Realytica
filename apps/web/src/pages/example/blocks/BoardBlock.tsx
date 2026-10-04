import { Badge } from '../../../components/ui/kit';
import { tone } from '../engine';
import { Bar, FIGURE, Group, GroupFoot, LegendKey } from '../parts';
import type { BoardBlock as Spec } from '../types';

const PLANNED = 'bg-[var(--axis)]';
const ACTUAL = 'bg-brand';

/**
 * Milestones, each with what was planned and what was done: two bars one
 * above the other, so a milestone that has fallen behind shows at a glance.
 */
export function BoardBlock({ block }: { block: Spec }) {
  const done = block.items.length ? Math.round(block.items.reduce((n, item) => n + item.actual, 0) / block.items.length) : 0;
  return (
    <Group title={block.title ?? 'Programme'} note={`${done}% complete`}>
      <ul>
        {block.items.map((item) => (
          <li
            key={item.t}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-t border-hairline px-3.5 py-2.5 text-[13px] text-ink [@container(min-width:35rem)]:grid-cols-[minmax(0,1.2fr)_minmax(80px,1fr)_44px_auto]"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {item.t}
              <span className="block text-[12px] text-ink-muted">Due {item.due}</span>
            </span>
            {/* On a narrow page the bars take a line of their own, under the words. */}
            <span
              role="img"
              aria-label={`Planned ${item.plan}%, actual ${item.actual}%`}
              className="order-last col-span-full grid gap-1 [@container(min-width:35rem)]:order-none [@container(min-width:35rem)]:col-span-1"
            >
              <Bar value={item.plan} fill={PLANNED} />
              <Bar value={item.actual} fill={item.state === 'Late' ? 'bg-critical' : ACTUAL} />
            </span>
            <span className={FIGURE}>{item.actual}%</span>
            <Badge tone={tone(item.state)}>{item.state}</Badge>
          </li>
        ))}
      </ul>
      <GroupFoot>
        <LegendKey swatch={PLANNED}>Planned</LegendKey>
        <LegendKey swatch={ACTUAL}>Actual</LegendKey>
      </GroupFoot>
    </Group>
  );
}
