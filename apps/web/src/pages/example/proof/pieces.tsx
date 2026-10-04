import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Badge, cn } from '../../../components/ui/kit';
import { connections, passedTo } from '../links';
import { AiChip, RowButton, RowText } from '../parts';
import { useOpen, usePlace } from '../place';
import { useExample, type ProofTab } from '../state';
import type { Department } from '../types';

/** The pieces the three kinds of proof share: the head, the tabs, and the cards a source is laid out in. */

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted';

/** What the proof is of, and the way to put it away. */
export function ProofHead({ kind, title }: { kind: string; title: string }) {
  const { dispatch } = useExample();
  return (
    <div className="flex items-start gap-2.5 px-4 pb-2.5 pt-3.5">
      <div className="min-w-0 flex-1">
        <span className={cn(LABEL, 'block')}>{kind}</span>
        <h2 className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{title}</h2>
      </div>
      <button
        type="button"
        aria-label="Close proof"
        onClick={() => dispatch({ type: 'close' })}
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-secondary transition-colors duration-quick ease-state hover:text-ink coarse:size-11"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

export function ProofTabs({ tabs }: { tabs: [ProofTab, string][] }) {
  const { state, dispatch } = useExample();
  return (
    <div role="tablist" aria-label="Proof" className="flex gap-0.5 border-b border-hairline px-4">
      {tabs.map(([tab, label]) => {
        const on = state.proofTab === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => dispatch({ type: 'tab', tab })}
            className={cn(
              '-mb-px min-h-9 border-b-2 px-2 py-2 text-[13px] transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px] coarse:min-h-11',
              on ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-secondary hover:text-ink',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The desk a source is laid on: a page, a photograph, and under it what was read. */
export function Desk({ children }: { children: ReactNode }) {
  return <div className="min-h-full bg-sunken p-4">{children}</div>;
}

export function Pad({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 px-4 py-3.5 text-[13px] text-ink">{children}</div>;
}

/** A small label over its value. */
export function Labelled({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className={LABEL}>{label}</span>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

/** What was read from a source, as a list of terms, under the source itself. */
export function ReadCard({ title, rows }: { title: string; rows: [term: string, value: ReactNode][] }) {
  return (
    <section className="mx-auto mt-3.5 grid max-w-[620px] gap-2.5 rounded-xl bg-surface px-3.5 py-3 ring-1 ring-[var(--ring)]">
      <h3 className={LABEL}>{title}</h3>
      <dl className="grid gap-x-3.5 gap-y-[7px] text-[13px] text-ink [grid-template-columns:max-content_minmax(0,1fr)]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-ink-muted">{term}</dt>
            <dd className="[overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Whether a read value is on the record yet. */
export function StandingChip({ standing }: { standing: 'waiting' | 'left out' | 'accepted' }) {
  if (standing === 'waiting') return <AiChip>A suggestion until a person accepts it</AiChip>;
  if (standing === 'left out') return <Badge>Left out by a person</Badge>;
  return <Badge tone="good">Accepted by S. Rao, 3 Oct</Badge>;
}

export interface Step {
  t: string;
  sub: string;
  /** Done, waiting for a person, or set aside. */
  kind?: 'done' | 'wait' | 'aside';
}

const DOT: Record<NonNullable<Step['kind']>, string> = {
  done: 'bg-brand',
  wait: 'bg-ai',
  aside: 'ring-[1.5px] ring-inset ring-[var(--text-muted)]',
};

/** Who touched it, in order. */
export function History({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3">
      {steps.map((step) => (
        <li key={step.t} className="grid grid-cols-[12px_minmax(0,1fr)] gap-2.5">
          <span aria-hidden className={cn('mt-[5px] size-[9px] rounded-full', DOT[step.kind ?? 'done'])} />
          <span>
            {step.t}
            <span className="block text-[12px] text-ink-muted">{step.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What this department passes on to the others, each row opening where it goes. */
export function PassesOn({ dept }: { dept: Department }) {
  const open = useOpen();
  const { stage } = usePlace();
  const { gives } = connections(dept, stage);
  if (!gives.length) return <p className="text-ink-muted">Not used elsewhere.</p>;
  return (
    <ul className="overflow-hidden rounded-[10px] ring-1 ring-[var(--ring)]">
      {gives.map((link, i) => (
        <li key={link.id} className={cn(i > 0 && 'border-t border-hairline')}>
          <RowButton onClick={() => open.to(link.user.dept, link.user.fn, { part: link.user.section.id })}>
            <RowText sub={passedTo(link)}>{link.what}</RowText>
          </RowButton>
        </li>
      ))}
    </ul>
  );
}

export function ProofFoot({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 border-t border-hairline px-4 py-3">{children}</div>;
}
