import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ChatProposal } from '@realytica/shared';
import { Badge, Button, cn } from '../../../components/ui/kit';

/**
 * One card, closed.
 *
 * A card used to print four things at once: its title, its full rationale, a
 * boilerplate sentence about what approving would do, and its status. Six
 * uploaded files therefore produced roughly thirty lines of chat, most of it
 * identical between cards — the "creates evidence, links to matching scopes"
 * line was word-for-word the same on every one.
 *
 * So the closed card is the title and the buttons, which is everything needed
 * to decide on something you just uploaded yourself. The reasoning is one
 * click away and stays out of the way of the next card. Nothing is hidden that
 * was not already there; it is the same text behind a disclosure.
 */
export function ProposalCard({
  item,
  busy,
  onApprove,
  onSkip,
}: {
  item: ChatProposal;
  busy: boolean;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = item.status === 'proposed';
  const url = typeof item.payload.url === 'string' ? item.payload.url : '';
  /*
   * A file whose text never loaded is not a classification, and must not look
   * like one. The proposal is still approvable — the PDF is real and belongs
   * on the register — but the row says so before anybody accepts it.
   */
  const unread = typeof item.payload.readFailure === 'string' && item.payload.readFailure.length > 0;
  return (
    <div className="rounded-lg bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left text-[12.5px] font-medium text-ink hover:text-brand"
        >
          <ChevronRight
            size={12}
            className={cn('mr-1 inline-block shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <span className="break-words">{item.title}</span>
        </button>
        {unread ? (
          <Badge tone="warning" className="shrink-0">
            Unread
          </Badge>
        ) : null}
        {pending ? null : (
          <span className="shrink-0 pt-0.5 text-[11px] font-medium text-ink-muted">
            {item.status === 'committed' ? 'Filed' : item.status}
          </span>
        )}
      </div>
      {open ? (
        <div className="mt-1.5 border-t border-[var(--ring)] pt-1.5">
          <p className="text-[11.5px] leading-relaxed text-ink-secondary">{item.rationale}</p>
          <p className="mt-1 text-[11px] text-ink-muted">{item.impact}</p>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[11.5px] text-brand underline-offset-2 hover:underline"
            >
              Open portal
            </a>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onApprove(item.id)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSkip(item.id)}>
            Skip
          </Button>
        </div>
      ) : null}
    </div>
  );
}
