import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { REPORT_KIND_LABEL, type ReportKind } from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, Select, useToast } from '../../components/ui/kit';
import { ReportEditor } from './ReportEditor';
import type { ProjectOutlet } from './ProjectLayout';
import { formatWhen } from './shared';

export default function Reports() {
  const { project, setProject, onOpenCited } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('executive_dd');
  const [assessmentId, setAssessmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState<string | null>(project.reports[0]?.id ?? null);

  const view = project.reports.find((r) => r.id === viewId) ?? project.reports[0];

  async function generate() {
    setBusy(true);
    try {
      const report = await api.generateReport(project.id, {
        kind,
        assessmentIds: assessmentId ? [assessmentId] : undefined,
        generatedBy: 'operator',
      });
      const next = await api.getProject(project.id);
      setProject(next);
      setViewId(report.id);
      setOpen(false);
      toast('Report generated from live registers', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button onClick={() => setOpen(true)}>Generate report</Button>
      </div>
      {project.reports.length === 0 ? (
        <EmptyState title="No reports" description="Generate one from the current records." />
      ) : (
        /*
          Two columns only once the *pane* is wide enough to hold both, not
          once the window is. `lg:` measured the window, so on a 1024px screen
          the 16rem list took two thirds of a 388px pane and the report wrapped
          one word per line. 44rem is 16rem of list, the gap, and about 40
          characters of report left over; below it the list sits on top, where
          a handful of report names cost one line each.
        */
        <div className="grid gap-4 [@container(min-width:44rem)]:grid-cols-[16rem_minmax(0,1fr)]">
          <Card>
            <CardBody className="space-y-1 p-2">
              {project.reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setViewId(r.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-[13px] ${view?.id === r.id ? 'bg-brand-soft text-brand' : 'hover:bg-sunken'}`}
                >
                  <span className="block font-medium">{REPORT_KIND_LABEL[r.kind]}</span>
                  <span className="text-[11px] text-ink-muted">{formatWhen(r.generatedAt)}</span>
                </button>
              ))}
            </CardBody>
          </Card>
          {view ? (
            <Card>
              <CardBody>
                <ReportEditor
                  project={project}
                  report={view}
                  onChanged={async () => setProject(await api.getProject(project.id))}
                  onOpenRecord={onOpenCited}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Generate report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void generate()} disabled={busy}>Generate</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Report type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
              {Object.entries(REPORT_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Filter to assessment" hint="Leave empty to include the whole project.">
            <Select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              <option value="">All assessments</option>
              {project.assessments.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
