import { useMemo } from 'react';
import { SEVERITY_LABEL, daySaid, type ChatProposal, type ChatProposalKind, type DdProject } from '@realytica/shared';
import { AiMark, Card, CardBody, RegisterRow } from '../../components/ui/kit';
import { DecideButtons } from '../../components/review/Decide';
import { person } from '../../lib/format';
import { LiveRow } from './LiveRow';

/** Where a suggested row came from: the person's words in the chat, the papers it rests on, or the day it was raised. */
export function rowSource(project: DdProject, card: ChatProposal): string {
  if (card.said) return `said in chat by ${person(card.said.by)}, ${daySaid(card.said.at)}`;
  const papers = (card.citedEvidenceIds ?? []).flatMap((id) => project.evidence.find((row) => row.id === id)?.title ?? []);
  if (papers.length) return `from ${papers.join(', ')}`;
  return `${card.chat ? 'suggested in the chat' : 'suggested'}, ${daySaid(card.createdAt)}`;
}

/**
 * The rows a register would gain, at the top of it, marked suggested: a
 * finding, an action, a risk or a decision the chat, a paper's reading or a
 * meeting's notes proposed. Each is accepted onto the register or set aside
 * on its own row. Nothing of them is on the register until it is accepted.
 * A change the chat suggested to a row already there (graded again, closed,
 * mitigated) waits here too, named by the row it changes.
 */
export function SuggestedRows({
  project,
  kinds,
  changes,
  liveIds,
  busy,
  onAccept,
  onSetAside,
}: {
  project: DdProject;
  kinds: readonly ChatProposalKind[];
  /** The register whose rows' suggested changes wait here too. */
  changes?: 'finding' | 'action' | 'risk';
  /** The rows a link or a chip lit: a suggestion among them is lit here. */
  liveIds?: string[];
  busy?: boolean;
  onAccept?: (id: string) => void;
  onSetAside?: (id: string) => void;
}) {
  const cards = useMemo(
    () => (project.chatProposals ?? []).filter((card) => card.status === 'proposed' && (kinds.includes(card.kind) || (changes !== undefined && card.kind === 'patch_record' && card.payload.register === changes))),
    [project.chatProposals, kinds, changes],
  );
  if (!cards.length) return null;
  return (
    <Card className="ring-ai/25">
      <CardBody className="divide-y divide-hairline p-0">
        {cards.map((card) => {
          const severity = card.kind !== 'patch_record' && typeof card.payload.severity === 'string' ? SEVERITY_LABEL[card.payload.severity as keyof typeof SEVERITY_LABEL] : undefined;
          return (
            <LiveRow key={card.id} id={card.id} highlightIds={liveIds} variant="flush">
              <RegisterRow
                title={card.title}
                meta={
                  <>
                    <span className="inline-flex items-center gap-1 font-medium text-ai-ink">
                      <AiMark size="xs" />
                      {card.kind === 'patch_record' ? 'Suggested change' : 'Suggested'}
                    </span>
                    {severity ? <span>{severity}</span> : null}
                    <span>{rowSource(project, card)}</span>
                  </>
                }
                trailing={onAccept && onSetAside ? <DecideButtons label={card.title} busy={busy} size="sm" onAccept={() => onAccept(card.id)} onSetAside={() => onSetAside(card.id)} /> : undefined}
              />
              {card.said?.quote ? <p className="px-4 pb-3 text-[12px] text-ink-muted">“{card.said.quote}”</p> : null}
            </LiveRow>
          );
        })}
      </CardBody>
    </Card>
  );
}
