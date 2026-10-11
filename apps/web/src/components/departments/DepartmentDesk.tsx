import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, ClipboardList, Download, FileOutput, FileStack, MapPin, ShieldAlert, Smartphone, Upload } from 'lucide-react';
import {
  departmentDefinition,
  departmentHomeWorkstream,
  departmentReportKind,
  observations,
  observationsCsv,
  questionnaireCsv,
  questionnaireSummary,
  questionnairesOf,
  requirementSheet,
  requirementSheetCsv,
  unusedPhotos,
  type DdProject,
  type DepartmentKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { EvidenceDropZone } from '../EvidenceDropZone';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, CardHeader, StatTile, cn, useToast } from '../ui/kit';
import { EngineeringDashboard, RequirementSheetCard, SupportingDocumentsCard } from './EngineeringDesk';
import { ObservationsCard } from './ObservationsCard';
import { QuestionnaireCard } from './QuestionnaireCard';
import { SitePhotos } from './SitePhotos';
import { WorkstreamChecks, WorkstreamDocuments } from './WorkstreamRecords';

type StepKey = 'documents' | 'questions' | 'site' | 'observations' | 'report';

const STEP_KEYS: readonly StepKey[] = ['documents', 'questions', 'site', 'observations', 'report'];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface DepartmentDeskNav {
  openDocument: (evidenceId: string) => void;
  openCheck: (where: { ddId: string; scopeId: string; checkId: string }) => void;
  openFindings: () => void;
  openActions: () => void;
  /** The site record, for a department that inspects one. */
  openSite?: () => void;
  openReport: (reportId: string) => void;
  pairPhone: () => void;
}

/**
 * A department's work as the steps it is, in the order they happen: ask for
 * the documents, put the questions, inspect the site where there is one,
 * record what was found, hand over the report. One step on screen at a time,
 * each tab carrying its own count, so the page is a place to work and not a
 * scroll. Engineering's is its technical due diligence; Finance and Legal
 * run the same steps over their own documents, questions and findings.
 */
