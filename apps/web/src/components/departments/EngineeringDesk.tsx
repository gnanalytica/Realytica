import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, FileStack, FolderInput, IndianRupee } from 'lucide-react';
import {
  DEPARTMENTS,
  departmentRole,
  engineeringSummary,
  remedialCostSummary,
  roleCanEdit,
  supportingDocuments,
  type DdProject,
  type DepartmentKey,
  type FindingSeverity,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { money } from '../../lib/format';
import { useMe } from '../../lib/useMe';
import { RemedialCostChart } from '../charts';
import { Button, Card, CardBody, CardHeader, Select, StatTile, TONE_FILL, cn, useToast, type Tone } from '../ui/kit';

const SEVERITY_TONE: Record<FindingSeverity, Tone> = { critical: 'critical', high: 'serious', medium: 'warning', low: 'neutral' };
const SEVERITY_LABEL: Record<FindingSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const SEVERITY_ORDER: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];

function useMayEdit(project: DdProject, department: DepartmentKey): boolean {
  const me = useMe();
  return me ? roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department)) : false;
}

/* ==================================================================== */
/* The dashboard                                                         */
/* ==================================================================== */

/** One discipline's open findings as a stacked bar: its length is the count, its colours the severities. */
function SeverityBar({ counts, max }: { counts: Record<FindingSeverity, number>; max: number }) {
  const total = SEVERITY_ORDER.reduce((n, s) => n + counts[s], 0);
  return (
    <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]" role="img" aria-label={`${total} open: ${SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(', ') || 'none'}`}>
      {SEVERITY_ORDER.map((s) =>
        counts[s] ? <span key={s} className={cn('h-full', TONE_FILL[SEVERITY_TONE[s]])} style={{ width: `${(counts[s] / Math.max(max, 1)) * 100}%` }} /> : null,
      )}
    </span>
  );
}

/**
 * The technical picture at a glance: four figures, then the disciplines side
 * by side. Every figure is read off the registers, so it moves when a check
 * is answered, a finding raised or a document filed — from here or the chat.
 */
