import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ChevronRight, Upload } from 'lucide-react';
import { Card, cn, useToast } from '../../components/ui/kit';
import type { SlotLine } from './types';
import { useExample } from './state';

/**
 * The small pieces every page of the example is put together from: the card
 * a block sits in, a row of a list, the chips that say where a value came
 * from, and the strip files are dropped on.
 */

/** Small capitals over a list or a value: the label of a group of lines, never a sentence. */
export const CAPS = 'font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted';

/** A titled card: the heading, one quiet note on its right, then whatever it holds. */
export function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3.5 py-[11px]">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {note ? <span className="ml-auto font-mono text-[12px] text-ink-muted">{note}</span> : null}
      </header>
      {children}
    </Card>
  );
}

/** The label of a run of rows inside a card. */
export function GroupHead({ children }: { children: ReactNode }) {
  return <p className={cn(CAPS, 'border-t border-hairline px-3.5 pb-1 pt-[9px]')}>{children}</p>;
}

/** For a list under a `GroupHead`: the label is ruled off already, so the first row is not. */
export const FLUSH = '[&>li:first-child]:border-t-0';

/** What a card says when it has nothing in it. */
export function Blank({ children }: { children: ReactNode }) {
  return <p className="border-t border-hairline px-3.5 py-3 text-[13px] text-ink-muted">{children}</p>;
}

/** The foot of a card: the few things that can be done to what is above it. */
export function GroupFoot({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-hairline px-3.5 py-[9px]">{children}</div>;
}

const ROW = 'flex w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-[9px] text-left text-[13px] text-ink';

/** A row that is only read: the same measure as one that opens something, ruled off from the row above. */
export const LINE = 'flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-hairline px-3.5 py-[9px] text-[13px] text-ink';

/** A figure in a column of figures: set right, in the fixed-width face, so the digits line up. */
export const FIGURE = 'whitespace-nowrap text-right font-mono text-[12px] tabular-nums';

/** The rail down the left of a row: what is picked, or how serious a flag is. */
const RAIL = {
  picked: 'shadow-[inset_2px_0_0_rgb(var(--brand-rgb))]',
  high: 'shadow-[inset_3px_0_0_rgb(var(--status-critical-rgb))]',
  medium: 'shadow-[inset_3px_0_0_rgb(var(--status-warning-rgb))]',
};

/**
 * A row that opens something: the whole line is the button, and a chevron
 * says so. `alert` gives a flag its rail, which it keeps while it is picked.
 */
export function RowButton({
  picked = false,
  alert,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { picked?: boolean; alert?: 'high' | 'medium' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'group/row',
        ROW,
        'transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px]',
        alert ? RAIL[alert] : picked && RAIL.picked,
        picked ? 'bg-brand-soft' : alert === 'high' ? 'bg-critical/5 hover:bg-critical/10' : 'hover:bg-page',
        className,
      )}
    >
      {children}
      <ChevronRight
        size={14}
        aria-hidden
        className={cn('shrink-0 transition-transform duration-quick ease-state group-hover/row:translate-x-[3px] motion-reduce:transition-none', picked ? 'text-brand' : 'text-ink-muted')}
      />
    </button>
  );
}

/** The words of a row: one line, and a quieter one under it. */
export function RowText({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="min-w-0 flex-[1_1_170px] [overflow-wrap:anywhere]">
      {children}
      {sub ? <span className="block text-[12px] text-ink-muted">{sub}</span> : null}
    </span>
  );
}

/**
 * A long list shows its first rows and the rest on asking. Once opened it
 * stays open, wherever the person goes in between. `flush` is for a list
 * under a label, whose first row needs no rule of its own.
 */
export function Capped<T>({
  id,
  items,
  cap = 4,
  flush = false,
  children,
}: {
  id: string;
  items: T[];
  cap?: number;
  flush?: boolean;
  children: (item: T, index: number) => ReactNode;
}) {
  const { state, dispatch } = useExample();
  const all = Boolean(state.opened[id]) || items.length <= cap;
  return (
    <>
      <ul className={flush ? FLUSH : undefined}>{(all ? items : items.slice(0, cap)).map(children)}</ul>
      {all ? null : <ShowAll count={items.length} onClick={() => dispatch({ type: 'mark', what: 'opened', ids: [id] })} />}
    </>
  );
}

export function ShowAll({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border-t border-hairline px-3.5 py-[9px] text-left text-[13px] text-brand transition-colors duration-quick ease-state hover:bg-page focus-visible:outline-offset-[-2px]"
    >
      Show all {count}
    </button>
  );
}

/** Something the copilot suggested that waits for a person. The kit's badge has no tone for it. `wrap` lets a long one break in a narrow pane. */
export function AiChip({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-ai/10 px-1.5 py-0.5 text-mini font-medium leading-4 text-ai-ink ring-1 ring-inset ring-ai/25', !wrap && 'whitespace-nowrap')}>
      {children}
    </span>
  );
}

const SOURCE = 'inline-flex min-h-6 items-center gap-[5px] rounded-full border py-0.5 pl-[7px] pr-[9px] text-[12px] [&_svg]:size-3 [&_svg]:shrink-0';

/**
 * Where a value came from. With `onClick` it opens the proof, and it is
 * filled while that proof is the one on show; `assumed` is a value nothing on
 * file supports yet.
 */
export function SourceChip({
  children,
  icon,
  on = false,
  assumed = false,
  title,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  on?: boolean;
  assumed?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <span className={cn(SOURCE, assumed ? 'border-dashed border-warning/50 text-[var(--status-warning-text)]' : 'border-hairline bg-surface text-ink-secondary')}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        SOURCE,
        'transition-colors duration-quick ease-state',
        on ? 'border-brand bg-brand text-brand-ink' : 'border-hairline bg-surface text-ink-secondary hover:border-brand hover:bg-brand-soft hover:text-brand-strong',
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

/** A percentage as a bar. `fill` is the colour of the part that is done. */
export function Bar({ value, fill = 'bg-brand', className }: { value: number; fill?: string; className?: string }) {
  return (
    <span aria-hidden className={cn('block h-1.5 min-w-10 overflow-hidden rounded-full bg-sunken', className)}>
      <span className={cn('block h-full rounded-full', fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/** One entry of a legend: a swatch and what it stands for. */
export function LegendKey({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
      <span aria-hidden className={cn('size-3 shrink-0 rounded-[3px]', swatch)} />
      {children}
    </span>
  );
}

/** A paper's state as a dot: in hand, asked for, or neither. */
export function StateDot({ state }: { state: SlotLine['state'] }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full align-middle', state === 'in' ? 'bg-good' : state === 'asked' ? 'bg-warning' : 'ring-[1.5px] ring-inset ring-[var(--axis)]')}
    />
  );
}

/** Where files are dropped. In the example it only says what it would do. */
export function DropStrip({ what, says }: { what: string; says: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast(says)}
      className="group/drop m-3.5 flex w-[calc(100%-1.75rem)] items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-[var(--axis)] px-3 py-[11px] text-[13px] text-ink-secondary transition-colors duration-quick ease-state hover:border-brand hover:bg-brand-soft hover:text-brand-strong"
    >
      <Upload size={16} aria-hidden className="shrink-0" />
      <span>
        <b className="font-semibold text-ink group-hover/drop:text-brand-strong">{what}</b> · drop or choose
      </span>
    </button>
  );
}

/** The line at the foot of every page of the example. */
export function ExampleFoot() {
  return <p className="text-[12px] text-ink-muted">Example data.</p>;
}
