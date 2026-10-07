import { Badge, Button, cn, useToast } from '../../../components/ui/kit';
import { many, type BlockAt } from '../engine';
import { AiChip, Group } from '../parts';
import { useExample } from '../state';
import type { TimelineBlock as Spec } from '../types';

/** An entry as it stands now: on file, missing, waiting for a person, accepted here, or left out. */
type Now = 'in' | 'gap' | 'sug' | 'accepted' | 'out';

const NODE: Record<Now, string> = {
  in: 'bg-good ring-1 ring-[var(--axis)]',
  accepted: 'bg-good ring-1 ring-[var(--axis)]',
  gap: 'bg-surface ring-2 ring-critical',
  sug: 'bg-ai ring-1 ring-[var(--axis)]',
  out: 'bg-surface ring-1 ring-[var(--axis)]',
};

/** A solid line joins two links of a chain. Where a link is missing it is drawn broken, in red. */
const JOIN = 'bg-[var(--axis)]';
const BREAK = 'bg-[repeating-linear-gradient(rgb(var(--status-critical-rgb))_0_4px,transparent_4px_8px)]';

/**
 * Things in date order, with the gaps shown: a chain of title, an approval
 * path. An entry that is on file is green. One the copilot read waits until
 * a person accepts it or says it is not right, and one that is missing can
 * be asked for.
 */
export function TimelineBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const gaps = block.items.filter((item) => item.state === 'gap').length;
  const items = block.items.map((item, i) => {
    const id = `${at.id}/${i}`;
    const now: Now = item.state !== 'sug' ? item.state : state.accepted[id] ? 'accepted' : state.rejected[id] ? 'out' : 'sug';
    return { ...item, id, now };
  });

  return (
    <Group title={block.title ?? 'Chain'} note={gaps ? many(gaps, 'gap', 'gaps') : 'No gaps'}>
      <ol className="border-t border-hairline px-3.5 pb-3 pt-1.5">
        {items.map((item, i) => {
          const broken = item.state === 'gap' || block.items[i - 1]?.state === 'gap';
          return (
            <li
              key={item.id}
              className="relative grid grid-cols-[40px_18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 py-[9px] [@container(min-width:35rem)]:grid-cols-[46px_18px_minmax(0,1fr)_auto]"
            >
              {i > 0 ? <span aria-hidden className={cn('absolute left-[58px] top-[-50%] h-full w-0.5 [@container(min-width:35rem)]:left-[64px]', broken ? BREAK : JOIN)} /> : null}
              <span className="font-mono text-[12px] font-medium text-ink-secondary">{item.year}</span>
              <span aria-hidden className={cn('relative z-[1] size-3.5 justify-self-center rounded-full border-[3px] border-surface', NODE[item.now])} />
              <div className="min-w-0">
                <b className={cn('block text-[13px] font-semibold', item.now === 'gap' ? 'text-critical' : item.now === 'out' ? 'text-ink-muted' : 'text-ink')}>{item.t}</b>
                {item.sub ? <span className="text-[12px] text-ink-muted">{item.sub}</span> : null}
              </div>
              <span className="col-start-3 flex flex-wrap items-center gap-1.5 justify-self-start [@container(min-width:35rem)]:col-start-auto [@container(min-width:35rem)]:justify-self-end">
                {item.now === 'gap' ? (
                  state.asked[item.id] ? (
                    <Badge tone="warning">Asked</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'mark', what: 'asked', ids: [item.id] });
                        toast('Asks for the paper.');
                      }}
                    >
                      Ask for it
                    </Button>
                  )
                ) : item.now === 'sug' ? (
                  <>
                    <AiChip>To accept</AiChip>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        dispatch({ type: 'mark', what: 'accepted', ids: [item.id] });
                        toast('Accepted.');
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'mark', what: 'rejected', ids: [item.id] });
                        toast('Left out.');
                      }}
                    >
                      Not right
                    </Button>
                  </>
                ) : item.now === 'out' ? (
                  <Badge>Left out</Badge>
                ) : (
                  <Badge tone="good">{item.now === 'accepted' ? 'Accepted' : 'On file'}</Badge>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Group>
  );
}
