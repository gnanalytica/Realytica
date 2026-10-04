import { cn } from '../../components/ui/kit';
import { useSeek } from './seek';
import { PROJECT_NAME } from './spec';

/** One value read from the page: accepted, said to be not right, or still waiting for a person. */
export interface SheetLine {
  id: string;
  label: string;
  value: string;
  state: 'ok' | 'no' | 'wait';
}

/*
 * The page is paper, so its colours are fixed: white with its own ink in
 * either theme. Only the marks laid over the words take the app's colours.
 */
const INK = 'text-[#1F2226]';
const FAINT = 'text-[#69707A]';
const RULE = 'border-[#E2E5EA]';

const MARKED: Record<SheetLine['state'], [plain: string, current: string]> = {
  wait: ['bg-ai/15 shadow-[inset_0_-2px_0_rgb(var(--ai-rgb))]', 'bg-ai/30 shadow-[inset_0_-2px_0_rgb(var(--ai-rgb))] ring-2 ring-ai'],
  ok: ['bg-good/15 shadow-[inset_0_-2px_0_rgb(var(--status-good-rgb))]', 'bg-good/15 shadow-[inset_0_-2px_0_rgb(var(--status-good-rgb))] ring-2 ring-good'],
  no: [`${FAINT} line-through`, `${FAINT} line-through ring-2 ring-[#69707A]`],
};

/** The words a value was read from, marked on the page. Pressing them picks the value. */
function Mark({ line, current, onPick }: { line: SheetLine; current: boolean; onPick: (id: string) => void }) {
  const mark = useSeek<HTMLButtonElement>(current, 'pane');
  return (
    <button
      ref={mark}
      type="button"
      aria-pressed={current}
      onClick={() => onPick(line.id)}
      className={cn('rounded-[3px] px-1 py-px text-left font-mono text-[12px]', MARKED[line.state][current ? 1 : 0])}
    >
      {line.value}
    </button>
  );
}

/**
 * A page of a document, with the words that were read from it marked.
 *
 * The proof pane shows it beside the value it proves, with that value's
 * words ringed. Opened over the workspace it is `large`, and a paper nothing
 * was read from shows as ruled lines.
 */
export function Sheet({
  title,
  page,
  lines,
  current,
  large = false,
  onPick,
}: {
  title: string;
  page: number;
  lines: SheetLine[];
  /** The value whose proof this is. */
  current?: string;
  large?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <article className={cn('mx-auto border bg-white px-7 pb-[34px] pt-[26px] font-display leading-[1.7] shadow-raised', INK, RULE, large ? 'min-h-[480px] max-w-[640px] text-[14px]' : 'max-w-[620px] text-[13px]')}>
      <div className={cn('mb-4 flex justify-between gap-3 border-b pb-2 font-mono text-[11px] uppercase tracking-[0.04em]', FAINT, RULE)}>
        <span>{PROJECT_NAME}</span>
        <span>Page {page}</span>
      </div>
      <h3 className="mb-1.5 text-[16px] font-semibold leading-[1.3]">{title}</h3>
      {lines.length ? (
        <ul className="mt-1.5 grid gap-[7px]">
          {lines.map((line) => (
            <li key={line.id} className="flex items-baseline gap-2">
              {line.label}
              <i aria-hidden className="min-w-3.5 flex-1 -translate-y-1 border-b border-dotted border-[#CDD2DA]" />
              <Mark line={line} current={line.id === current} onPick={onPick} />
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden className="mt-3 h-[300px] bg-[repeating-linear-gradient(transparent_0_14px,rgba(21,23,26,0.08)_14px_16px)]" />
      )}
      <p className={cn('mt-5 font-sans text-[11px]', FAINT)}>Example page.</p>
    </article>
  );
}
