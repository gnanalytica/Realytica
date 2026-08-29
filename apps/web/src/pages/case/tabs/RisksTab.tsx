import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Filter, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { EvidenceItem, RiskCategory, RiskFlag, RiskSeverity, RiskStatus } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { api } from '../../../lib/api';
import { severityTone, titleCase } from '../../../lib/format';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Modal,
  Select,
  Spinner,
  Stat,
  TONE_ICON,
  cn,
  useToast,
} from '../../../components/ui/kit';
import { EvidenceLink } from '../../../components/EvidenceLink';
import { RiskProfileChart } from '../../../components/charts';
import { Prose, SplitProse } from '../../../components/ui/prose';

const SEVERITIES: RiskSeverity[] = ['critical', 'serious', 'warning', 'info'];
const CATEGORIES: RiskCategory[] = [
  'title',
  'planning',
  'structural',
  'financial',
  'market',
  'tenancy',
  'environmental',
  'data',
];
const STATUSES: RiskStatus[] = ['open', 'mitigated', 'accepted'];

const STATUS_RANK: Record<RiskStatus, number> = { open: 0, mitigated: 1, accepted: 2 };
const SEVERITY_RANK: Record<RiskSeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };

export default function RisksTab({ caseData, result, refresh, runScreen, running, goToTab }: TabProps) {
  const toast = useToast();
  const navigate = useNavigate();

  const [severityFilter, setSeverityFilter] = useState<RiskSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<RiskCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'all'>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, RiskStatus>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [confirmRisk, setConfirmRisk] = useState<RiskFlag | null>(null);

  const openEvidence = (ids: string[]) => {
    navigate(`/cases/${caseData.id}/evidence?evidence=${encodeURIComponent(ids.join(','))}`);
  };

  const risks = useMemo(() => {
    if (!result) return [];
    return result.risks.map((r) => (overrides[r.id] ? { ...r, status: overrides[r.id] } : r));
  }, [result, overrides]);

  const counts = useMemo(() => {
    const bySeverity: Record<RiskSeverity, number> = { critical: 0, serious: 0, warning: 0, info: 0 };
    const byStatus: Record<RiskStatus, number> = { open: 0, mitigated: 0, accepted: 0 };
    for (const r of risks) {
      bySeverity[r.severity] += 1;
      byStatus[r.status] += 1;
    }
    return { bySeverity, byStatus };
  }, [risks]);

  const filtered = useMemo(() => {
    return risks
      .filter((r) => severityFilter === 'all' || r.severity === severityFilter)
      .filter((r) => categoryFilter === 'all' || r.category === categoryFilter)
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
      );
  }, [risks, severityFilter, categoryFilter, statusFilter]);

  async function doApply(risk: RiskFlag, status: RiskStatus): Promise<void> {
    const prev = risk.status;
    setOverrides((o) => ({ ...o, [risk.id]: status }));
    setPending((p) => ({ ...p, [risk.id]: true }));
    try {
      await api.setRiskStatus(caseData.id, risk.id, status);
      toast(`${risk.code} marked ${titleCase(status).toLowerCase()}`, 'good');
      await refresh();
      setOverrides((o) => {
        const next = { ...o };
        delete next[risk.id];
        return next;
      });
    } catch {
      setOverrides((o) => {
        const next = { ...o };
        next[risk.id] = prev;
        return next;
      });
      toast('Could not update risk status — please retry.', 'critical');
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[risk.id];
        return next;
      });
    }
  }

  function applyStatus(risk: RiskFlag, status: RiskStatus): void {
    if (status === risk.status) return;
    if (status === 'accepted' && risk.severity === 'critical') {
      setConfirmRisk(risk);
      return;
    }
    void doApply(risk, status);
  }

  function toggleExpanded(id: string): void {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  function clearFilters(): void {
    setSeverityFilter('all');
    setCategoryFilter('all');
    setStatusFilter('all');
  }

  if (!result) {
    return (
      <EmptyState
        icon={<ShieldAlert size={28} />}
        title="Not screened yet"
        description="Run the screen to surface material risks — title, planning, structural, financial, market, tenancy, environmental and data — each backed by evidence with an impact and a mitigation."
        action={
          <Button variant="primary" icon={<ShieldCheck size={15} />} loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  const filtersActive = severityFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Risk profile"
          subtitle={`${counts.byStatus.open} open · ${counts.byStatus.mitigated} mitigated · ${counts.byStatus.accepted} accepted`}
          icon={<ShieldAlert size={16} />}
        />
        <CardBody className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SEVERITIES.map((s) => (
              <Stat key={s} label={titleCase(s)} value={counts.bySeverity[s]} tone={severityTone(s)} />
            ))}
          </div>
          <div className="sm:w-56">
            <RiskProfileChart risks={risks} height={96} />
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Filter size={13} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="w-40">
          <Select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setSeverityFilter(e.target.value as RiskSeverity | 'all')}
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setCategoryFilter(e.target.value as RiskCategory | 'all')}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as RiskStatus | 'all')}
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </div>
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {risks.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="No risks flagged"
          description="The screen did not surface any material risks for this property."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Filter size={24} />}
          title="No risks match these filters"
          description="Try widening the severity, category or status filter."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-ink-secondary">
              Every open finding, worst first.
            </span>
            <span className="text-[11.5px] text-ink-faint">
              {filtered.length} finding{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          {filtered.map((risk) => {
            const relatedActions = result.actions.filter((a) => a.relatedRiskIds.includes(risk.id));
            return (
              <RiskCard
                key={risk.id}
                risk={risk}
                evidence={result.evidence}
                expanded={Boolean(expanded[risk.id])}
                onToggle={() => toggleExpanded(risk.id)}
                onApplyStatus={(status) => applyStatus(risk, status)}
                pending={Boolean(pending[risk.id])}
                relatedActionsCount={relatedActions.length}
                onJumpToActions={() => goToTab('actions')}
                onOpenEvidence={openEvidence}
              />
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(confirmRisk)}
        onClose={() => setConfirmRisk(null)}
        title="Accept critical risk?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRisk(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={confirmRisk ? Boolean(pending[confirmRisk.id]) : false}
              onClick={async () => {
                if (confirmRisk) await doApply(confirmRisk, 'accepted');
                setConfirmRisk(null);
              }}
            >
              Accept risk
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          Accepting <strong className="text-ink">{confirmRisk?.title}</strong> marks it as a known, tolerated risk — it
          does not remove it from the report. It will keep appearing in the risk profile, the verdict reasoning and any
          exports as a critical, accepted risk.
        </p>
      </Modal>
    </div>
  );
}

function RiskCard({
  risk,
  evidence,
  expanded,
  onToggle,
  onApplyStatus,
  pending,
  relatedActionsCount,
  onJumpToActions,
  onOpenEvidence,
}: {
  risk: RiskFlag;
  evidence: EvidenceItem[];
  expanded: boolean;
  onToggle: () => void;
  onApplyStatus: (status: RiskStatus) => void;
  pending: boolean;
  relatedActionsCount: number;
  onJumpToActions: () => void;
  onOpenEvidence: (ids: string[]) => void;
}) {
  const tone = severityTone(risk.severity);
  const Icon = TONE_ICON[tone];
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <ChevronDown
            size={14}
            className={cn('mt-1 shrink-0 text-ink-muted transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={tone} icon={<Icon size={11} />}>
                {titleCase(risk.severity)}
              </Badge>
              <Badge tone="neutral">{titleCase(risk.category)}</Badge>
              <span className="font-mono text-[11px] text-ink-muted">{risk.code}</span>
              {risk.status !== 'open' ? (
                <Badge tone={risk.status === 'mitigated' ? 'good' : 'neutral'}>{titleCase(risk.status)}</Badge>
              ) : null}
            </div>
            <p className="truncate text-[13px] font-semibold text-ink">{risk.title}</p>
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-hairline px-4 py-3">
          <SplitProse text={risk.description} alwaysOpen={risk.severity === 'critical'} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-sunken p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Impact</p>
              <Prose size="sm">{risk.impact}</Prose>
            </div>
            <div className="rounded-lg bg-sunken p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Mitigation</p>
              <Prose size="sm">{risk.mitigation}</Prose>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <EvidenceLink ids={risk.evidenceIds} evidence={evidence} onOpen={onOpenEvidence} />
            {relatedActionsCount > 0 ? (
              <Button variant="ghost" size="sm" icon={<ArrowRight size={13} />} onClick={onJumpToActions}>
                {relatedActionsCount} related action{relatedActionsCount === 1 ? '' : 's'}
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            <span className="flex items-center gap-1.5 text-xs text-ink-secondary">
              Status
              {pending ? <Spinner size={11} /> : null}
            </span>
            <div className="flex gap-1">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={risk.status === s ? 'primary' : 'secondary'}
                  disabled={pending}
                  aria-pressed={risk.status === s}
                  onClick={() => onApplyStatus(s)}
                >
                  {titleCase(s)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
