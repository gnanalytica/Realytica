import { useMemo, useState } from 'react';
import { ArrowRight, Building2, ChevronDown, FileCheck2, FileWarning, ListChecks, ShieldAlert } from 'lucide-react';
import {
  DD_DOMAIN_PROFILES,
  TECHNICAL_SYSTEM_LABEL,
  domainForCheck,
  domainForRecordKind,
  domainForRiskCategory,
  domainForSystem,
  domainsForDocumentKind,
  technicalDocumentGaps,
  totalOpenEstimatedCost,
} from '@realytica/shared';
import type { ComplianceCheck, ComplianceVerdict, DdDomain, RiskFlag, TechnicalFinding } from '@realytica/shared';
import type { ComponentType } from 'react';
import type { TabProps } from '../tab-props';
import { DOCUMENT_KIND_LABEL, money, severityTone, titleCase } from '../../../lib/format';
import { RecordFetchCard } from '../../../components/RecordFetchCard';
import { Badge, Card, CardBody, CardHeader, EmptyState, SectionTitle, StatTile, Tile, cn } from '../../../components/ui/kit';

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

function RiskRow({ risk }: { risk: RiskFlag }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-2 last:border-b-0">
      <Badge tone={severityTone(risk.severity)}>{titleCase(risk.severity)}</Badge>
      <span className="text-[13px] font-medium text-ink">{risk.title}</span>
      <span className="ml-auto text-[12px] text-ink-muted">{titleCase(risk.status)}</span>
    </div>
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

function DomainWorkboard({ domain, caseData, result, refresh, goToTab }: TabProps & { domain: DdDomain }) {
  const profile = DD_DOMAIN_PROFILES[domain];

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
  const blockers = checks.filter(c => c.verdict === 'blocker').length;
  const unanswered = checks.filter(c => c.verdict === 'unknown').length;
  const openFindings = findings.filter(f => f.status === 'open');
  const exposure = domain === 'financial' || domain === 'technical' ? totalOpenEstimatedCost(caseData.technicalFindings ?? []) : undefined;

  const empty = checks.length === 0 && risks.length === 0 && findings.length === 0 && documents.length === 0 && recordKinds.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <SectionTitle hint={profile.question}>{profile.label}</SectionTitle>

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

          {/* Risk domain rollup: the severity matrix across departments */}
          {domain === 'risk' && openRisks.length > 0 && (
            <Card>
              <CardHeader title="Where the open risk sits" subtitle="Every department's open risks by severity — the pre-meeting board" icon={<ShieldAlert size={16} />} />
              <CardBody className="flex flex-col gap-1">
                {openRisks.map(r => (
                  <div key={r.id} className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-1.5 last:border-b-0">
                    <Badge tone={severityTone(r.severity)}>{titleCase(r.severity)}</Badge>
                    <Badge tone="neutral">{DD_DOMAIN_PROFILES[domainForRiskCategory(r.category)].label}</Badge>
                    <span className="text-[13px] text-ink">{r.title}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {/* 2 — connectors */}
          {recordKinds.length > 0 && <RecordFetchCard caseData={caseData} onChanged={refresh} kinds={recordKinds} />}

          {/* 3 — evidence */}
          {(documents.length > 0 || docGaps.length > 0) && (
            <Card>
              <CardHeader
                title="Evidence in this department"
                subtitle={`${documents.length} on file${docGaps.length > 0 ? ` · ${docGaps.length} still required` : ''}`}
                icon={<FileCheck2 size={16} />}
              />
              <CardBody className="flex flex-col gap-3">
                {documents.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {documents.map(d => (
                      <li key={d.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="truncate text-ink">{d.fileName}</span>
                        <span className="shrink-0 text-[11.5px] text-ink-muted">{DOCUMENT_KIND_LABEL[d.kind]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {docGaps.length > 0 && (
                  <div className="rounded-lg bg-surface-2 p-2.5 ring-1 ring-[var(--ring)]">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
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
              <CardBody className="flex flex-col gap-2">
                {checks.map(c => (
                  <CheckRow key={c.key} check={c} />
                ))}
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
              <CardBody className="flex flex-col">
                {findings.map(f => (
                  <FindingSummaryRow key={f.id} finding={f} />
                ))}
              </CardBody>
            </Card>
          )}
          {domain !== 'risk' && risks.length > 0 && (
            <Card>
              <CardHeader title="Risks" subtitle={`${openRisks.length} open`} />
              <CardBody className="flex flex-col">
                {risks.map(r => (
                  <RiskRow key={r.id} risk={r} />
                ))}
              </CardBody>
            </Card>
          )}

          {/* 6 — actions */}
          {relatedActions.length > 0 && (
            <Card>
              <CardHeader title="Actions this department is waiting on" subtitle={`${relatedActions.length} open`} />
              <CardBody className="flex flex-col gap-1">
                {relatedActions.map(a => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-hairline py-1.5 text-[13px] last:border-b-0">
                    <Badge tone="neutral">{titleCase(a.priority.replace(/_/g, ' '))}</Badge>
                    <span className="text-ink">{a.title}</span>
                    <span className="ml-auto text-[12px] text-ink-muted">{titleCase(a.owner)}</span>
                  </div>
                ))}
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
