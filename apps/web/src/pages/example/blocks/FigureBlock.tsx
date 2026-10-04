import { Badge, Card, cn } from '../../../components/ui/kit';
import { AiChip, CAPS } from '../parts';
import type { FigureBlock as Spec } from '../types';

/** The parts of a whole, in the app's series colours, in the order they are listed. */
const SERIES = ['bg-series-1', 'bg-series-2', 'bg-series-3', 'bg-series-4'];

/** A chip that says how far to trust the figure: an estimate reads as the copilot's, a signed one as settled. */
function Standing({ word }: { word: string }) {
  if (/indicative|provisional|estimate|rough/i.test(word)) return <AiChip>{word}</AiChip>;
  return <Badge tone={/certified|recorded|signed/i.test(word) ? 'good' : 'neutral'}>{word}</Badge>;
}

/** One headline figure: its range, the few figures that stand beside it, and what it is made up of. */
export function FigureBlock({ block }: { block: Spec }) {
  return (
    <Card className="grid gap-3 px-4 pb-3.5 pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn(CAPS, 'basis-full')}>{block.label}</span>
        <b className="text-[26px] font-bold leading-[1.1] tracking-[-0.01em] text-ink [@container(min-width:35rem)]:text-[30px]">{block.value}</b>
        {block.range ? (
          <span className="font-mono text-[13px] text-ink-secondary">
            {block.range[0]} to {block.range[1]}
          </span>
        ) : null}
        {block.chips?.length ? (
          <span className="ml-auto inline-flex flex-wrap gap-1.5">
            {block.chips.map((word) => (
              <Standing key={word} word={word} />
            ))}
          </span>
        ) : null}
      </div>
      {block.stats?.length ? (
        <dl className="grid gap-2.5 border-t border-hairline pt-3 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
          {block.stats.map((stat) => (
            <div key={stat.l}>
              <dt className="text-[12px] text-ink-muted">{stat.l}</dt>
              <dd className="font-mono text-[15px] font-medium text-ink">
                {stat.v}
                {stat.n ? <span className="ml-1.5 font-sans text-[12px] font-normal text-ink-muted">{stat.n}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {block.share?.length ? (
        <>
          <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded">
            {block.share.map((part, i) => (
              <span key={part.l} className={SERIES[i % SERIES.length]} style={{ width: `${part.p}%` }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-ink-secondary">
            {block.share.map((part, i) => (
              <li key={part.l} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2.5 rounded-sm', SERIES[i % SERIES.length])} />
                {part.l} {part.p}%
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