export function EngineeringDashboard({
  project,
  department = 'construction',
  show = 'all',
  onOpenFindings,
  onOpenActions,
}: {
  project: DdProject;
  department?: DepartmentKey;
  /** The four figures, the charts, or both. */
  show?: 'all' | 'figures' | 'charts';
  onOpenFindings: () => void;
  onOpenActions: () => void;
}) {
  const summary = useMemo(() => engineeringSummary(project, department), [project, department]);
  const cost = useMemo(() => remedialCostSummary(project), [project]);
  const maxFindings = Math.max(1, ...summary.disciplines.map((d) => d.openFindings));
  const material = summary.findings.bySeverity.critical + summary.findings.bySeverity.high;
  const hasCost = cost.rows.some((r) => r.count > 0);
  const withChecks = summary.disciplines.filter((d) => d.checks.total > 0);

  return (
    <div className="space-y-4">
      {show === 'charts' ? null : (
      <div className="grid grid-cols-2 gap-3 [@container(min-width:52rem)]:grid-cols-4">
        <StatTile
          label="Documents in hand"
          value={summary.documents.total ? `${summary.documents.received}/${summary.documents.total}` : '—'}
          hint={summary.documents.total ? `${summary.documents.requested} asked for${summary.documents.overdue ? ` · ${summary.documents.overdue} overdue` : ''}` : 'None expected'}
          tone={summary.documents.overdue ? 'warning' : 'neutral'}
          icon={<FileStack size={15} />}
        />
        <StatTile
          label="Checks answered"
          value={summary.checks.total ? `${summary.checks.answered}/${summary.checks.total}` : '—'}
          hint={summary.checks.issues ? `${summary.checks.issues} with an issue` : summary.checks.total ? 'No issues' : 'None yet'}
          tone={summary.checks.issues ? 'warning' : 'neutral'}
          icon={<ClipboardCheck size={15} />}
        />
        <StatTile
          label="Open findings"
          value={summary.findings.open}
          hint={material ? `${material} critical or high` : 'None critical or high'}
          tone={summary.findings.bySeverity.critical ? 'critical' : material ? 'serious' : 'neutral'}
          icon={<AlertTriangle size={15} />}
        />
        <StatTile
          label="Cost to remedy"
          value={cost.total ? money(cost.total, project.currency, { compact: true }) : '—'}
          hint={cost.uncosted + cost.unbanded ? `${cost.uncosted + cost.unbanded} action${cost.uncosted + cost.unbanded === 1 ? '' : 's'} not yet costed` : cost.total ? 'All costed' : 'None costed'}
          tone="neutral"
          icon={<IndianRupee size={15} />}
        />
      </div>
      )}

      {show === 'figures' ? null : (
        <>
      <div className="grid grid-cols-1 gap-4 [@container(min-width:56rem)]:grid-cols-2">
        <Card>
          <CardHeader
            title="Findings by discipline"
            subtitle={summary.findings.open ? 'Open, by severity' : undefined}
            action={
              summary.findings.open ? (
                <Button size="sm" variant="ghost" onClick={onOpenFindings}>
                  Open the register
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {summary.findings.open ? (
              <>
                <ul className="space-y-2.5">
                  {summary.disciplines
                    .filter((d) => d.openFindings)
                    .map((d) => (
                      <li key={d.scopeKey}>
                        <button type="button" onClick={onOpenFindings} className="group block w-full rounded-lg px-1 py-0.5 text-left hover:bg-sunken/60">
                          <span className="flex items-baseline justify-between gap-2 text-[13px]">
                            <span className="text-ink">{d.label}</span>
                            <span className="font-mono text-micro tabular-nums text-ink-secondary">{d.openFindings}</span>
                          </span>
                          <span className="mt-1 block">
                            <SeverityBar counts={d.findings} max={maxFindings} />
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-secondary" aria-label="Severity key">
                  {SEVERITY_ORDER.map((s) => (
                    <li key={s} className="inline-flex items-center gap-1.5">
                      <span className={cn('size-2 rounded-full', TONE_FILL[SEVERITY_TONE[s]])} aria-hidden />
                      {SEVERITY_LABEL[s]} · {summary.findings.bySeverity[s]}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">No open findings.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Checks by discipline" subtitle={withChecks.length ? 'Answered, and with an issue' : undefined} />
          <CardBody>
            {withChecks.length ? (
              <ul className="space-y-2.5">
                {withChecks.map((d) => {
                  const clear = d.checks.answered - d.checks.issues;
                  return (
                    <li key={d.scopeKey}>
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="text-ink">{d.label}</span>
                        <span className="font-mono text-micro tabular-nums text-ink-secondary">
                          {d.checks.answered}/{d.checks.total}
                        </span>
                      </span>
                      <span
                        className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-[var(--ring)]"
                        role="img"
                        aria-label={`${d.checks.answered} of ${d.checks.total} answered, ${d.checks.issues} with an issue`}
                      >
                        <span className={cn('h-full', TONE_FILL.good)} style={{ width: `${(clear / d.checks.total) * 100}%` }} />
                        <span className={cn('h-full', TONE_FILL.serious)} style={{ width: `${(d.checks.issues / d.checks.total) * 100}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-secondary">No checks yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {hasCost ? (
        <Card>
          <CardHeader
            title="Remedial cost"
            subtitle="By when it is needed"
            action={
              <Button size="sm" variant="ghost" onClick={onOpenActions}>
                Open the actions
              </Button>
            }
          />
          <CardBody>
            <RemedialCostChart summary={cost} onSelect={() => onOpenActions()} />
          </CardBody>
        </Card>
      ) : null}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Supporting documents                                                  */
/* ==================================================================== */

/**
 * What the client handed over that belongs to a department this project does
 * not run. Still read, still citable; given a place here by hand when the
 * engineering work relies on it.
 */
export function SupportingDocumentsCard({
  project,
  department,
  onChanged,
  onOpenDocument,
}: {
  project: DdProject;
  department: DepartmentKey;
  onChanged: (next: DdProject) => void;
  onOpenDocument: (evidenceId: string) => void;
}) {
  const toast = useToast();
  const mayEdit = useMayEdit(project, department);
  const docs = useMemo(() => supportingDocuments(project), [project]);
  const [busy, setBusy] = useState<string | null>(null);
  const targets = DEPARTMENTS.find((d) => d.key === department)?.workstreams.filter((w) => w.status === 'live') ?? [];
  if (!docs.length) return null;

  async function use(evidenceId: string, workstream: string) {
    setBusy(evidenceId);
    try {
      const res = await workspaceApi.setDocumentWorkstream(project.id, evidenceId, workstream);
      onChanged(res.project);
      toast('Filed.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not move the document', 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<FolderInput size={15} />}
        title="Supporting documents"
        subtitle={`${docs.length} from departments this project does not run`}
      />
      <CardBody>
        <ul className="divide-y divide-hairline">
          {docs.map(({ evidence, homeLabel }) => (
            <li key={evidence.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <button type="button" onClick={() => onOpenDocument(evidence.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] text-ink hover:underline" title={evidence.title}>
                  {evidence.title}
                </span>
                <span className="block text-micro text-ink-muted">
                  {evidence.documentType ?? 'Document'}
                  {homeLabel ? ` · would sit in ${homeLabel}` : ''}
                </span>
              </button>
              {mayEdit && targets.length ? (
                <Select aria-label={`Use ${evidence.title} in`} value="" disabled={busy === evidence.id} onChange={(e) => e.target.value && void use(evidence.id, e.target.value)} className="w-auto">
                  <option value="">Use in…</option>
                  {targets.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
