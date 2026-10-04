import { Check, X } from 'lucide-react';
import { cn } from '../../components/ui/kit';
import { expectation, flagsOf, fnId, insightsOf, type CheckMark } from './engine';
import { Blank, Group, RowText } from './parts';
import { useExample } from './state';
import type { Department, FunctionSpec } from './types';
import { FlagRow } from './blocks/FlagRow';
import { InsightRow } from './blocks/InsightRow';

type Result = Exclude<CheckMark, ''>;

const RESULTS: { mark: Result; name: string }[] = [
  { mark: 'yes', name: 'Met' },
  { mark: 'no', name: 'Not met' },
  { mark: 'na', name: 'Not applicable' },
];

const CHOSEN: Record<Result, string> = {
  yes: 'bg-good text-white',
  no: 'bg-critical text-white',
  na: 'bg-ink-muted text-ink-inverse',
};

/** One line of the checklist: met, not met or not applicable, and unmarked until a person says. Pressing the mark that is on takes it off. */
function Expectation({ id, text }: { id: string; text: string }) {
  const { state, dispatch } = useExample();
  const now = expectation(id, state);
  return (
    <li className="flex items-center gap-3 border-t border-hairline px-3.5 py-[9px] text-[13px] text-ink">
      <RowText>{text}</RowText>
      <span role="group" aria-label="Result" className="inline-flex shrink-0 overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-[var(--ring)]">
        {RESULTS.map(({ mark, name }, i) => {
          const on = now === mark;
          return (
            <button
              key={mark}
              type="button"
              aria-pressed={on}
              aria-label={name}
              title={name}
              onClick={() => dispatch({ type: 'check', id, mark: on ? '' : mark })}
              className={cn(
                'grid h-[26px] min-w-[30px] place-items-center px-1.5 font-mono text-[11px] font-medium transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px] coarse:h-11 coarse:min-w-11',
                i > 0 && 'border-l border-hairline',
                on ? CHOSEN[mark] : 'text-ink-muted hover:bg-page hover:text-ink',
              )}
            >
              {mark === 'yes' ? <Check size={12} strokeWidth={2.5} aria-hidden /> : mark === 'no' ? <X size={12} strokeWidth={2.5} aria-hidden /> : 'N/A'}
            </button>
          );
        })}
      </span>
    </li>
  );
}

/** Where a link leads, as the name of its site: the reader sees whose page it is before following it. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The last section of every function's page: what a proper project expects
 * of the function, its flags, what the copilot notices, and the law and
 * standards all of it rests on.
 *
 * The checklist starts with nothing marked: what is met is for a person to
 * say. A standard is named in words, with why it matters here; its link says
 * which site it opens, because not every one leads to the law itself.
 */
export function ChecksAndFlags({ dept, fn }: { dept: Department; fn: FunctionSpec }) {
  const { state } = useExample();
  const fid = fnId(dept, fn);
  const expected = fn.mustHave.map((text, i) => ({ id: `${fid}/exp/${i}`, text }));
  const answered = expected.filter((x) => expectation(x.id, state) !== '').length;
  const flags = flagsOf(dept, fn, state);
  const insights = insightsOf(dept, fn, state);

  return (
    <>
      {expected.length ? (
        <Group title="A proper project expects" note={`${answered} of ${expected.length} answered`}>
          <ul>
            {expected.map((x) => (
              <Expectation key={x.id} id={x.id} text={x.text} />
            ))}
          </ul>
        </Group>
      ) : null}
      <Group title="Flags" note={flags.length ? `${flags.length} open` : undefined}>
        {flags.length ? (
          <ul>
            {flags.map((flag) => (
              <FlagRow key={flag.id} flag={flag} />
            ))}
          </ul>
        ) : (
          <Blank>No flags.</Blank>
        )}
      </Group>
      <Group title="AI insights">
        {insights.length ? (
          <ul>
            {insights.map((insight) => (
              <InsightRow key={insight.id} insight={insight} />
            ))}
          </ul>
        ) : (
          <Blank>Nothing to point out.</Blank>
        )}
      </Group>
      {fn.standards.length ? (
        <Group title="Rests on">
          <ul className="grid gap-2.5 border-t border-hairline px-3.5 pb-3 pt-2.5 text-[13px] text-ink">
            {fn.standards.map((standard) => {
              const site = siteOf(standard.url);
              return (
                <li key={standard.name} className="grid gap-0.5">
                  {standard.name}
                  {standard.why ? <span className="text-[12px] text-ink-muted">{standard.why}</span> : null}
                  {site ? (
                    <a href={standard.url} target="_blank" rel="noreferrer" className="justify-self-start text-[12px] text-brand-strong underline decoration-1 underline-offset-2 hover:text-brand">
                      Read at {site}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
    </>
  );
}
