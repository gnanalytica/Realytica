import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import {
  ASSESSMENT_STATUS_LABEL,
  CHECK_RESULT_LABEL,
  SCOPE_LABEL,
  assessmentProgress,
  filterFindings,
  scopeCompleteness,
  type AssessmentStatus,
  type CheckResult,
  type ScopeInstance,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Callout, Card, CardBody, Select, TONE_FILL, cn, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { checkTone } from './shared';
import { LiveRow } from './LiveRow';

/**
 * A scope's checks as one bar rather than a row of identical pills.
 *
 * Six "Not started" badges say the same thing six times and crowd out the one
 * badge that matters. A segment per result keeps the colour — which is the
 * part a reader actually scans for — and spends a single line on it.
 */
function ResultBar({ scope }: { scope: ScopeInstance }) {
  // Recorded results only. A pending check is the empty part of the track: it
  // must not be given a colour, because every colour in this product means a
  // verdict and "not started" is the absence of one.
  const order: CheckResult[] = [
    'non_compliant',
    'requires_expert_review',
    'partially_compliant',
    'missing_evidence',
    'unable_to_verify',
    'compliant',
    'not_applicable',
  ];
  const total = scope.checks.length;
  if (total === 0) return null;
  const segments = order
    .map((result) => ({ result, n: scope.checks.filter((c) => c.result === result).length }))
    .filter((s) => s.n > 0);
  const pending = scope.checks.filter((c) => c.result === 'pending').length;

  return (
    <div>
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-sunken">
        {segments.map((s) => (
          <span
            key={s.result}
            title={`${s.n} ${CHECK_RESULT_LABEL[s.result].toLowerCase()}`}
            className={cn('block h-1.5', TONE_FILL[checkTone(s.result)])}
            style={{ width: `${(s.n / total) * 100}%`, minWidth: 3 }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-ink-secondary">
        {[
          ...segments.map((s) => `${s.n} ${CHECK_RESULT_LABEL[s.result].toLowerCase()}`),
          pending > 0 ? `${pending} not started` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

export default function DdWorkspace() {
  const { ddId } = useParams<{ ddId: string }>();
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const assessment = project.assessments.find((a) => a.id === ddId);
  const [diff, setDiff] = useState<Awaited<ReturnType<typeof api.assessmentChanges>> | null | undefined>(undefined);

  useEffect(() => {
    if (!assessment?.priorAssessmentId) return;
    void api.assessmentChanges(project.id, assessment.id).then(setDiff).catch(() => setDiff(null));
  }, [assessment?.id, assessment?.priorAssessmentId, project.id]);

  if (!assessment) {
    return <Callout tone="critical" title="Assessment not found">This DD is not on the project.</Callout>;
  }

  const progress = assessmentProgress(assessment);
  const findings = filterFindings(project, { assessmentId: assessment.id });
  const target =
    assessment.targetType === 'project'
      ? 'Whole project'
      : assessment.targetAssetIds.map((id) => project.assets.find((a) => a.id === id)?.name ?? id).join(', ');

  async function setStatus(status: AssessmentStatus) {
    try {
      await api.setAssessmentStatus(project.id, assessment!.id, status);
      setProject(await api.getProject(project.id));
      toast('Assessment status updated', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'critical');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{assessment.name}</h2>
          <p className="tabular mt-1 text-[12.5px] text-ink-secondary">
            {target} · {assessment.owner} · {progress.checkDone}/{progress.checkTotal} checks · {findings.length} findings
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge>{ASSESSMENT_STATUS_LABEL[assessment.status]}</Badge>
          <Select
            value={assessment.status}
            onChange={(e) => void setStatus(e.target.value as AssessmentStatus)}
            aria-label="Assessment status"
            className="w-full sm:w-40"
          >
            {(['draft', 'active', 'in_review', 'completed', 'archived'] as AssessmentStatus[]).map((s) => (
              <option key={s} value={s}>{ASSESSMENT_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </div>
      </div>

      {diff ? (
        <Callout tone="info" title={`Changes since ${diff.priorName}`}>
          {diff.newFindings.length} new · {diff.unresolvedFindings.length} unresolved · {diff.repeatedTitles.length} repeated titles
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {assessment.scopes.map((scope) => {
          const c = scopeCompleteness(scope);
          return (
            <LiveRow key={scope.id} id={scope.id} highlightIds={highlightIds} variant="flush">
              <Link to={`scopes/${scope.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-sunken/60">
                  <CardBody className="space-y-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[13px] font-semibold text-ink">{SCOPE_LABEL[scope.scopeKey]}</p>
                      <p className="tabular shrink-0 text-[12px] text-ink-muted">{c.done}/{c.total}</p>
                    </div>
                    <ResultBar scope={scope} />
                    {c.findings > 0 || c.missing > 0 ? (
                      <p className="text-[11.5px] text-ink-muted">
                        {[c.findings > 0 ? `${c.findings} findings` : null, c.missing > 0 ? `${c.missing} missing evidence` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </Link>
            </LiveRow>
          );
        })}
      </div>
    </div>
  );
}
