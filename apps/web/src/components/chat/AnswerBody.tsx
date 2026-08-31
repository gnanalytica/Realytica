import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { FileText, Unlink, Waypoints } from 'lucide-react';
import type { EvidenceItem } from '@realytica/shared';
import { parseAnswer } from './answer-blocks';
import type { Block, Inline } from './answer-blocks';
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
  onOpenEvidence,
  onOpenNode,
}: {
  text: string;
  evidence: EvidenceItem[];
  /** Graph or register labels, for resolving a bracketed id to a real title. */
  nodes?: Array<{ id: string; label: string }>;
  onOpenEvidence?: (id: string) => void;
  onOpenNode?: (nodeId: string) => void;
}) {
  const nodeById = useMemo(() => new Map((nodes ?? []).map(n => [n.id, n])), [nodes]);
  const evidenceById = useMemo(() => new Map(evidence.map(e => [e.id, e])), [evidence]);
  const blocks = useMemo(
    () => parseAnswer(text, id => nodeById.has(id)),
    [text, nodeById],
  );

  const renderInline = (spans: Inline[], keyPrefix: string): ReactNode[] =>
    spans.map((span, i) => {
      const key = `${keyPrefix}-${i}`;
      if (span.kind === 'text') return <span key={key}>{span.text}</span>;
      if (span.kind === 'bold') return <strong key={key} className="font-semibold text-ink">{span.text}</strong>;
      if (span.kind === 'code') {
        return (
          <code key={key} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.92em] text-ink-secondary">
            {span.text}
          </code>
        );
      }
      if (span.kind === 'evidence') {
        const item = evidenceById.get(span.id);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpenEvidence?.(span.id)}
            // An id the ledger does not have is a citation the reader cannot
            // check. It stays visible and inert rather than being hidden —
            // silently dropping it would leave a claim looking sourced.
            disabled={!item || !onOpenEvidence}
            title={item ? item.statement : 'This citation is not on the case ledger'}
            className={cn(
              'mx-0.5 inline-flex max-w-[14rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] ring-1 ring-inset',
              item
                ? 'bg-brand-soft text-brand ring-brand/25 hover:bg-brand hover:text-[var(--brand-ink)]'
                : 'bg-sunken text-ink-muted ring-[var(--ring)]',
            )}
          >
            <FileText size={10} className="shrink-0" />
            <span className="truncate">{item ? sourceName(item) : 'unknown source'}</span>
          </button>
        );
      }
      if (span.kind === 'dangling') {
        return (
          <span
            key={key}
            title={`This answer referenced ${span.id}, which is not on this case.`}
            className="mx-0.5 inline-flex max-w-[12rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] text-ink-muted line-through decoration-ink-faint ring-1 ring-inset ring-[var(--ring)]"
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
          className="mx-0.5 inline-flex max-w-[16rem] translate-y-[1px] items-center gap-1 rounded px-1 py-px align-baseline text-[0.85em] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink"
        >
          <Waypoints size={10} className="shrink-0" />
          <span className="truncate">{node?.label ?? span.id}</span>
        </button>
      );
    });

  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} render={spans => renderInline(spans, String(i))} />
      ))}
    </div>
  );
}

function BlockView({ block, render }: { block: Block; render: (spans: Inline[]) => ReactNode[] }) {
  if (block.kind === 'heading') {
    return <p className="text-mini font-semibold uppercase tracking-[0.06em] text-ink-muted">{render(block.spans)}</p>;
  }
  if (block.kind === 'bullets') {
    return (
      <ul className="flex flex-col gap-1">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
            <span className="min-w-0">{render(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'numbers') {
    return (
      <ol className="flex flex-col gap-1">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="tabular mt-px shrink-0 text-mini font-semibold text-ink-muted">{i + 1}.</span>
            <span className="min-w-0">{render(item)}</span>
          </li>
        ))}
      </ol>
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

/** A short, human name for an evidence item — what it came from, not its id. */
function sourceName(item: EvidenceItem): string {
  const label = item.sourceLabel?.trim();
  if (label) return label;
  return item.sourceType.replace(/_/g, ' ');
}
