import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import {
  CHECK_RESULT_LABEL,
  EVIDENCE_STATUS_LABEL,
  SCOPE_LABEL,
  type CheckResult,
  type FindingSeverity,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Modal, Select, Textarea, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { checkTone } from './shared';

const RESULTS: CheckResult[] = [
  'compliant',
  'non_compliant',
  'partially_compliant',
  'not_applicable',
  'unable_to_verify',
  'missing_evidence',
  'requires_expert_review',
];

export default function ScopeWorkspace() {
  const { ddId, scopeId } = useParams<{ ddId: string; scopeId: string }>();
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const assessment = project.assessments.find((a) => a.id === ddId);
  const scope = assessment?.scopes.find((s) => s.id === scopeId);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult>('compliant');
  const [comments, setComments] = useState('');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [severity, setSeverity] = useState<FindingSeverity>('high');
  const [busy, setBusy] = useState(false);

  if (!assessment || !scope) {
    return <Callout tone="critical" title="Scope not found">This scope is not on the assessment.</Callout>;
  }

  const check = scope.checks.find((c) => c.id === checkId);
  const evidence = project.evidence.filter((e) => e.scopeInstanceIds.includes(scope.id) || e.assessmentIds.includes(assessment.id));

  async function save() {
    if (!check) return;
    setBusy(true);
    try {
      const { project: next } = await api.recordCheck(project.id, check.id, {
        result,
        comments,
        evidenceIds,
        findingSeverity: severity,
      });
      setProject(next);
      setCheckId(null);
      toast('Check recorded', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record check', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/projects/${project.id}/dd/${assessment.id}`} className="text-[12px] text-brand">
          {assessment.name}
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-ink">{SCOPE_LABEL[scope.scopeKey]}</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Filtered view of the project registers for this scope. Completing a check can create a finding when the result is material.
        </p>
      </div>

      <Card>
        <CardHeader title="Checks" />
        <CardBody className="divide-y divide-hairline p-0">
          {scope.checks.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left hover:bg-sunken/60 coarse:min-h-11"
              onClick={() => {
                setCheckId(ch.id);
                setResult(ch.result === 'pending' ? 'compliant' : ch.result);
                setComments(ch.comments);
                setEvidenceIds([...ch.evidenceIds]);
              }}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{ch.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">{ch.section} · {ch.expectedEvidence.join(', ')}</p>
              </div>
              <Badge tone={checkTone(ch.result)}>{CHECK_RESULT_LABEL[ch.result]}</Badge>
            </button>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Evidence on this scope" />
        <CardBody className="space-y-1">
          {evidence.slice(0, 12).map((e) => (
            <div key={e.id} className="flex flex-wrap justify-between gap-2 text-[13px]">
              <span className="min-w-0">{e.title}</span>
              <Badge>{EVIDENCE_STATUS_LABEL[e.status]}</Badge>
            </div>
          ))}
          {evidence.length === 0 ? <p className="text-[13px] text-ink-muted">No evidence linked yet.</p> : null}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(check)}
        onClose={() => setCheckId(null)}
        title={check?.title ?? 'Check'}
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckId(null)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>Record result</Button>
          </>
        }
      >
        {check ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-secondary">{check.purpose}</p>
            <p className="text-[12px] text-ink-muted">Acceptance: {check.acceptanceCriteria}</p>
            <Field label="Result">
              <Select value={result} onChange={(e) => setResult(e.target.value as CheckResult)}>
                {RESULTS.map((r) => (
                  <option key={r} value={r}>{CHECK_RESULT_LABEL[r]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Comments">
              <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
            </Field>
            <Field label="Evidence used">
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
                {project.evidence.slice(0, 40).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={evidenceIds.includes(e.id)}
                      onChange={(ev) =>
                        setEvidenceIds((prev) => (ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                      }
                    />
                    {e.title}
                  </label>
                ))}
              </div>
            </Field>
            {result !== 'compliant' && result !== 'not_applicable' && result !== 'pending' ? (
              <Field label="Finding severity if a finding is created">
                <Select value={severity} onChange={(e) => setSeverity(e.target.value as FindingSeverity)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
