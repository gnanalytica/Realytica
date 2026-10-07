import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isReviewPaper, mayDraftOutgoing, type EvidenceRecord, type OutgoingAbout, type OutgoingKind } from '@realytica/shared';
import { outgoingAddress, outgoingApi } from '../../lib/outgoing-api';
import { useMe } from '../../lib/useMe';
import { Button, cn, useToast } from '../ui/kit';

/** What can be drafted from each thing: a paper is answered or written about, a meeting has minutes, an action is followed up. */
const KINDS: Record<OutgoingAbout['kind'], Array<{ kind: OutgoingKind; label: string }>> = {
  paper: [
    { kind: 'reply', label: 'A reply' },
    { kind: 'letter', label: 'A letter' },
    { kind: 'rfi', label: 'A request for information' },
  ],
  meeting: [{ kind: 'minutes', label: 'Draft the minutes' }],
  action: [
    { kind: 'letter', label: 'A letter' },
    { kind: 'rfi', label: 'A request for information' },
  ],
};

/** On a row of the documents register: drawn for a paper a draft can be about, and for nothing else on that register. */
export function OutgoingFromPaper({ projectId, row }: { projectId: string; row: EvidenceRecord }) {
  return isReviewPaper(row) ? <OutgoingStart projectId={projectId} about={{ kind: 'paper', id: row.id }} /> : null;
}

/**
 * Starts a draft from the thing it is about: a paper, a meeting or an
 * action. The draft is made from the record and opened in Outgoing, where a
 * person reads it, changes it and approves it. Drawn only for the firm's own
 * people who may change a record.
 */
export function OutgoingStart({ projectId, about, className, onStarted }: { projectId: string; about: OutgoingAbout; className?: string; /** The draft was made and is being opened. */ onStarted?: () => void }) {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!me || !mayDraftOutgoing(me.role)) return null;
  const kinds = KINDS[about.kind];

  async function start(kind: OutgoingKind) {
    setOpen(false);
    setBusy(true);
    try {
      const made = await outgoingApi.start(projectId, { kind, about });
      if (made.said) toast(made.said, 'warning');
      onStarted?.();
      navigate(outgoingAddress(projectId, made.draftId));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The draft could not be made', 'critical');
      setBusy(false);
    }
  }

  if (kinds.length === 1) {
    return (
      <Button size="sm" variant="ghost" loading={busy} onClick={() => void start(kinds[0]!.kind)} className={className}>
        {busy ? 'Drafting' : kinds[0]!.label}
      </Button>
    );
  }
  return (
    <span className={cn('relative inline-flex', className)}>
      <Button size="sm" variant="ghost" loading={busy} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        {busy ? 'Drafting' : 'Draft…'}
      </Button>
      {open ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <ul className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg bg-surface p-1 shadow-pop ring-1 ring-[var(--ring)]">
            {kinds.map((option) => (
              <li key={option.kind}>
                <button type="button" onClick={() => void start(option.kind)} className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken coarse:min-h-11">
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </span>
  );
}
