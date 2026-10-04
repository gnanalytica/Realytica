import { cn } from '../../components/ui/kit';
import { changed, fieldState, type FieldRef, type Marks } from './engine';
import { useSeek } from './seek';
import { PROJECT_NAME } from './spec';

/** One value read from the page, and what a person has done with it since. */
export interface SheetLine {
  id: string;
  label: string;
  /** The page's own words, whatever stands on the record now. */
  value: string;
  state: 'wait' | 'ok' | 'changed' | 'no';
}

/** A value as it is drawn on the page it was read from. The page always says what the file says. */
export function sheetLine(x: FieldRef, m: Marks): SheetLine {
  const now = fieldState(x, m);
  return { id: x.id, label: x.item.l, value: x.item.v, state: now === 'no' ? 'no' : changed(x, m) ? 'changed' : now === 'sug' ? 'wait' : 'ok' };
}

/*
 * The page is paper, so its colours are fixed: white with its own ink in
 * either theme. Only the marks laid over the words take the app's colours.
 */
const INK = 'text-[#1F2226]';
const FAINT = 'text-[#69707A]';
const RULE = 'border-[#E2E5EA]';

/* A mark says where its value stands three ways: by its outline, by its colour, and in words on hover. */
const MARKED: Record<SheetLine['state'], { look: string; ring: string; says: string }> = {
  wait: { look: 'border-dashed border-ai bg-ai/15', ring: 'ring-ai', says: 'Read by the copilot. Waiting for a person to accept it' },
  ok: { look: 'border-solid border-good bg-good/15', ring: 'ring-good', says: 'Accepted by a person' },
  changed: { look: 'border-dotted border-warning bg-warning/15', ring: 'ring-warning', says: 'What the page says. A person has typed another value' },
  no: { look: `border-transparent line-through ${FAINT}`, ring: 'ring-[#69707A]', says: 'Left out by a person' },
};

/** The words a value was read from, marked on the page. Pressing them picks the value. */
function Mark({ line, visit, onPick }: { line: SheetLine; visit: number; onPick: (id: string) => void }) {
  const mark = useSeek<HTMLButtonElement>(visit, false);
  const { look, ring, says } = MARKED[line.state];
  return (
    <button
      ref={mark}
      type="button"
      title={says}
      aria-pressed={visit > 0}
      onClick={() => onPick(line.id)}
      className={cn('rounded-[3px] border px-1 py-px text-left font-mono text-[12px]', look, visit > 0 && 'ring-2', visit > 0 && ring)}
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
  visit = 0,
  large = false,
  onPick,
}: {
  title: string;
  page: number;
  lines: SheetLine[];
  /** The value whose proof this is, and the number of this showing of it. */
  current?: string;
  visit?: number;
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
              <Mark line={line} visit={line.id === current ? visit || 1 : 0} onPick={onPick} />
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
