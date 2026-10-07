import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { FileText, Flag, Unlink, Waypoints } from 'lucide-react';
import type { EvidenceItem, MemTagWords } from '@realytica/shared';
import { parseAnswer } from './answer-blocks';
import type { Block, Inline, TagPlaces } from './answer-blocks';
import { MeetingNotesLink } from '../meetings/MeetingNotes';
import { cn } from '../ui/kit';

/**
 * An answer, rendered as the thing it is rather than as one paragraph.
 *
 * Two changes matter more than the formatting. First, a citation is rendered
 * WHERE IT WAS MADE — mid-sentence, attached to the claim it supports —
 * instead of being stripped out and re-listed as "3 sources" at the bottom of
 * the bubble. A reader checking one number should not have to work out which
 * of three sources was the one behind it; that mapping is exactly what the
 * model already expressed and what the old rendering discarded.
 *
 * Second, a node chip shows the node's LABEL. The ids are real and useful to
 * click, and `dd-risk-a1b2c3d4` tells a valuer nothing about what they are
 * about to open.
 */
export function AnswerBody({
  text,
  evidence,
  nodes,
  rests,
  onOpenEvidence,
  onOpenNode,
}: {
  text: string;
  evidence: EvidenceItem[];
  /** Graph or register labels, for resolving a bracketed id to a real title. */
  nodes?: Array<{ id: string; label: string }>;
  /** The facts of memory the turn rests on, with where its text prints each one's tag. A tag is drawn at those places and nowhere else. */
  rests?: TagPlaces;
  /** Open a cited paper, at the page the citation names when it names one. */
  onOpenEvidence?: (id: string, page?: number) => void;
  onOpenNode?: (nodeId: string) => void;
}) {
  const nodeById = useMemo(() => new Map((nodes ?? []).map(n => [n.id, n])), [nodes]);
  const evidenceById = useMemo(() => new Map(evidence.map(e => [e.id, e])), [evidence]);
  const blocks = useMemo(
    () => parseAnswer(text, id => nodeById.has(id), rests),
    [text, nodeById, rests],
  );

  // A chip. `gap` is the space kept on each side of it, which is none on a side where punctuation is written against it.
  const chipOf = (span: Exclude<Inline, { kind: 'text' | 'bold' | 'code' }>, key: string, gap: string): ReactNode => {
    if (span.kind === 'evidence') {
      const item = evidenceById.get(span.id);
      return (
        <button
          key={key}
          type="button"
          onClick={() => onOpenEvidence?.(span.id, span.page)}
          // An id the ledger does not have is a citation the reader cannot
          // check. It stays visible and inert rather than being hidden —
          // silently dropping it would leave a claim looking sourced.
          disabled={!item || !onOpenEvidence}
          title={item ? `${item.statement}${span.page ? `, page ${span.page}` : ''}` : 'This citation is not on this project.'}
          className={cn(
            gap,
            'inline-flex max-w-[14rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] ring-1 ring-inset',
            item
              ? 'bg-brand-soft text-brand ring-brand/25 hover:bg-brand hover:text-[var(--brand-ink)]'
              : 'bg-sunken text-ink-muted ring-[var(--ring)]',
          )}
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate">{item ? sourceName(item) : 'unknown source'}</span>
          {/* The page is never the part that is cut: a long name gives way to it. */}
          {item && span.page ? <span className="tabular shrink-0">p.{span.page}</span> : null}
        </button>
      );
    }
    if (span.kind === 'memory') {
      // Where the fact behind the sentence stood when it was written: a person's word, a reading nobody has decided, or the assistant's own note.
      return (
        <span
          key={key}
          title={MEMORY_TAG_SAYS[span.tag]}
          className={cn(
            gap,
            'inline-flex translate-y-[1px] items-center rounded px-1 py-px align-baseline text-[0.85em] ring-1 ring-inset',
            span.tag === 'approved'
              ? 'bg-good/15 text-[var(--status-good-text)] ring-good/35'
              : span.tag === 'thought'
                ? 'bg-sunken text-ink-muted ring-[var(--ring)]'
                : 'bg-provenance/10 text-provenance-ink ring-provenance/40',
          )}
        >
          {span.tag}
        </span>
      );
    }
    if (span.kind === 'notes') return <MeetingNotesLink key={key} meetingId={span.meetingId} itemId={span.itemId} className={gap} />;
    if (span.kind === 'dangling') {
      return (
        <span
          key={key}
          // Only an id of a kind the chat can open is marked, so this is true of every one that is.
          title={`This answer gave the id ${span.id}. Nothing on this project has it.`}
          className={cn(
            gap,
            'inline-flex max-w-[12rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] text-ink-muted line-through decoration-ink-muted ring-1 ring-inset ring-[var(--ring)]',
          )}
        >
          <Unlink size={10} className="shrink-0 no-underline" />
          <span className="truncate">broken reference</span>
        </span>
      );
    }
    const node = nodeById.get(span.id);
    return (
      <button
        key={key}
        type="button"
        onClick={() => onOpenNode?.(span.id)}
        disabled={!onOpenNode}
        title={node ? `Open “${node.label}”` : span.id}
        className={cn(
          gap,
          'inline-flex max-w-[16rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink',
        )}
      >
        <Waypoints size={10} className="shrink-0" />
        <span className="truncate">{node?.label ?? span.id}</span>
      </button>
    );
  };

  const renderInline = (spans: Inline[], keyPrefix: string): ReactNode[] => {
    const { words, lead, tail } = besideChips(spans);
    return spans.map((span, i) => {
      const key = `${keyPrefix}-${i}`;
      if (span.kind === 'text') return words[i] ? <span key={key}>{words[i]}</span> : null;
      if (span.kind === 'bold') return <strong key={key} className="font-semibold text-ink">{span.text}</strong>;
      if (span.kind === 'code') {
        return (
          <code key={key} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.92em] text-ink-secondary">
            {span.text}
          </code>
        );
      }
      const chip = chipOf(span, key, cn(lead[i] ? 'ml-0' : 'ml-0.5', tail[i] ? 'mr-0' : 'mr-0.5'));
      if (!lead[i] && !tail[i]) return chip;
      return (
        /*
         * A line may break on either side of a chip, whatever is written
         * against it. So a full stop after one stood apart from it by the
         * chip's gap, and went to the next line alone when the chip ended
         * its line. The chip and its punctuation are one piece here, no wider
         * than the line: a long name is cut to leave the punctuation room.
         */
        <span key={key} className="inline-flex max-w-full items-baseline whitespace-nowrap align-baseline">
          {lead[i]}
          {chip}
          {tail[i]}
        </span>
      );
    });
  };

  return (
    // A word longer than the column is broken, not left to push the thread sideways: a reference number, a file name, a link.
    <div className="flex flex-col gap-2 break-words text-[13px] leading-relaxed text-ink">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} render={spans => renderInline(spans, String(i))} />
      ))}
    </div>
  );
}

