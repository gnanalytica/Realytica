import { useMemo, useState } from 'react';
import { AlarmClock, ArrowRight, Building2, ChevronDown, ClipboardCopy, ExternalLink, FileCheck2, FileWarning, ListChecks, Plug, Send, ShieldAlert } from 'lucide-react';
import {
  DD_DOMAIN_PROFILES,
  TECHNICAL_SYSTEM_LABEL,
  buildRfi,
  connectorsForDomain,
  ddWatcherAlerts,
  domainForCheck,
  domainForRecordKind,
  domainForRiskCategory,
  domainForSystem,
  domainsForDocumentKind,
  technicalDocumentGaps,
  totalOpenEstimatedCost,
} from '@realytica/shared';
import type { ActionPriority, ComplianceCheck, ComplianceVerdict, DdDomain, DdWatcherAlert, RiskSeverity, TechnicalFinding } from '@realytica/shared';
import type { ComponentType } from 'react';
import type { TabProps } from '../tab-props';
import { api } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { DOCUMENT_KIND_LABEL, money, severityTone, titleCase } from '../../../lib/format';
import { RecordFetchCard } from '../../../components/RecordFetchCard';
import { CoverageMeter, PRIORITY_FILL, ProportionBar, SeveritySpread, VERDICT_FILL } from '../cockpit/visuals';
import { Badge, Button, Card, CardBody, CardHeader, Disclosure, EmptyState, Modal, SectionTitle, StatTile, Tile, cn, useToast } from '../../../components/ui/kit';

const VERDICTS: ComplianceVerdict[] = ['clear', 'attention', 'blocker', 'unknown'];
const PRIORITIES: ActionPriority[] = ['now', 'before_offer', 'before_completion'];

/**
 * One workboard, eight departments.
 *
 * The cockpit design's central structural bet: a domain page is not a page,
 * it is a FILTER over the stores the case already has — checks, risks,
 * findings, documents, record connectors — routed by the closed maps in
 * `dd-domains.ts`. Nothing is duplicated and nothing is bespoke: the same
 * six-block anatomy renders Land and Financial alike, and a block with
 * nothing in it renders nothing rather than an empty wall.
 *
 * The Risk domain is the one deliberate exception: it is the rollup, so it
 * shows every open risk across departments plus the severity matrix — the
 * board a lead reads before a partner meeting.
 */

const VERDICT_TONE: Record<ComplianceVerdict, 'good' | 'warning' | 'critical' | 'neutral'> = {
  clear: 'good',
  attention: 'warning',
  blocker: 'critical',
  unknown: 'neutral',
};

function CheckRow({ check }: { check: ComplianceCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <Tile tone={VERDICT_TONE[check.verdict] === 'critical' ? 'critical' : 'neutral'} className="p-3">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open}>
        <ChevronDown size={13} className={cn('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
        <Badge tone={VERDICT_TONE[check.verdict]}>{titleCase(check.verdict)}</Badge>
        <span className="text-[13px] font-semibold text-ink">{check.label}</span>
        <span className="ml-auto text-[12px] text-ink-muted">{check.headline}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2 text-[12.5px] leading-relaxed text-ink-secondary">
          <p>{check.finding}</p>
          <p className="text-ink-muted">{check.nextStep}</p>
        </div>
      )}
    </Tile>
  );
}

function FindingSummaryRow({ finding }: { finding: TechnicalFinding }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-2 last:border-b-0">
      <Badge tone={severityTone(finding.severity)}>{titleCase(finding.severity)}</Badge>
      <span className="text-[13px] font-medium text-ink">{finding.zone}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">{finding.observation}</span>
      {finding.estimatedCost !== undefined && <span className="font-mono text-[12px] tabular-nums text-ink">{money(finding.estimatedCost, finding.estimatedCostCurrency ?? 'INR')}</span>}
    </div>
  );
}

/**
 * The department's alarms — the staleness report routed here. Live-clocked
 * on purpose: staleness computed against any moment but now would itself be
 * the stalest thing on the board.
 */
function WatcherCard({ alerts }: { alerts: DdWatcherAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Watch"
        subtitle="What has aged past the point a counterparty accepts — dates, not verdicts"
        icon={<AlarmClock size={16} />}
      />
      <CardBody className="flex flex-col gap-2">
        {alerts.map(alert => (
          <Tile key={alert.key} tone={alert.severity === 'serious' || alert.severity === 'critical' ? 'critical' : 'warning'} className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(alert.severity)}>{titleCase(alert.severity)}</Badge>
              <span className="text-[13px] font-semibold text-ink">{alert.label}</span>
              <span className="ml-auto tabular text-mini text-ink-muted">{alert.ageDays} days</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{alert.what}</p>
            <p className="mt-1 text-[12px] text-ink-muted">{alert.refresh}</p>
          </Tile>
        ))}
      </CardBody>
    </Card>
  );
}

