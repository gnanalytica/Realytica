import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ACTION_KIND_LABEL,
  ACTION_STATUS_LABEL,
  DECISION_STATUS_LABEL,
  DECISION_TYPE_LABEL,
  IMPACT_TYPE_LABEL,
  REMEDIAL_BANDS,
  REMEDIAL_BAND_LABEL,
  RISK_STATUS_LABEL,
  SEVERITY_LABEL,
  remedialCostSummary,
  type ActionKind,
  type ActionRecord,
  type ActionStatus,
  type DecisionStatus,
  type DecisionType,
  type DdRiskStatus,
  type FindingSeverity,
  type Probability,
  type RemedialBand,
  type RiskImpactType,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { OwnerInput } from '../../components/OwnerInput';
import { RemedialCostChart } from '../../components/charts';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { severityTone } from './shared';
import { LiveRow } from './LiveRow';

export function RisksActions() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const [searchParams] = useSearchParams();
  const liveIds = [
    ...(highlightIds ?? []),
    ...(searchParams.get('risk') ? [searchParams.get('risk')!] : []),
    ...(searchParams.get('action') ? [searchParams.get('action')!] : []),
  ];
  const toast = useToast();
  const [riskOpen, setRiskOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [cause, setCause] = useState('');
  const [category, setCategory] = useState<RiskImpactType>('cost');
  const [probability, setProbability] = useState<Probability>('possible');
  const [impactScore, setImpactScore] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [materiality, setMateriality] = useState<FindingSeverity>('high');
  const [actionTitle, setActionTitle] = useState('');
  const [actionOwner, setActionOwner] = useState('');
  const [actionKind, setActionKind] = useState<ActionKind>('remediation');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function addRisk() {
    setBusy(true);
    try {
      await api.addRisk(project.id, {
        title,
        cause,
        category,
        impactType: category,
        probability,
        impactScore,
        materiality,
      });
      setProject(await api.getProject(project.id));
      setRiskOpen(false);
      setTitle('');
      setCause('');
      toast('Risk added', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add risk', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function addAction() {
    setBusy(true);
    try {
      await api.addAction(project.id, {
        title: actionTitle,
        kind: actionKind,
        owner: actionOwner,
        priority: materiality,
        dueDate: dueDate || undefined,
      });
      setProject(await api.getProject(project.id));
      setActionOpen(false);
      setActionTitle('');
      toast('Action added', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add action', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function setCost(id: string, body: { costEstimate?: number | null; costBand?: RemedialBand | null }) {
    try {
      await api.setActionCost(project.id, id, body);
      setProject(await api.getProject(project.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not price the action', 'critical');
    }
  }

  const costSummary = useMemo(() => remedialCostSummary(project), [project]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setActionOpen(true)}>Add action</Button>
        <Button onClick={() => setRiskOpen(true)}>Add risk</Button>
      </div>
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Risks</h2>
        {project.risks.length === 0 ? (
          <EmptyState title="No risks" description="Convert findings into scored risks on the project register." />
        ) : (
          <Card>
            <CardBody className="divide-y divide-hairline p-0">
              {project.risks.map((r) => (
                <LiveRow key={r.id} id={r.id} highlightIds={liveIds} variant="flush" className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{r.title}</p>
                    <p className="text-[12px] text-ink-secondary">{r.cause}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {IMPACT_TYPE_LABEL[r.category]} · P {r.probability} · impact {r.impactScore} · {r.findingIds.length} finding(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={severityTone(r.materiality)}>{SEVERITY_LABEL[r.materiality]}</Badge>
                    <Select value={r.status} onChange={(e) => void api.patchRisk(project.id, r.id, e.target.value).then(async () => setProject(await api.getProject(project.id)))}>
                      {(Object.keys(RISK_STATUS_LABEL) as DdRiskStatus[]).map((s) => (
                        <option key={s} value={s}>{RISK_STATUS_LABEL[s]}</option>
                      ))}
                    </Select>
                  </div>
                </LiveRow>
              ))}
            </CardBody>
          </Card>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Actions</h2>
        {project.actions.length === 0 ? (
          <EmptyState title="No actions" description="Actions turn findings and risks into owned work." />
        ) : (
          <>
            <Card>
              <CardBody className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-ink-muted">Remedial cost by band</p>
                <RemedialCostChart summary={costSummary} />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="divide-y divide-hairline p-0">
                {project.actions.map((a) => (
                  <LiveRow key={a.id} id={a.id} highlightIds={liveIds} variant="flush" className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{a.title}</p>
                        <p className="text-[12px] text-ink-muted">{a.owner}{a.dueDate ? ` · due ${a.dueDate}` : ''} · {ACTION_KIND_LABEL[a.kind]}</p>
                      </div>
                      <Select value={a.status} onChange={(e) => void api.patchAction(project.id, a.id, e.target.value).then(async () => setProject(await api.getProject(project.id)))}>
                        {(Object.keys(ACTION_STATUS_LABEL) as ActionStatus[]).map((s) => (
                          <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>
                        ))}
                      </Select>
                    </div>
                    <ActionCost action={a} currency={project.currency} onChange={(body) => void setCost(a.id, body)} />
                  </LiveRow>
                ))}
              </CardBody>
            </Card>
          </>
        )}
      </section>

      <Modal open={riskOpen} onClose={() => setRiskOpen(false)} title="Add risk" footer={<><Button variant="ghost" onClick={() => setRiskOpen(false)}>Cancel</Button><Button onClick={() => void addRisk()} disabled={busy || !title.trim() || !cause.trim()}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Cause"><Textarea value={cause} onChange={(e) => setCause(e.target.value)} rows={3} /></Field>
          <Field label="Impact category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as RiskImpactType)}>
              {Object.entries(IMPACT_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Probability">
            <Select value={probability} onChange={(e) => setProbability(e.target.value as Probability)}>
              {(['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as Probability[]).map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Impact score">
            <Select value={String(impactScore)} onChange={(e) => setImpactScore(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal open={actionOpen} onClose={() => setActionOpen(false)} title="Add action" footer={<><Button variant="ghost" onClick={() => setActionOpen(false)}>Cancel</Button><Button onClick={() => void addAction()} disabled={busy || !actionTitle.trim() || !actionOwner.trim()}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} /></Field>
          <Field label="Owner"><OwnerInput value={actionOwner} onChange={setActionOwner} project={project} /></Field>
          <Field label="Kind">
            <Select value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)}>
              {Object.entries(ACTION_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}

export function DecisionRegister() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [decisionType, setDecisionType] = useState<DecisionType>('proceed');
  const [decisionMaker, setDecisionMaker] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api.addDecision(project.id, { title, rationale, decisionType, decisionMaker });
      setProject(await api.getProject(project.id));
      setOpen(false);
      toast('Decision recorded', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add decision', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>Record decision</Button>
      </div>
      {project.decisions.length === 0 ? (
        <EmptyState title="No decisions" description="Proceed, hold payment, conditions — recorded against the evidence and findings that supported them." />
      ) : (
        <Card>
          <CardBody className="divide-y divide-hairline p-0">
            {project.decisions.map((d) => (
              <div key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">{d.title}</p>
                  <p className="text-[12px] text-ink-secondary">{d.rationale}</p>
                  <p className="mt-1 text-[11px] text-ink-muted">{DECISION_TYPE_LABEL[d.decisionType]} · {d.decisionMaker}</p>
                </div>
                <Select value={d.status} onChange={(e) => void api.patchDecision(project.id, d.id, e.target.value).then(async () => setProject(await api.getProject(project.id)))}>
                  {(Object.keys(DECISION_STATUS_LABEL) as DecisionStatus[]).map((s) => (
                    <option key={s} value={s}>{DECISION_STATUS_LABEL[s]}</option>
                  ))}
                </Select>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Record decision" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void add()} disabled={busy || !title.trim() || !rationale.trim() || !decisionMaker.trim()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Type">
            <Select value={decisionType} onChange={(e) => setDecisionType(e.target.value as DecisionType)}>
              {Object.entries(DECISION_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Decision maker"><Input value={decisionMaker} onChange={(e) => setDecisionMaker(e.target.value)} /></Field>
          <Field label="Rationale"><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The figure and the band, edited where the action already lives.
 *
 * Deliberately not in the "add action" modal. An action is raised the moment a
 * defect is found and priced days later, once somebody has actually asked a
 * contractor — a cost box on the creation form would either delay raising the
 * action or collect a guess, and a guess in this field is the number that ends
 * up in front of a buyer.
 *
 * The band can be set without a figure and the figure without a band, because
 * both halves genuinely arrive separately: "this is before completion, price
 * unknown" is a real and useful state, and the summary counts it rather than
 * treating it as nothing.
 */
function ActionCost({
  action,
  currency,
  onChange,
}: {
  action: ActionRecord;
  currency: string;
  onChange: (body: { costEstimate?: number | null; costBand?: RemedialBand | null }) => void;
}) {
  const [draft, setDraft] = useState(action.costEstimate === undefined ? '' : String(action.costEstimate));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-ink-muted">
      <Select
        className="h-6 text-[11px]"
        value={action.costBand ?? ''}
        onChange={(e) => onChange({ costBand: (e.target.value || null) as RemedialBand | null })}
      >
        <option value="">No cost band</option>
        {REMEDIAL_BANDS.map((b) => (
          <option key={b} value={b}>{REMEDIAL_BAND_LABEL[b]}</option>
        ))}
      </Select>
      <span className="flex items-center gap-1.5">
        {currency}
        <Input
          className="h-6 w-32 text-[11px]"
          inputMode="decimal"
          placeholder="Estimate"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed === '') {
              if (action.costEstimate !== undefined) onChange({ costEstimate: null });
              return;
            }
            const next = Number(trimmed.replace(/[,\s]/g, ''));
            // A figure that will not parse is left in the box rather than
            // silently becoming zero — zero is a claim that the remedy is free.
            if (!Number.isFinite(next) || next < 0) return;
            if (next !== action.costEstimate) onChange({ costEstimate: next });
          }}
        />
      </span>
      {action.costBand && action.costEstimate === undefined ? <span className="text-status-warning">banded, not yet priced</span> : null}
    </div>
  );
}