export function DepartmentDesk({
  project,
  department,
  workstream,
  setProject,
  refresh,
  nav,
  frame,
}: {
  project: DdProject;
  department: DepartmentKey;
  /** Shown inside one workstream: its own documents and checks sit in the steps too. */
  workstream?: string;
  setProject: (next: DdProject) => void;
  refresh: () => Promise<void>;
  nav: DepartmentDeskNav;
  /** The quick assessment, certified report and connections a workstream carries. */
  frame?: React.ReactNode;
}) {
  const me = useMe();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = params.get('step') as StepKey | null;
  const engineering = department === 'construction';
  const stepKeys = engineering ? STEP_KEYS : STEP_KEYS.filter((k) => k !== 'site');
  const step: StepKey = asked && stepKeys.includes(asked) ? asked : 'documents';
  const home = workstream ?? departmentHomeWorkstream(department);
  const found = engineering ? 'Observations' : 'Findings';

  const sheet = useMemo(() => requirementSheet(project, { department }), [project, department]);
  const questionnaires = useMemo(() => questionnairesOf(project, department), [project, department]);
  const latest = questionnaires[questionnaires.length - 1];
  const answers = useMemo(() => (latest ? questionnaireSummary(latest) : null), [latest]);
  const rows = useMemo(() => observations(project, department), [project, department]);
  const photos = useMemo(() => unusedPhotos(project, department), [project, department]);
  const sitePhotos = (project.siteLog ?? []).reduce((n, e) => n + e.photos.length, 0) + project.evidence.filter((e) => e.kind === 'photograph' && e.attachments.length).length;
  const log = (project.siteLog ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));

  const allSteps: Array<{ key: StepKey; label: string; count: string; icon: React.ReactNode }> = [
    { key: 'documents', label: 'Documents', count: sheet.total ? `${sheet.received}/${sheet.total}` : '—', icon: <FileStack size={14} /> },
    { key: 'questions', label: 'Questions', count: answers ? `${answers.answered}/${answers.total}` : '—', icon: <ClipboardList size={14} /> },
    { key: 'site', label: 'Site', count: sitePhotos ? `${sitePhotos} photo${sitePhotos === 1 ? '' : 's'}` : '—', icon: <MapPin size={14} /> },
    { key: 'observations', label: found, count: rows.length ? String(rows.length) : '—', icon: <ShieldAlert size={14} /> },
    { key: 'report', label: 'Report', count: '', icon: <FileOutput size={14} /> },
  ];
  const steps = allSteps.filter((s) => stepKeys.includes(s.key));

  // The department's own report: one per project is the usual case, so an existing draft is opened rather than a second made.
  const reportKind = departmentReportKind(department);
  const existing = project.reports.find((r) => r.kind === reportKind && r.status !== 'superseded' && r.status !== 'archived');
  const [creating, setCreating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function createReport() {
    if (existing) {
      nav.openReport(existing.id);
      return;
    }
    if (!reportKind) return;
    setCreating(true);
    try {
      const made = await api.generateReport(project.id, { kind: reportKind, generatedBy: me?.name ?? me?.email ?? 'operator' });
      await refresh();
      nav.openReport(made.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the report', 'critical');
    } finally {
      setCreating(false);
    }
  }

  function go(next: StepKey) {
    const p = new URLSearchParams(params);
    p.set('step', next);
    setParams(p, { replace: true });
  }

  return (
    <div className="space-y-4">
      <EngineeringDashboard project={project} department={department} show="figures" onOpenFindings={() => go('observations')} onOpenActions={nav.openActions} />

      <div role="tablist" aria-label={`${departmentDefinition(department)?.label ?? 'Department'} steps`} className="flex gap-1 overflow-x-auto rounded-2xl bg-sunken/70 p-1 ring-1 ring-inset ring-[var(--ring)]">
        {steps.map((s, i) => {
          const on = s.key === step;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => go(s.key)}
              className={cn(
                'flex min-w-[7.5rem] flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left transition-[background-color,box-shadow] duration-quick ease-state coarse:min-h-11',
                on ? 'bg-surface shadow-card ring-1 ring-[var(--ring)]' : 'hover:bg-surface/60',
              )}
            >
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] tabular-nums', on ? 'bg-ink text-surface' : 'bg-surface text-ink-secondary ring-1 ring-inset ring-[var(--ring)]')}>{i + 1}</span>
              <span className="min-w-0">
                <span className={cn('flex items-center gap-1.5 text-[13px]', on ? 'font-semibold text-ink' : 'text-ink-secondary')}>
                  {s.icon}
                  {s.label}
                </span>
                {s.count ? <span className="block font-mono text-micro tabular-nums text-ink-muted">{s.count}</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      {step === 'documents' ? (
        <>
          {/* Dropping a file anywhere on the step files it: read, typed, and matched to the line on the sheet it answers. */}
          <EvidenceDropZone projectId={project.id} rows={project.evidence} onFiled={refresh}>
            {(pick) => (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--axis)] px-3 py-2.5">
                  <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">Drop documents here, or</p>
                  <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => (pick(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
                  <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => fileInput.current?.click()}>
                    Add documents
                  </Button>
                </div>
                <RequirementSheetCard project={project} department={department} startWorkstream={home} onChanged={refresh} onOpenDocument={nav.openDocument} onOpenCheck={nav.openCheck} />
                {workstream ? <WorkstreamDocuments project={project} workstream={workstream} onOpenDocument={nav.openDocument} /> : <SupportingDocumentsCard project={project} department={department} onChanged={setProject} onOpenDocument={nav.openDocument} />}
              </div>
            )}
          </EvidenceDropZone>
        </>
      ) : null}

      {step === 'questions' ? <QuestionnaireCard project={project} department={department} onChanged={setProject} onOpenDocument={nav.openDocument} /> : null}

      {step === 'site' && nav.openSite ? (
        <>
        <Card>
          <CardHeader
            icon={<MapPin size={15} />}
            title="Site inspection"
            subtitle="Logged and photographed on site"
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="ghost" icon={<Smartphone size={13} />} onClick={nav.pairPhone}>
                  Pair a phone
                </Button>
                <Button size="sm" variant="secondary" onClick={nav.openSite}>
                  Open the site record
                </Button>
              </div>
            }
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3 [@container(min-width:44rem)]:grid-cols-4">
              <StatTile label="Site log entries" value={log.length} hint={log[0] ? `Last on ${log[0].date}` : 'None yet'} />
              <StatTile label="Visits recorded" value={project.siteVisits.length} />
              <StatTile label="Photographs" value={sitePhotos} icon={<Camera size={15} />} />
              <StatTile label="Not used yet" value={photos.length} hint={photos.length ? 'See Observations' : 'All cited'} tone={photos.length ? 'warning' : 'neutral'} />
            </div>
            {log.length ? (
              <ul className="divide-y divide-hairline rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                {log.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                    <span className="font-mono text-micro tabular-nums text-ink-secondary">{entry.date}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={entry.workDone}>
                      {entry.workDone || 'No note'}
                    </span>
                    <span className="text-micro text-ink-muted">
                      {entry.author}
                      {entry.photos.length ? ` · ${entry.photos.length} photo${entry.photos.length === 1 ? '' : 's'}` : ''}
                      {entry.issues.length ? ` · ${entry.issues.length} issue${entry.issues.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-secondary">Nothing from site yet. Pair a phone to start.</p>
            )}
            {photos.length ? (
              <Button size="sm" variant="primary" onClick={() => go('observations')}>
                Use {photos.length} in observations
              </Button>
            ) : null}
          </CardBody>
        </Card>
        <SitePhotos project={project} refresh={refresh} onChanged={setProject} />
        </>
      ) : null}

      {step === 'observations' ? (
        <>
          <ObservationsCard project={project} department={department} onChanged={setProject} onOpenDocument={nav.openDocument} />
          <EngineeringDashboard project={project} department={department} show="charts" onOpenFindings={nav.openFindings} onOpenActions={nav.openActions} />
          {workstream ? <WorkstreamChecks project={project} workstream={workstream} onChanged={setProject} onOpenCheck={nav.openCheck} /> : null}
        </>
      ) : null}

      {step === 'report' ? (
        <>
          <Card>
            <CardHeader
              icon={<FileOutput size={15} />}
              title="Hand-over"
              subtitle="Built from the steps before it"
              action={
                reportKind ? (
                  <Button size="sm" variant="primary" loading={creating} onClick={() => void createReport()}>
                    {existing ? 'Open the report' : 'Create the report'}
                  </Button>
                ) : null
              }
            />
            <CardBody>
              <ul className="divide-y divide-hairline">
                <li className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    {engineering ? 'Observations and mitigations' : 'Findings and what to do about them'}
                    <span className="block text-micro text-ink-muted">{rows.length ? `${rows.length} recorded` : 'None recorded yet'}</span>
                  </span>
                  <Button size="sm" variant="secondary" icon={<Download size={13} />} disabled={!rows.length} onClick={() => download(`${project.reference}-${department}-${engineering ? 'observations' : 'findings'}.csv`, observationsCsv(project, rows))}>
                    Export
                  </Button>
                </li>
                <li className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    Answered questionnaire
                    <span className="block text-micro text-ink-muted">{latest && answers ? `${latest.title}: ${answers.answered} of ${answers.total} answered` : 'No questionnaire imported'}</span>
                  </span>
                  <Button size="sm" variant="secondary" icon={<Download size={13} />} disabled={!latest} onClick={() => latest && download(`${project.reference}-${department}-questionnaire.csv`, questionnaireCsv(project, latest))}>
                    Export
                  </Button>
                </li>
                <li className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    Document requirement sheet
                    <span className="block text-micro text-ink-muted">{sheet.total ? `${sheet.received} of ${sheet.total} in hand` : 'Nothing expected yet'}</span>
                  </span>
                  <Button size="sm" variant="secondary" icon={<Download size={13} />} disabled={!sheet.total} onClick={() => download(`${project.reference}-${department}-requirement-sheet.csv`, requirementSheetCsv(sheet))}>
                    Export
                  </Button>
                </li>
              </ul>
            </CardBody>
          </Card>
          {frame}
        </>
      ) : null}
    </div>
  );
}
