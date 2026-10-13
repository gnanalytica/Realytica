import { CHAT_STANDING_LABEL, type ChatAnswerCard, type ChatAnswerRow, type ChatStanding } from '@realytica/shared';
import { Link } from 'react-router-dom';
import { cn } from '../ui/kit';

/**
 * A chat answer as a card of fields.
 *
 * A model picked the rows; every word here is the record's or a template's.
 * Each row is a label, the value as the record holds it, where the value
 * stands, and its source, which opens the paper at its page. Below them is
 * what to look at where the record does not answer. A row a rule made from
 * a screen's own figures names the page that holds them, and opens it.
 */

const STANDING_TONE: Record<ChatStanding, string> = {
  empty: 'text-ink-muted',
  proposed: 'text-ai',
  accepted: 'text-good',
  typed: 'text-ink-secondary',
  disputed: 'text-critical',
  not_applicable: 'text-ink-muted',
  assumed: 'text-warning',
  worked_out: 'text-ink-secondary',
  on_record: 'text-ink-secondary',
  paper_words: 'text-ink-secondary',
  memory_approved: 'text-good',
  memory_proposed: 'text-ai',
  memory_note: 'text-ink-muted',
};

function Row({ row, onOpenEvidence }: { row: ChatAnswerRow; onOpenEvidence?: (id: string, page?: number) => void }) {
  const source = row.source;
  const where = source ? `${source.label}${source.page ? `, page ${source.page}` : ''}` : '';
  return (
    <li className="py-1.5 first:pt-0 last:pb-0">
      <p className="text-[11px] leading-4 text-ink-muted">{row.label}</p>
      <p className={cn('break-words text-[13px] leading-snug text-ink', row.kind === 'passage' && 'font-mono text-[12px]')}>{row.kind === 'passage' ? `“${row.value}”` : row.value}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-4">
        <span className={STANDING_TONE[row.standing]}>{CHAT_STANDING_LABEL[row.standing]}</span>
        {where ? (
          source?.evidenceId && onOpenEvidence ? (
            <button type="button" className="text-left text-brand hover:underline" onClick={() => onOpenEvidence(source.evidenceId!, source.page)}>
              {where}
            </button>
          ) : (
            <span className="text-ink-muted">{where}</span>
          )
        ) : row.open ? (
          <Link to={row.open.path} className="text-brand hover:underline">
            {row.open.label}
          </Link>
        ) : null}
      </p>
      {/* A figure worked out from the rule table says which rows it read, and which of them nobody has verified. */}
      {row.rules?.map((rule, at) => (
        <p key={at} className="text-[11px] leading-4 text-ink-muted">
          {rule.said}
          {rule.verified ? null : <span className="text-warning"> · not verified</span>}
        </p>
      ))}
      {/* And a figure that rests on a usual value says so, with what nobody entered. */}
      {row.assumes?.length ? <p className="text-[11px] leading-4 text-ink-muted">On an assumed value: nobody entered {row.assumes.join(', ')}.</p> : null}
    </li>
  );
}

export function AnswerCard({ card, text, onOpenEvidence }: { card: ChatAnswerCard; text: string; onOpenEvidence?: (id: string, page?: number) => void }) {
  // The lines the template said. A turn kept without them reads its first line, which is the template's.
  const lead = card.said?.lead ?? text.split('\n')[0] ?? '';
  // What was said before the card, where something was: that part of the file is not on this person's copy.
  const before = lead && text.includes(lead) ? text.slice(0, text.indexOf(lead)).trim() : '';
  return (
    <div className="space-y-1.5">
      {before ? <p className="text-[13px] leading-snug text-ink-secondary">{before}</p> : null}
      <p className="text-[13px] leading-snug text-ink">{lead}</p>
      {card.rows.length ? (
        <ul className="divide-y divide-hairline rounded-lg bg-sunken px-2.5 py-2">
          {card.rows.map((row, i) => (
            <Row key={i} row={row} onOpenEvidence={onOpenEvidence} />
          ))}
        </ul>
      ) : null}
      {card.said?.proposed ? <p className="text-[13px] leading-snug text-ink-secondary">{card.said.proposed}</p> : null}
      {card.look.length ? (
        <div>
          <p className="text-[13px] leading-snug text-ink-secondary">{card.said?.lookAt ?? ''}</p>
          <ul className="mt-0.5 space-y-0.5">
            {card.look.map((item, i) => (
              <li key={i} className="text-[13px] leading-snug text-ink">
                {item.evidenceId && onOpenEvidence ? (
                  <button type="button" className="text-left text-brand hover:underline" onClick={() => onOpenEvidence(item.evidenceId!)}>
                    {item.label}
                  </button>
                ) : item.open ? (
                  <Link to={item.open.path} className="text-brand hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
