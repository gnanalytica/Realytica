import { Badge, Button, cn, useToast } from '../../../components/ui/kit';
import { many } from '../engine';
import { AiChip, Group } from '../parts';
import type { TimelineBlock as Spec } from '../types';

type Entry = Spec['items'][number];

const NODE: Record<Entry['state'], string> = {
  in: 'bg-good ring-1 ring-[var(--axis)]',
  gap: 'bg-surface ring-2 ring-critical',
  sug: 'bg-ai ring-1 ring-[var(--axis)]',
};

/** A solid line joins two links of a chain. Where a link is missing it is drawn broken, in red. */
const JOIN = 'bg-[var(--axis)]';
const BREAK = 'bg-[repeating-linear-gradient(rgb(var(--status-critical-rgb))_0_4px,transparent_4px_8px)]';

/**
 * Things in date order, with the gaps shown: a chain of title, an approval
 * path. A link that is on file is green, one the copilot read waits to be
 * accepted, and one that is missing can be asked for.
 */
export function TimelineBlock({ block }: { block: Spec }) {
  const toast = useToast();
  const gaps = block.items.filter((item) => item.state === 'gap').length;
  return (
    <Group title={block.title ?? 'Chain'} note={gaps ? many(gaps, 'gap', 'gaps') : 'No gaps'}>
      <ol className="border-t border-hairline px-3.5 pb-3 pt-1.5">
        {block.items.map((item, i) => {
          const broken = item.state === 'gap' || block.items[i - 1]?.state === 'gap';
          return (
            <li
              key={i}
              className="relative grid grid-cols-[40px_18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 py-[9px] [@container(min-width:35rem)]:grid-cols-[46px_18px_minmax(0,1fr)_auto]"
            >
              {i > 0 ? <span aria-hidden className={cn('absolute left-[58px] top-[-50%] h-full w-0.5 [@container(min-width:35rem)]:left-[64px]', broken ? BREAK : JOIN)} /> : null}
              <span className="font-mono text-[12px] font-medium text-ink-secondary">{item.year}</span>
              <span aria-hidden className={cn('relative z-[1] size-3.5 justify-self-center rounded-full border-[3px] border-surface', NODE[item.state])} />
              <div className="min-w-0">
                <b className={cn('block text-[13px] font-semibold', item.state === 'gap' ? 'text-critical' : 'text-ink')}>{item.t}</b>
                {item.sub ? <span className="text-[12px] text-ink-muted">{item.sub}</span> : null}
              </div>
              <span className="col-start-3 justify-self-start [@container(min-width:35rem)]:col-start-auto">
                {item.state === 'gap' ? (
                  <Button size="sm" onClick={() => toast('Asked for it.')}>
                    Ask for it
                  </Button>
                ) : item.state === 'sug' ? (
                  <AiChip>To accept</AiChip>
                ) : (
                  <Badge tone="good">On file</Badge>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Group>
  );
}
