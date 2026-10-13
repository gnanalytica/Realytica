import { useCallback, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { Navigate, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { DEPARTMENT_SHORT, REPORT_KIND_LABEL, cockpitPath, functionReportTemplates, preparedReportSaid, statusReportPeriodSaid, workstreamDefinition, type ReportKind } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, EmptyState, Field, Modal, Select, toneText, useToast } from '../../components/ui/kit';
import { OwnerPacks } from './OwnerPacks';
import { ReportEditor } from './ReportEditor';
import Outgoing from './Outgoing';
import { LETTERS_PART } from './cockpit/rail';
import type { ProjectOutlet } from './ProjectLayout';
import { formatWhen } from './shared';

/**
 * Everything that leaves the project as a document: DD / status reports from the
 * registers, the owner pack for a month or a quarter with the ones kept, and letters / RFIs / minutes. One page, no sub-tabs.
 */
export default function Reports() {
  const { project, setProject, onOpenCited } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('executive_dd');
  const [assessmentId, setAssessmentId] = useState('');
  const [busy, setBusy] = useState(false);
  // A function's report is laid out by a template declared beside its fields.
  const templates = useMemo(
    () =>
      functionReportTemplates().map((template) => {
        const workstream = workstreamDefinition(template.fn);
        return { id: template.id, label: `${workstream ? `${DEPARTMENT_SHORT[workstream.department]} › ` : ''}${template.title}` };
      }),
    [],
  );
  const [template, setTemplate] = useState(templates[0]?.id ?? '');
  const wording = useAsync(() => api.reportSettings(), []);
  const me = useMe();
  const [params, setParams] = useSearchParams();
  // A report is named on the address by the list here (`report`) or by a link in a chat answer (`item`), which may name a kept owner pack instead.
  const named = params.get('report') ?? params.get('item');
  const view = project.reports.find((r) => r.id === named) ?? project.reports[0];

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
        ...(kind === 'function' ? { template } : {}),
        assessmentIds: assessmentId && kind !== 'function' ? [assessmentId] : undefined,
        generatedBy: me?.name ?? me?.email ?? 'operator',
      });
      const next = await api.getProject(project.id);
      setProject(next);
      show(report.id);
      setOpen(false);
      toast('Report written from the record', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not write the report', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* The owner pack first: checking and issuing it is what is done on this page each month. It reads cost, meetings and papers owed, none of which an outside collaborator is handed. */}
      {me && me.role !== 'collaborator' ? <OwnerPacks project={project} setProject={setProject} marked={named} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Other reports</h2>
            <p className="text-[13px] text-ink-secondary">Status, due diligence and function reports, put together by code from the record and the fields. The monthly Cost Report is on Finance › Budget.</p>
            {/* No model has a hand in a report. A firm whose reports kept a model's wording from before is told, and may take it off. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted">
              <span>No model writes any line of a report.</span>
              {wording.data?.modelWording && wording.data.maySet ? (
                <button
                  type="button"
                  className="underline hover:text-ink"
                  onClick={() => {
                    void api
                      .setReportSettings(false)
                      .then(async () => {
                        await wording.refresh();
                        setProject(await api.getProject(project.id));
                        toast('A model’s wording is off every report not yet issued', 'good');
                      })
                      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Could not change that', 'critical'));
                  }}
                >
                  Take a model’s earlier wording off reports not yet issued
                </button>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => navigate(cockpitPath(project.id, 'workstream', { workstream: 'finance.budget' }))}>
              Cost Report
            </Button>
            <Button onClick={() => setOpen(true)}>New report</Button>
          </div>
        </div>

        {project.reports.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileText size={18} />}
              title="No reports yet"
              description="Start one here, from a department’s Report step, or ask the chat for this month’s status."
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
                    <span className="block font-medium">{r.kind === 'function' ? r.title.replace(/ — .*$/, '') : REPORT_KIND_LABEL[r.kind]}</span>
                    <span className="text-[11px] text-ink-muted">
                      {(r.kind === 'status' ? statusReportPeriodSaid(r) : undefined) ?? formatWhen(r.generatedAt)}
                      {preparedReportSaid(project, r) ? <span className={`block ${toneText('warning')}`}>{preparedReportSaid(project, r)}</span> : null}
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
          <h2 className="text-[15px] font-semibold text-ink">{LETTERS_PART.label}</h2>
          <p className="text-[13px] text-ink-secondary">Replies, RFIs and minutes filled from the record. Nothing is emailed from here.</p>
        </div>
        <Outgoing embedded />
      </section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              Write it
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
          {kind === 'function' ? (
            <Field label="Which report" hint="Laid out from the function’s fields. You can move, add and remove sections afterwards.">
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Only one due diligence" hint="Leave empty for the whole project.">
              <Select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
                <option value="">The whole project</option>
                {project.assessments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
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