/** Closing punctuation written against the end of a chip, with a space or nothing after it. A possessive counts: "[the deed]'s". */
const AFTER_CHIP = /^(?:[’']s)?[.,;:!?)\]”’"']*(?=\s|$)/;
/** An opening bracket or quotation mark written against the start of a chip, with a space or nothing before it. */
const BEFORE_CHIP = /(^|\s)([([“‘]+)$/;

/**
 * The punctuation each chip keeps beside it, by the chip's place, and the
 * words of each run of text once that is taken from it.
 */
function besideChips(spans: Inline[]): { words: string[]; lead: string[]; tail: string[] } {
  const words = spans.map((span) => (span.kind === 'text' ? span.text : ''));
  const lead: string[] = [];
  const tail: string[] = [];
  spans.forEach((span, i) => {
    if (span.kind === 'text' || span.kind === 'bold' || span.kind === 'code') return;
    const after = spans[i + 1]?.kind === 'text' ? AFTER_CHIP.exec(words[i + 1]) : null;
    if (after?.[0]) {
      tail[i] = after[0];
      words[i + 1] = words[i + 1].slice(after[0].length);
    }
    const before = spans[i - 1]?.kind === 'text' ? BEFORE_CHIP.exec(words[i - 1]) : null;
    if (before) {
      lead[i] = before[2];
      words[i - 1] = words[i - 1].slice(0, words[i - 1].length - before[2].length);
    }
  });
  return { words, lead, tail };
}

/** What each tag means, said on hover. */
const MEMORY_TAG_SAYS: Record<MemTagWords, string> = {
  approved: 'A person typed or accepted this.',
  'waiting · stands': 'Read off a paper and not yet accepted. The file lets it be acted on meanwhile.',
  waiting: 'Read off a paper or raised on a card. Nobody has accepted it yet.',
  thought: 'The assistant’s own earlier note, not a fact of the file.',
};

function BlockView({ block, render }: { block: Block; render: (spans: Inline[]) => ReactNode[] }) {
  if (block.kind === 'heading') {
    return <p className="text-[12px] font-semibold text-ink-muted">{render(block.spans)}</p>;
  }
  if (block.kind === 'bullets') return <Bullets items={block.items} render={render} />;
  if (block.kind === 'numbers') {
    const first = block.start ?? 1;
    return (
      <ol start={first} className="flex flex-col gap-1">
        {block.items.map((item, i) => {
          const under = block.details?.[i] ?? [];
          return (
            <li key={i} className="flex gap-2">
              <span className="tabular mt-px shrink-0 text-mini font-semibold text-ink-muted">{first + i}.</span>
              <div className="min-w-0">
                {render(item)}
                {under.length > 0 ? <Bullets items={under} render={render} className="mt-1" /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }
  if (block.kind === 'flag') {
    return (
      // The colour of a warning, as the note under an answer with an unsupported figure wears.
      <p className="flex gap-2 rounded-lg bg-warning/15 px-2.5 py-1.5 leading-snug ring-1 ring-inset ring-warning/45">
        <Flag size={13} aria-hidden className="mt-[3px] shrink-0 text-warning" />
        <span className="min-w-0">
          <span className="sr-only">Flag: </span>
          {render(block.spans)}
        </span>
      </p>
    );
  }
  if (block.kind === 'rule') {
    return <hr className="my-1 border-0 border-t border-hairline" />;
  }
  if (block.kind === 'table') {
    return (
      // A table in a chat column is the one thing here guaranteed to be wider
      // than its container, so it scrolls inside itself rather than pushing
      // the conversation sideways.
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-hairline">
              {block.head.map((cell, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-semibold text-ink-secondary">
                  {render(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-b border-hairline/60 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1 align-top text-ink">
                    {render(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <p>{render(block.spans)}</p>;
}

/** A dashed list: a block of its own, or the details under one item of a numbered list. */
function Bullets({ items, render, className }: { items: Inline[][]; render: (spans: Inline[]) => ReactNode[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
          <span className="min-w-0">{render(item)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A short, human name for an evidence item — what it came from, not its id. */
function sourceName(item: EvidenceItem): string {
  const label = item.sourceLabel?.trim();
  if (label) return label;
  return item.sourceType.replace(/_/g, ' ');
}
