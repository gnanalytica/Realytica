import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  APPROVAL_STATUS_LABEL,
  SUB_STAGE_LABEL,
  approvalsRegister,
  constructionGate,
  type ApprovalStatus,
  type DdProject,
} from '@realytica/shared';
import { Badge, Callout, Card, CardBody, CardHeader, cn, type Tone } from '../ui/kit';

/** 2397 days → "6 years": a lapse reads in the unit it is felt in. */
function since(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${Math.floor(days / 365.25)} years`;
}

const STATUS_TONE: Record<ApprovalStatus, Tone> = {
  in_force: 'good',
  expiring: 'warning',
  expired: 'critical',
  missing: 'critical',
  not_yet_due: 'neutral',
  if_applicable: 'neutral',
};

function day(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/**
 * Every sanction, clearance and NOC the project needs, in the order the
 * project needs them, with what is on file for each: who issued it, its
 * reference, when, and until when. Read from the documents in the vault — a
 * fire NOC filed is a fire NOC held — and from the stage the project is at,
 * which decides what should already be in hand.
 */
export function ApprovalsRegister({ project, onOpenDocument }: { project: DdProject; onOpenDocument: (evidenceId: string) => void }) {
  const lines = useMemo(() => approvalsRegister(project), [project]);
  const gate = useMemo(() => constructionGate(project), [project]);
  const held = lines.filter((l) => l.held.length).length;
  const attention = lines.filter((l) => l.status === 'missing' || l.status === 'expired' || l.status === 'expiring').length;

  return (
    <div className="space-y-4">
      {gate.open ? (
        <Callout tone="good" title="Construction may proceed">
          The plan sanction and the commencement certificate are on file.
        </Callout>
      ) : (
        <Callout tone="warning" title="Construction is not cleared to start">
          Not on file: {gate.missing.join(', ')}. Work logged from site before these are in hand is flagged.
        </Callout>
      )}
      <Card>
        <CardHeader
          icon={<ShieldCheck size={15} />}
          title="Approvals register"
          subtitle={`${held} of ${lines.length} on file${attention ? ` · ${attention} need attention` : ''}`}
          info="What each approval needs is read from its document: the issuing authority, the reference, the date and the validity. An approval is expected once the project reaches the step it is needed by."
        />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2 font-semibold">Approval</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">On file</th>
                <th className="px-2 py-2 font-semibold">Valid until</th>
                <th className="px-4 py-2 font-semibold">Needed by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {lines.map((line) => (
                <tr key={line.kind.key} className={cn(line.status === 'if_applicable' && !line.held.length && 'text-ink-muted')}>
                  <td className="px-4 py-2.5 align-top">
                    <p className="font-medium text-ink">{line.kind.label}</p>
                    <p className="text-micro text-ink-muted">{line.kind.authority}</p>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <Badge tone={STATUS_TONE[line.status]}>{APPROVAL_STATUS_LABEL[line.status]}</Badge>
                    {line.daysLeft !== null && line.status !== 'in_force' ? (
                      <p className="mt-0.5 text-micro text-ink-muted">{line.daysLeft < 0 ? `${since(-line.daysLeft)} ago` : `${line.daysLeft} days left`}</p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    {line.held.length ? (
                      <ul className="space-y-1">
                        {line.held.map((h) => (
                          <li key={h.evidenceId}>
                            <button type="button" onClick={() => onOpenDocument(h.evidenceId)} className="text-left text-brand hover:underline">
                              {h.document}
                            </button>
                            <span className="block text-micro text-ink-secondary">
                              {[h.issuedBy, h.reference, h.issuedOn ? `issued ${day(h.issuedOn)}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-ink-secondary">{line.say}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 align-top font-mono text-[12px]">{line.held.map((h) => (h.validUntil ? day(h.validUntil) : '')).filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 align-top text-[12px] text-ink-secondary">{SUB_STAGE_LABEL[line.kind.neededBy]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
