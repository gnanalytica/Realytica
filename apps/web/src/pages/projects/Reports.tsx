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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          A report is half alive. Sections with a coloured rail read the registers and update as the file does; the rest are
          your words and nothing regenerates them. Detach a live section when you need to say it differently — the report
          will show that it stopped updating.
        </p>
        <Button onClick={() => setOpen(true)}>Generate report</Button>
      </div>
      {project.reports.length === 0 ? (
        <EmptyState title="No reports" description="Generate an executive, red-flag, evidence, or changes-since-previous view from the current records." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
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
