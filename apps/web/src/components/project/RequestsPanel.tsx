import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Send, X } from 'lucide-react';
import type { EvidenceRecord, ProjectRequest, ProjectRequestStatus } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Field, Input, Modal, Select, SubmitButton, Textarea, cn, useToast } from '../ui/kit';
import { Avatar, dayMonth } from './ProjectPanels';

/** Roles an outside professional holds on a file, as a firm names them. */
export const PROFESSIONAL_ROLES = [
  'Owner',
  "Owner's advocate",
  'Chartered accountant',
  'Architect',
  'Structural engineer',
  'Civil engineer',
  'Valuer',
  'Surveyor',
  'Contractor',
  'Developer',
  'Lender',
  'Sales and marketing',
];

export interface RequestRow {
  projectId: string;
  projectName?: string;
  request: ProjectRequest;
  ageDays: number;
  overdue: boolean;
}

const STATUS_LABEL: Record<ProjectRequestStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  answered: 'Answered',
  cancelled: 'Cancelled',
};

function statusBadge(row: RequestRow) {
  const { request, overdue, ageDays } = row;
  if (request.status === 'answered') return <Badge tone="good">Answered {dayMonth(request.answeredAt)}</Badge>;
  if (request.status === 'cancelled') return <Badge tone="neutral">Cancelled</Badge>;
  if (request.status === 'draft') return <Badge tone="neutral">Draft</Badge>;
  if (overdue) return <Badge tone="critical">Overdue since {dayMonth(request.dueAt)}</Badge>;
  if (request.dueAt) return <Badge tone={ageDays >= 5 ? 'warning' : 'neutral'}>Due {dayMonth(request.dueAt)}</Badge>;
  return <Badge tone={ageDays >= 5 ? 'warning' : 'neutral'}>{ageDays} day{ageDays === 1 ? '' : 's'}</Badge>;
}

/**
 * Requests as a list a lead can work through: who owes what, since when, and
 * the two things done to a request, marking it answered or sending a draft.
 */
export function RequestList({
  rows,
  onChanged,
  showProject = false,
  empty,
}: {
  rows: RequestRow[];
  onChanged: () => void | Promise<void>;
  showProject?: boolean;
  empty?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function set(row: RequestRow, status: ProjectRequestStatus) {
    setBusy(row.request.id);
    try {
      await api.patchRequest(row.projectId, row.request.id, { status });
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the request', 'critical');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return <p className="py-2 text-[13px] text-ink-muted">{empty ?? 'No requests.'}</p>;
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((row) => {
        const r = row.request;
        const open = r.status === 'sent' || r.status === 'draft';
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar name={r.recipient} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {r.title}
              </p>
              <p className="text-[12px] text-ink-secondary">
                {r.recipient}
                {r.recipientRole ? ` · ${r.recipientRole}` : ''}
                {r.sentAt ? ` · sent ${dayMonth(r.sentAt)}` : ''}
                {showProject && row.projectName ? (
                  <>
                    {' · '}
                    <Link to={`/projects/${row.projectId}/people`} className="text-brand hover:underline">
                      {row.projectName}
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
            {statusBadge(row)}
            {open ? (
              <div className="flex shrink-0 gap-1">
                {r.status === 'draft' ? (
                  <Button size="sm" icon={<Send size={13} />} loading={busy === r.id} onClick={() => void set(row, 'sent')}>
                    Mark sent
                  </Button>
                ) : (
                  <Button size="sm" icon={<Check size={13} />} loading={busy === r.id} onClick={() => void set(row, 'answered')}>
                    Answered
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Cancel the request"
                  title="Cancel the request"
                  disabled={busy === r.id}
                  onClick={() => void set(row, 'cancelled')}
                  className="rounded-lg p-1.5 text-ink-muted hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Ask a named person for something, with a date it is due by.
 *
 * Linked to an expected document where there is one, so the request answers
 * itself when that document is filed.
 */
export function NewRequestModal({
  open,
  onClose,
  projects,
  initialProjectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * The projects a request can be made on; one entry hides the picker. A
   * project given without its evidence has it fetched when picked.
   */
  projects: Array<{ id: string; name: string; evidence?: EvidenceRecord[] }>;
  initialProjectId?: string;
  onCreated: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [recipient, setRecipient] = useState('');
  const [role, setRole] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const [fetched, setFetched] = useState<Record<string, EvidenceRecord[]>>({});
  useEffect(() => {
    if (!open || !projectId || project?.evidence || fetched[projectId]) return;
    let live = true;
    void api.getProject(projectId).then(
      (full) => live && setFetched((prev) => ({ ...prev, [projectId]: full.evidence })),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, projectId, project?.evidence, fetched]);
  const evidence = project?.evidence ?? fetched[projectId] ?? [];
  const expected = evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');

  async function submit(send: boolean) {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.createRequest(projectId, {
        title: title.trim(),
        recipient: recipient.trim(),
        recipientRole: role || undefined,
        dueAt: dueAt || undefined,
        evidenceId: evidenceId || undefined,
        detail: detail.trim() || undefined,
        send,
      });
      toast(send ? `Recorded as sent to ${recipient.trim()}` : 'Saved as a draft', 'good');
      setTitle('');
      setRecipient('');
      setRole('');
      setDueAt('');
      setEvidenceId('');
      setDetail('');
      await onCreated();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the request', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const needs = [!title.trim() && 'What is asked for', !recipient.trim() && 'Who is asked'].filter(Boolean) as string[];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New request"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit(false)} disabled={needs.length > 0 || busy}>Save draft</Button>
          <SubmitButton onClick={() => void submit(true)} busy={busy} needs={needs}>Record as sent</SubmitButton>
        </>
      }
    >
      <div className="space-y-3">
        {projects.length > 1 ? (
          <Field label="Project">
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setEvidenceId(''); }}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="What is asked for" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Encumbrance certificate, 2004 to 2026" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who is asked" required>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Name, or their email" />
          </Field>
          <Field label="Their role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Not stated</option>
              {PROFESSIONAL_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due by">
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
          <Field label="Answers the expected document" hint="Closes itself when that document is filed.">
            <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
              <option value="">None</option>
              {expected.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Note to them">
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
        </Field>
        <p className={cn('text-[12px] text-ink-muted')}>
          The app records the request; it does not send email. Send it the way you normally would, then record it as sent.
        </p>
      </div>
    </Modal>
  );
}
