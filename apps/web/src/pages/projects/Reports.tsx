import { useCallback, useState } from 'react';
import { FileText } from 'lucide-react';
import { Navigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { REPORT_KIND_LABEL, cockpitPath, statusReportPeriodSaid, type ReportKind } from '@realytica/shared';
import { api } from '../../lib/api';
import { Button, Card, CardBody, EmptyState, Field, Modal, Select, useToast } from '../../components/ui/kit';
import { ReportEditor } from './ReportEditor';
import Outgoing from './Outgoing';
import type { ProjectOutlet } from './ProjectLayout';
import { formatWhen } from './shared';

/**
 * Everything that leaves the project as a document: DD / status reports from the
 * registers, and letters / RFIs / minutes. One page, no sub-tabs.
 */
export default function Reports() {
  const { project, setProject, onOpenCited } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('executive_dd');
  const [assessmentId, setAssessmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = project.reports.find((r) => r.id === params.get('report')) ?? project.reports[0];

  const show = useCallback(
    (id: string) =>
      setParams((was) => {
        const out = new URLSearchParams(was);
        out.delete('side');
        out.delete('draft');
        out.set('report', id);
        return out;
      }),
    [setParams],
  );

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
      show(report.id);
      setOpen(false);
      toast('Report generated from live registers', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Reports</h2>
            <p className="text-[13px] text-ink-secondary">DD and status reports built from the registers on this project.</p>
          </div>
          <Button onClick={() => setOpen(true)}>Generate report</Button>
        </div>
        {project.reports.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileText size={18} />}
              title="No reports yet"
              description="Generate one here, or from a department’s Report step."
              action={
                <Button variant="primary" onClick={() => setOpen(true)}>
                  Generate a report
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 [@container(min-width:44rem)]:grid-cols-[16rem_minmax(0,1fr)]">
            <Card>
              <CardBody className="space-y-1 p-2">
                {project.reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => show(r.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-[13px] ${view?.id === r.id ? 'bg-brand-soft text-brand' : 'hover:bg-sunken'}`}
                  >
                    <span className="block font-medium">{REPORT_KIND_LABEL[r.kind]}</span>
                    <span className="text-[11px] text-ink-muted">
                      {(r.kind === 'status' ? statusReportPeriodSaid(r) : undefined) ?? formatWhen(r.generatedAt)}
                    </span>
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
      </section>

      <section className="space-y-3 border-t border-hairline pt-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Letters</h2>
          <p className="text-[13px] text-ink-secondary">Replies, RFIs and minutes filled from the record. Nothing is emailed from here.</p>
        </div>
        <Outgoing embedded />
      </section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Generate report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void generate()} disabled={busy}>
              Generate
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Report type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
              {Object.entries(REPORT_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Filter to assessment" hint="Leave empty to include the whole project.">
            <Select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              <option value="">All assessments</option>
              {project.assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/** Old /outgoing URLs land on Reports (letters section). */
export function OutgoingRedirect() {
  const { project } = useOutletContext<ProjectOutlet>();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.delete('side');
  const q = next.toString();
  return <Navigate to={`${cockpitPath(project.id, 'reports')}${q ? `?${q}` : ''}`} replace />;
}
