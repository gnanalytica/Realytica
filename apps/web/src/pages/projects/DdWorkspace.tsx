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
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Select, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { checkTone } from './shared';
import { LiveRow } from './LiveRow';

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
        <div>
          <Link to={`/projects/${project.id}/dd`} className="text-[12px] text-brand">All assessments</Link>
          <h2 className="mt-1 text-lg font-semibold text-ink">{assessment.name}</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {assessment.objective} · Target: {target} · Owner {assessment.owner}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{ASSESSMENT_STATUS_LABEL[assessment.status]}</Badge>
            <Select
            value={assessment.status}
            onChange={(e) => void setStatus(e.target.value as AssessmentStatus)}
            className="w-full sm:w-40"
          >
            {(['draft', 'active', 'in_review', 'completed', 'archived'] as AssessmentStatus[]).map((s) => (
              <option key={s} value={s}>{ASSESSMENT_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </div>
      </div>

      <p className="font-mono text-[12px] text-ink-muted">
        {progress.percent}% complete · {progress.checkDone}/{progress.checkTotal} checks · {findings.length} findings on this DD
      </p>

      {diff ? (
        <Callout tone="info" title={`Changes since ${diff.priorName}`}>
          {diff.newFindings.length} new · {diff.unresolvedFindings.length} unresolved · {diff.repeatedTitles.length} repeated titles
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {assessment.scopes.map((scope) => {
          const c = scopeCompleteness(scope);
          return (
            <Link key={scope.id} to={`scopes/${scope.id}`}>
              <LiveRow id={scope.id} highlightIds={highlightIds} variant="flush">
              <Card className="h-full transition-colors hover:bg-sunken/60">
                <CardHeader title={SCOPE_LABEL[scope.scopeKey]} subtitle={`${c.percent}% · ${c.done}/${c.total} checks`} />
                <CardBody>
                  <p className="text-[12px] text-ink-secondary">
                    {c.findings} findings from checks · {c.missing} missing-evidence results
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {scope.checks.slice(0, 6).map((ch) => (
                      <Badge key={ch.id} tone={checkTone(ch.result)}>{CHECK_RESULT_LABEL[ch.result]}</Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
              </LiveRow>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