/**
 * The department's sources of record beyond the fetchable ones — each names
 * the authority, what only it can settle, and the way in. Fetchable records
 * render above as RecordFetchCard tiles; listing them twice would put two
 * rows on the board that disagree about which is the button.
 */
function ConnectorsCard({ domain }: { domain: DdDomain }) {
  const connectors = connectorsForDomain(domain).filter(c => !c.recordKind);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (connectors.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Portals & authorities" subtitle="Where this department's records actually live" icon={<Plug size={16} />} />
      <CardBody className="flex flex-col gap-2">
        {connectors.map(c => {
          const open = openKey === c.key;
          return (
            <Tile key={c.key} tone="neutral" className="p-3">
              <button type="button" onClick={() => setOpenKey(open ? null : c.key)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={open}>
                <ChevronDown size={13} className={cn('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
                <span className="text-[13px] font-semibold text-ink">{c.label}</span>
                <span className="ml-auto truncate text-mini text-ink-muted">{c.authority}</span>
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    aria-label={`Open ${c.label}`}
                    className="shrink-0 text-ink-muted hover:text-brand"
                  >
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </button>
              {open && (
                <div className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2 text-[12.5px] leading-relaxed">
                  <p className="text-ink-secondary">
                    <span className="font-medium text-ink">Settles:</span> {c.settles}
                  </p>
                  <p className="text-ink-muted">{c.route}</p>
                </div>
              )}
            </Tile>
          );
        })}
      </CardBody>
    </Card>
  );
}

/**
 * The gap as the request: the department's recorded absences drawn into a
 * ready-to-send RFI. Deterministic — the preview IS the send text, and the
 * person copies and sends it themselves.
 */
function RfiButton({ caseData, domain }: { caseData: TabProps['caseData']; domain: DdDomain }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const rfi = useMemo(() => (open ? buildRfi(caseData, { now: new Date().toISOString(), domain }) : null), [open, caseData, domain]);
  const count = useMemo(() => buildRfi(caseData, { now: '1970-01-01T00:00:00.000Z', domain }).items.length, [caseData, domain]);
  if (count === 0) return null;
  return (
    <>
      <Button variant="secondary" size="sm" icon={<Send size={13} />} onClick={() => setOpen(true)}>
        Draft RFI ({count})
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Request for information — ${DD_DOMAIN_PROFILES[domain].label}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={<ClipboardCopy size={13} />}
              onClick={() => {
                if (!rfi) return;
                void navigator.clipboard.writeText(rfi.text).then(
                  () => toast('Request copied — review and send it yourself.', 'good'),
                  () => toast('Could not reach the clipboard.', 'critical'),
                );
              }}
            >
              Copy request
            </Button>
          </>
        }
      >
        <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap rounded-lg bg-sunken p-3 text-[12px] leading-relaxed text-ink">
          {rfi?.text}
        </pre>
      </Modal>
    </>
  );
}

export function DomainWorkboard({ domain, caseData, result, refresh, goToTab }: TabProps & { domain: DdDomain }) {
  const profile = DD_DOMAIN_PROFILES[domain];
  const { data: reference } = useAsync(() => api.reference(), []);

  const watcherAlerts = useMemo(
    () => (reference ? ddWatcherAlerts(caseData, reference, new Date().toISOString()).filter(a => a.domain === domain) : []),
    [caseData, reference, domain],
  );

  const checks = useMemo(
    () => (result?.stateCompliance?.checks ?? []).filter(c => domainForCheck(c.key) === domain),
    [result, domain],
  );
  const risks = useMemo(
    () => (result?.risks ?? []).filter(r => (domain === 'risk' ? true : domainForRiskCategory(r.category) === domain)),
    [result, domain],
  );
  const findings = useMemo(
    () => (caseData.technicalFindings ?? []).filter(f => f.reviewState === 'accepted' && domainForSystem(f.system) === domain),
    [caseData, domain],
  );
  const documents = useMemo(
    () => caseData.documents.filter(d => domainsForDocumentKind(d.kind).includes(domain)),
    [caseData, domain],
  );
  const docGaps = useMemo(
    () => technicalDocumentGaps('built', caseData.technicalDocumentsProvided).filter(item => domainForSystem(item.system) === domain),
    [caseData, domain],
  );
  const recordKinds = useMemo(
    () =>
      ['encumbrance_certificate', 'certified_instrument', 'record_of_rights', 'mutation', 'khata_extract', 'property_tax', 'survey_map'].filter(
        kind => domainForRecordKind(kind) === domain,
      ),
    [domain],
  );
  const relatedActions = useMemo(() => {
    const riskIds = new Set(risks.map(r => r.id));
    return (result?.actions ?? []).filter(a => !a.done && a.relatedRiskIds.some(id => riskIds.has(id)));
  }, [result, risks]);

  const openRisks = risks.filter(r => r.status === 'open');

  const [severityFilter, setSeverityFilter] = useState<RiskSeverity | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<string | null>(null);
  const severitySpread = useMemo(() => {
    const order: RiskSeverity[] = ['critical', 'serious', 'warning', 'info'];
    return order.map(severity => ({ severity, n: openRisks.filter(r => r.severity === severity).length }));
  }, [openRisks]);
  // Worst first, so the list under the bar leads with what the bar's darkest
  // band is about.
  const visibleRisks = useMemo(() => {
    const rank: Record<RiskSeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };
    return openRisks
      .filter(r => !severityFilter || r.severity === severityFilter)
      .slice()
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [openRisks, severityFilter]);
  const blockers = checks.filter(c => c.verdict === 'blocker').length;
  const unanswered = checks.filter(c => c.verdict === 'unknown').length;
  const openFindings = findings.filter(f => f.status === 'open');
  const exposure = domain === 'financial' || domain === 'technical' ? totalOpenEstimatedCost(caseData.technicalFindings ?? []) : undefined;

  const empty =
    checks.length === 0 &&
    risks.length === 0 &&
    findings.length === 0 &&
    documents.length === 0 &&
    recordKinds.length === 0 &&
    watcherAlerts.length === 0 &&
    connectorsForDomain(domain).length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionTitle hint={profile.question}>{profile.label}</SectionTitle>
        <RfiButton caseData={caseData} domain={domain} />
      </div>

      {empty ? (
        <EmptyState
          icon={<Building2 size={28} />}
          title={`Nothing routed to ${profile.label} yet`}
          description="Checks, risks, findings and documents land here as the case accumulates them. An empty department is a coverage fact, not a clean bill."
        />
      ) : (
        <>
          {/* 1 — status strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Blockers" value={blockers} tone={blockers > 0 ? 'critical' : 'neutral'} />
            <StatTile label="Open risks" value={openRisks.length} tone={openRisks.length > 0 ? 'warning' : 'neutral'} />
            <StatTile label={domain === 'risk' ? 'Open actions' : 'Open findings'} value={domain === 'risk' ? relatedActions.length : openFindings.length} tone="neutral" />
            {exposure !== undefined ? (
              <StatTile label="Costed exposure" value={money(exposure, caseData.identity.currency)} tone="neutral" />
            ) : (
              <StatTile label="Unanswered checks" value={unanswered} tone={unanswered > 0 ? 'warning' : 'neutral'} />
            )}
          </div>

          {/*
            What is open here, as a shape before it is a list.
            
            This was one row per risk — a severity badge, a department badge
            and a title — which is a table of contents for the work rather
            than a picture of it, and answering "how bad is this department"
            off it meant counting badges. The bar answers that before it is
            read, and its bands filter the list underneath, so the summary is
            also the way into the detail rather than a thing above it.
          */}
          {openRisks.length > 0 && (
            <Card>
              <CardHeader
                title={domain === 'risk' ? 'Where the open risk sits' : `Open risk in ${profile.label}`}
                subtitle={`${openRisks.length} open · worst first`}
                icon={<ShieldAlert size={16} />}
              />
              <CardBody className="flex flex-col gap-3">
                <SeveritySpread counts={severitySpread} selected={severityFilter} onSelect={setSeverityFilter} />
                <ul className="flex flex-col">
                  {visibleRisks.map(r => (
                    <li key={r.id} className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-1.5 last:border-b-0">
                      <Badge tone={severityTone(r.severity)}>{titleCase(r.severity)}</Badge>
                      {domain === 'risk' ? (
                        <Badge tone="neutral">{DD_DOMAIN_PROFILES[domainForRiskCategory(r.category)].label}</Badge>
                      ) : null}
                      <span className="min-w-0 flex-1 text-[13px] text-ink">{r.title}</span>
                    </li>
                  ))}
                </ul>
                {severityFilter && visibleRisks.length < openRisks.length ? (
                  <button
                    type="button"
                    onClick={() => setSeverityFilter(null)}
                    className="self-start text-mini text-brand hover:underline coarse:min-h-11"
                  >
                    Show the other {openRisks.length - visibleRisks.length}
                  </button>
                ) : null}
              </CardBody>
            </Card>
          )}

          {/* watchers — the department's alarms, above the work they interrupt */}
          <WatcherCard alerts={watcherAlerts} />

          {/* 2 — connectors */}
          {recordKinds.length > 0 && <RecordFetchCard caseData={caseData} onChanged={refresh} kinds={recordKinds} />}
          <ConnectorsCard domain={domain} />

          {/* 3 — evidence */}
          {(documents.length > 0 || docGaps.length > 0) && (
            <Card>
              <CardHeader
                title="Evidence in this department"
                subtitle={`${documents.length} on file${docGaps.length > 0 ? ` · ${docGaps.length} still required` : ''}`}
                icon={<FileCheck2 size={16} />}
              />
              <CardBody className="flex flex-col gap-3">
                {/* Two numbers a reader had to divide, divided. */}
                <CoverageMeter held={documents.length} required={docGaps.length} />
                {documents.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {documents.map(d => (
                      <li key={d.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate text-ink">{d.fileName}</span>
                        <span className="shrink-0 text-mini text-ink-muted">{DOCUMENT_KIND_LABEL[d.kind]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {docGaps.length > 0 && (
                  <div className="rounded-lg bg-surface-2 p-2.5 ring-1 ring-[var(--ring)]">
                    <p className="mb-1 flex items-center gap-1.5 text-mini font-semibold uppercase tracking-wide text-ink-muted">
                      <FileWarning size={12} /> Still to obtain
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {docGaps.map(item => (
                        <li key={item.id} className="text-[12.5px] text-ink-secondary">
                          {item.label} <span className="text-ink-faint">· {TECHNICAL_SYSTEM_LABEL[item.system]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* 4 — checks */}
          {checks.length > 0 && (
            <Card>
              <CardHeader title="Checks" subtitle={`${checks.filter(c => c.verdict === 'clear').length} clear of ${checks.length}`} icon={<ListChecks size={16} />} />
              <CardBody className="flex flex-col gap-3">
                <ProportionBar
                  segments={VERDICTS.map(v => ({ key: v, label: v, n: checks.filter(c => c.verdict === v).length, fill: VERDICT_FILL[v] }))}
                  selected={verdictFilter}
                  onSelect={setVerdictFilter}
                />
                <div className="flex flex-col gap-2">
                  {checks.filter(c => !verdictFilter || c.verdict === verdictFilter).map(c => (
                    <CheckRow key={c.key} check={c} />
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* 5 — findings and risks */}
          {findings.length > 0 && (
            <Card>
              <CardHeader
                title="Findings"
                subtitle="Managed on the Technical DD view — this is the departmental read"
                action={
                  <button type="button" onClick={() => goToTab('overview?view=technical')} className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
                    Manage <ArrowRight size={12} />
                  </button>
                }
              />
              <CardBody>
                <Disclosure title="Findings in this department" count={findings.length} defaultOpen={findings.length <= 5}>
                  <div className="flex flex-col">
                    {findings.map(f => (
                      <FindingSummaryRow key={f.id} finding={f} />
                    ))}
                  </div>
                </Disclosure>
              </CardBody>
            </Card>
          )}
          {/*
            No second risk card. The spread above shows this department's open
            risks for EVERY domain now, so this was the same pile rendered
            twice on one scroll — once as a bar you can filter and once as a
            flat list underneath it. What it uniquely carried was the CLOSED
            ones, which are a different question and belong with the history
            rather than in the middle of the working board.
          */}

          {/* 6 — actions */}
          {relatedActions.length > 0 && (
            <Card>
              <CardHeader title="Actions this department is waiting on" subtitle={`${relatedActions.length} open`} />
              <CardBody className="flex flex-col gap-3">
                <ProportionBar
                  segments={PRIORITIES.map(pr => ({
                    key: pr,
                    label: pr.replace(/_/g, ' '),
                    n: relatedActions.filter(a => a.priority === pr).length,
                    fill: PRIORITY_FILL[pr],
                  }))}
                />
                <div className="flex flex-col gap-1">
                {relatedActions.map(a => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-1.5 text-[13px] last:border-b-0">
                    <Badge tone="neutral">{titleCase(a.priority.replace(/_/g, ' '))}</Badge>
                    <span className="text-ink">{a.title}</span>
                    <span className="ml-auto text-[12px] text-ink-muted">{titleCase(a.owner)}</span>
                  </div>
                ))}
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** A per-domain view component for `CASE_GROUPS` — same TabProps contract as every other view. */
export function makeDomainView(domain: DdDomain): ComponentType<TabProps> {
  const View = (props: TabProps) => <DomainWorkboard {...props} domain={domain} />;
  View.displayName = `DomainWorkboard(${domain})`;
  return View;
}
