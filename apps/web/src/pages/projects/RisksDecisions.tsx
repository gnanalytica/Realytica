import { useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ACTION_KIND_LABEL,
  ACTION_STATUS_LABEL,
  DECISION_STATUS_LABEL,
  DECISION_TYPE_LABEL,
  IMPACT_TYPE_LABEL,
  RISK_STATUS_LABEL,
  SEVERITY_LABEL,
  type ActionKind,
  type ActionStatus,
  type DecisionStatus,
  type DecisionType,
  type DdRiskStatus,
  type FindingSeverity,
  type Probability,
  type RiskImpactType,
} from '@realytica/shared';
import { api } from '../../lib/api';
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
          <Card>
            <CardBody className="divide-y divide-hairline p-0">
              {project.actions.map((a) => (
                <LiveRow key={a.id} id={a.id} highlightIds={liveIds} variant="flush" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{a.title}</p>
                    <p className="text-[12px] text-ink-muted">{a.owner}{a.dueDate ? ` · due ${a.dueDate}` : ''} · {ACTION_KIND_LABEL[a.kind]}</p>
                  </div>
                  <Select value={a.status} onChange={(e) => void api.patchAction(project.id, a.id, e.target.value).then(async () => setProject(await api.getProject(project.id)))}>
                    {(Object.keys(ACTION_STATUS_LABEL) as ActionStatus[]).map((s) => (
                      <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>
                    ))}
                  </Select>
                </LiveRow>
              ))}
            </CardBody>
          </Card>
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
          <Field label="Owner"><Input value={actionOwner} onChange={(e) => setActionOwner(e.target.value)} /></Field>
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
