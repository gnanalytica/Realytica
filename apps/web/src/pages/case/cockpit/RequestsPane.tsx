import { useMemo, useState } from 'react';
import { ClipboardCopy, Send } from 'lucide-react';
import {
  DD_DOMAIN_PROFILES,
  REQUEST_RECIPIENT_LABEL,
  REQUEST_STATUS_LABEL,
  isOverdue,
  orderRequests,
  renderRequestList,
  summariseRequests,
  unaskedGaps,
} from '@realytica/shared';
import type { CaseRequest, DdDomain, PropertyCase, RequestStatus } from '@realytica/shared';
import { api } from '../../../lib/api';
import { relativeTime } from '../../../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, cn, useToast } from '../../../components/ui/kit';

/**
 * What we have asked for, of whom, and whether it came.
 *
 * The counterpart to the dossier's gap list, and deliberately not the same
 * thing: a gap is a fact about the file that recomputes on every read, while
 * a request is an act with a date and a recipient that outlives the gap. The
 * two are kept in step by `unaskedGaps`, which hides a gap somebody is
 * already chasing — so nobody asks for the same document twice, and
 * withdrawing a request puts it back on the list because we did stop asking.
 */
export function RequestsPane({
  caseData,
  onChanged,
  onOpenDocument,
}: {
  caseData: PropertyCase;
  onChanged: () => void | Promise<void>;
  onOpenDocument: (documentId: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const now = new Date().toISOString();

  const requests = caseData.requests ?? [];
  const summary = useMemo(() => summariseRequests(requests, now), [requests, now]);
  const ordered = useMemo(() => orderRequests(requests, now), [requests, now]);

  /** Every department's unasked gaps, so one control can raise the whole list. */
  const unasked = useMemo(
    () =>
      (Object.keys(DD_DOMAIN_PROFILES) as DdDomain[]).flatMap(d => unaskedGaps(caseData, d, now)),
    [caseData, now],
  );

  async function raiseAll(): Promise<void> {
    if (unasked.length === 0 || busy) return;
    setBusy(true);
    try {
      await api.createRequests(caseData.id, unasked.slice(0, 50));
      await onChanged();
      toast(`${Math.min(unasked.length, 50)} request${unasked.length === 1 ? '' : 's'} raised`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not raise the requests.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(request: CaseRequest, status: RequestStatus): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateRequest(caseData.id, request.id, { status });
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the request.', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">Requests</div>
          <div className="mt-0.5 text-mini text-ink-muted">
            {summary.outstanding} outstanding
            {summary.overdue > 0 ? ` · ${summary.overdue} overdue` : ''}
            {summary.answered > 0 ? ` · ${summary.answered} answered` : ''}
          </div>
        </div>
        <div className="flex-grow" />
        {requests.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<ClipboardCopy size={13} />}
            onClick={() => {
              const text = renderRequestList(requests, caseData.identity.label, now);
              void navigator.clipboard.writeText(text).then(
                () => toast('Request list copied — review and send it yourself.', 'good'),
                () => toast('Could not reach the clipboard.', 'critical'),
              );
            }}
          >
            Copy list
          </Button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {unasked.length > 0 ? (
          <Card>
            <CardHeader
              title={`${unasked.length} gap${unasked.length === 1 ? '' : 's'} nobody has asked for`}
              subtitle="Recorded absences on this file that no outstanding request covers"
              icon={<Send size={15} />}
              action={
                <Button variant="primary" size="sm" loading={busy} onClick={() => void raiseAll()}>
                  Raise {unasked.length > 50 ? 'first 50' : 'all'}
                </Button>
              }
            />
            <CardBody>
              <ul className="flex flex-col gap-1">
                {unasked.slice(0, 6).map(g => (
                  <li key={`${g.domain}:${g.what}`} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="text-ink">{g.what}</span>
                    <span className="ml-auto shrink-0 text-micro text-ink-muted">
                      {DD_DOMAIN_PROFILES[g.domain].label}
                    </span>
                  </li>
                ))}
                {unasked.length > 6 ? (
                  <li className="text-mini text-ink-muted">and {unasked.length - 6} more</li>
                ) : null}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        {requests.length === 0 ? (
          <EmptyState
            icon={<Send size={26} />}
            title="Nothing has been asked for yet"
            description="A request is an act with a date and a recipient — distinct from a gap, which is just a fact about the file. Raise them from the gaps above."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map(r => {
              const late = isOverdue(r, now);
              const settled = r.status === 'answered' || r.status === 'withdrawn';
              const answeredDoc = r.answeredWithDocumentId
                ? caseData.documents.find(d => d.id === r.answeredWithDocumentId)
                : undefined;
              return (
                <li
                  key={r.id}
                  className={cn(
                    'rounded-xl border bg-surface px-3.5 py-3',
                    late ? 'border-critical/45' : 'border-[var(--ring)]',
                    settled ? 'opacity-70' : '',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={late ? 'critical' : r.status === 'answered' ? 'good' : 'neutral'}>
                      {late ? 'Overdue' : REQUEST_STATUS_LABEL[r.status]}
                    </Badge>
                    <span className="text-[13px] font-medium text-ink">{r.what}</span>
                    <span className="ml-auto shrink-0 text-micro text-ink-muted">
                      {DD_DOMAIN_PROFILES[r.domain as DdDomain]?.label ?? r.domain}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{r.why}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-mini text-ink-muted">
                    <span>{REQUEST_RECIPIENT_LABEL[r.recipient]}</span>
                    <span>·</span>
                    <span>raised {relativeTime(r.createdAt)}</span>
                    {r.sentAt ? <span>· sent {relativeTime(r.sentAt)}</span> : null}
                    {answeredDoc ? (
                      <button
                        type="button"
                        onClick={() => onOpenDocument(answeredDoc.id)}
                        className="text-brand hover:underline"
                      >
                        · answered by {answeredDoc.fileName}
                      </button>
                    ) : null}
                  </div>
                  {!settled ? (
                    <div className="mt-2.5 flex gap-1.5">
                      {r.status === 'open' ? (
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setStatus(r, 'sent')}>
                          Mark sent
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setStatus(r, 'answered')}>
                        Mark answered
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void setStatus(r, 'withdrawn')}>
                        Withdraw
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
