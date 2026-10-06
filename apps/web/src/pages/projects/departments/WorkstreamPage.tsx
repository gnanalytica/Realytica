import { useMemo } from 'react';
import { Reveal } from '../../../lib/motion';
import { DEPARTMENT_ICON } from '../../../components/departments/icons';
import { Link, Navigate, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock, FileStack, Gauge, GitCommitVertical, ListChecks, Milestone, Stamp, Waypoints } from 'lucide-react';
import {
  STAGES,
  cockpitPath,
  departmentDefinition,
  quotesForEvidence,
  stageOf,
  titleGraphFromProject,
  workstreamChecks,
  workstreamDefinition,
  workstreamDocuments,
  type DdProject,
  type StageKey,
  type WorkstreamDefinition,
} from '@realytica/shared';
import { Card, CardBody, CardHeader } from '../../../components/ui/kit';
import { QuickAssessmentCard, useQuickAssessment } from '../../../components/departments/QuickAssessmentCard';
import { CertifiedPanel } from '../../../components/departments/CertifiedPanel';
import { Connections } from '../../../components/departments/Connections';
import { WorkstreamChecks, WorkstreamDocuments, WorkstreamEngagements } from '../../../components/departments/WorkstreamRecords';
import { ApprovalsRegister } from '../../../components/departments/ApprovalsRegister';
import { ProgressBoard } from '../../../components/departments/ProgressBoard';
import { DepartmentDesk } from '../../../components/departments/DepartmentDesk';
import { TitleChainDiagram } from '../../../components/charts';
import { ScheduleOfProperty } from '../../../components/ScheduleOfProperty';
import { SectionPage, type PageSection } from '../../../components/workspace/SectionPage';
import { exampleOfWorkstream } from '../../example/paths';
import { WORKSTREAM_PANE } from '../cockpit/rail';
import { EvidenceProof } from '../EvidenceProof';
import type { ProjectOutlet } from '../ProjectLayout';

/**
 * Where a workstream lives: its own page, or the pane that has always been it.
 *
 * The graph hands back a function's key, and one function is not a
 * workstream: Design, whose page is the design department's.
 */
export function useWorkstreamNav(project: DdProject) {
  const navigate = useNavigate();
  return {
    openWorkstream: (key: string) =>
      navigate(key === 'design' ? cockpitPath(project.id, 'department', { department: 'design' }) : cockpitPath(project.id, WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key })),
    openDocument: (evidenceId: string) => navigate(cockpitPath(project.id, 'evidence', { evidenceId })),
    openCheck: (where: { ddId: string; scopeId: string; checkId: string }) => navigate(cockpitPath(project.id, 'scope', where)),
    pairPhone: () => navigate(`${cockpitPath(project.id, 'people')}#pair`),
    openFindings: () => navigate(cockpitPath(project.id, 'findings')),
    openActions: () => navigate(cockpitPath(project.id, 'actions')),
    openReports: () => navigate(cockpitPath(project.id, 'reports')),
    openReport: (reportId: string) => navigate(`${cockpitPath(project.id, 'reports')}?report=${encodeURIComponent(reportId)}`),
  };
}

/**
 * A workstream's frame, for the pages that keep a layout of their own: its
 * quick assessment and the certified report beside it, how it connects to
 * the rest of the project, and the engagements drawing on it. The technical
 * due diligence, Valuation and Site carry it; the functions laid out as one
 * page with a rail show the same pieces as sections of that page instead.
 */
export function WorkstreamFrame({ project, workstream, setProject, compact = false }: { project: DdProject; workstream: string; setProject: (p: DdProject) => void; compact?: boolean }) {
  const assessment = useQuickAssessment(project, workstream);
  const nav = useWorkstreamNav(project);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 [@container(min-width:56rem)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <QuickAssessmentCard assessment={assessment} compact={compact} />
        <CertifiedPanel project={project} workstream={workstream} onChanged={setProject} />
      </div>
      {compact ? null : <Connections project={project} workstream={workstream} onOpenWorkstream={nav.openWorkstream} />}
      <WorkstreamEngagements project={project} workstream={workstream} />
    </div>
  );
}

function ComingSoon({ project, workstream, stage }: { project: DdProject; workstream: string; stage: StageKey }) {
  const ws = workstreamDefinition(workstream)!;
  const checks = workstreamChecks(project, workstream);
  const docs = workstreamDocuments(project, workstream).filter((e) => e.attachments.length);
  // The example project has every function drawn with made-up data, this one included.
  const example = exampleOfWorkstream(workstream);
  return (
    <Card>
      <CardHeader icon={<Clock size={15} />} title={`${ws.label} is coming`} subtitle={ws.purpose} />
      <CardBody className="space-y-3 text-[13px]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">What it will produce</p>
          {/* Every stage's, with the one for the stage being looked at in the stronger ink. */}
          <ul className="mt-1 space-y-0.5">
            {ws.deliverables.map((d) => (
              <li key={`${d.stage}-${d.title}`} className={d.stage === stage ? 'font-medium text-ink' : 'text-ink-secondary'}>
                {d.title} <span className="font-normal text-ink-muted">· {STAGES.find((s) => s.key === d.stage)?.label}</span>
              </li>
            ))}
          </ul>
        </div>
        {ws.signers.length ? <p className="text-ink-secondary">Signed by: {ws.signers.join(', ')}</p> : null}
        <p className="text-ink-secondary">
          Waiting for it: {checks.length} check{checks.length === 1 ? '' : 's'}, {docs.length} document{docs.length === 1 ? '' : 's'}.
        </p>
        {example ? (
          <Link to={example} className="group inline-flex items-center gap-1 font-medium text-brand hover:underline coarse:min-h-11">
            See this page in the example project
            <ArrowRight size={13} aria-hidden className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
          </Link>
        ) : null}
      </CardBody>
    </Card>
  );
}

function TitleBody({ project, graph }: { project: DdProject; graph: ReturnType<typeof titleGraphFromProject> }) {
  // Approvals alone are context, not a chain: say what draws one instead.
  if (!graph.nodes.some((n) => n.kind === 'party' || n.kind === 'instrument' || n.kind === 'parcel')) {
    return (
      <Card>
        <CardHeader title="Title chain" subtitle="Owners, instruments and charges" />
        <CardBody>
          <p className="text-[13px] text-ink-secondary">
            Not drawn yet. Run <span className="font-medium text-ink">Value this property</span> in Finance › Valuation to build it from the deeds on file.
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Title chain" subtitle="Owners, instruments and charges, read from the deeds" />
      <CardBody className="space-y-4">
        <TitleChainDiagram graph={graph} summary={project.lastScreenResult?.titleGraph} />
        <ScheduleOfProperty graph={graph} />
      </CardBody>
    </Card>
  );
}

/** One workstream: its frame, then the work that is its own. */
export default function WorkstreamPage() {
  const { project, setProject, refresh, highlightIds, stage = stageOf(project.currentStage) } = useOutletContext<ProjectOutlet>();
  const { workstream = '' } = useParams<{ workstream: string }>();
  const nav = useWorkstreamNav(project);
  const ws = workstreamDefinition(workstream);
  if (!ws) return <Navigate to={cockpitPath(project.id, 'overview')} replace />;
  if (WORKSTREAM_PANE[ws.key]) return <Navigate to={cockpitPath(project.id, WORKSTREAM_PANE[ws.key]!)} replace />;
  const dept = departmentDefinition(ws.department);
  const DeptIcon = DEPARTMENT_ICON[ws.department];

  return (
    <div className="space-y-4">
      <Reveal>
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card ring-1 ring-[var(--ring)]" aria-hidden>
            <DeptIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-ink-muted">{dept.label}</p>
            <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{ws.label}</h2>
            <p className="mt-0.5 text-[13px] text-ink-secondary">{ws.purpose}</p>
          </div>
        </div>
      </Reveal>
      {ws.status === 'coming_soon' ? (
        <ComingSoon project={project} workstream={ws.key} stage={stage} />
      ) : ws.key === 'construction.quality' ? (
        // The technical due diligence is five steps, not one long page.
        <DepartmentDesk
          project={project}
          department="construction"
          workstream={ws.key}
          setProject={setProject}
          refresh={refresh}
          nav={{ ...nav, openSite: () => nav.openWorkstream('construction.site') }}
          frame={<WorkstreamFrame project={project} workstream={ws.key} setProject={setProject} />}
        />
      ) : (
        <FunctionSections project={project} ws={ws} setProject={setProject} highlightIds={highlightIds} />
      )}
    </div>
  );
}

/** A number for one visit to an address, so landing on the same part twice brings it into view twice. */
function visitOf(key: string): number {
  let n = 0;
  for (let i = 0; i < key.length; i += 1) n = (n * 31 + key.charCodeAt(i)) | 0;
  return n;
}

/**
 * A built function as one page with a rail: how it stands, the work that is
 * its own, then its checks, its documents and what it is joined to.
 *
 * The same parts in the same order for every function, with the centrepiece
 * differing: the approvals register, the progress board, the chain of title.
 * The rail names them, so a long page is one press from any of its parts.
 *
 * A link can land on one of them, and on one record inside it. The address
 * says which: `part` names the part, `item` a check, an approval, a milestone
 * or a site entry to light, and `evidence` a document to light and open at
 * the page cited. That is how a link in a chat answer opens the page the
 * record is on, with the record in view, and not the list of every record of
 * its kind. The ids of the parts are the ones `functionSections` gives the
 * chat; a test holds the two together.
 */
function FunctionSections({ project, ws, setProject, highlightIds }: { project: DdProject; ws: WorkstreamDefinition; setProject: (p: DdProject) => void; highlightIds?: string[] }) {
  const nav = useWorkstreamNav(project);
  const location = useLocation();
  const [query, setQuery] = useSearchParams();
  const part = query.get('part');
  const item = query.get('item');
  const openId = query.get('evidence');
  const cited = query.get('page');
  const assessment = useQuickAssessment(project, ws.key);
  const chain = useMemo(() => (ws.key === 'legal.title' ? titleGraphFromProject(project) : null), [project, ws.key]);
  /*
   * A part named in the address comes into view on the visit that named it.
   * A record marked inside it comes into view by itself, and the part then
   * stays where that put it; a record the address names that is not drawn
   * there still leaves the part in view.
   */
  const visit = visitOf(location.key);
  const jump = useMemo(() => (part ? { id: part, at: visit } : null), [part, visit]);
  // The documents to light: the one the address names, and the ones the chat has just filed or cited.
  const lit = useMemo(() => [...(openId ? [openId] : []), ...(highlightIds ?? [])], [openId, highlightIds]);
  const proof = openId ? project.evidence.find((e) => e.id === openId) : undefined;
  const proofQuotes = useMemo(() => (proof ? quotesForEvidence(project, proof.id) : []), [proof, project]);

  const centre: PageSection | null =
    ws.key === 'legal.approvals'
      ? { id: 'approvals', name: 'Approvals', icon: Stamp, body: <ApprovalsRegister project={project} onOpenDocument={nav.openDocument} marked={item} /> }
      : ws.key === 'construction.progress'
        ? { id: 'progress', name: 'Progress', icon: Milestone, body: <ProgressBoard project={project} onChanged={setProject} onPairPhone={nav.pairPhone} marked={item} /> }
        : chain?.nodes.length
          ? { id: 'chain', name: 'Chain of title', icon: GitCommitVertical, body: <TitleBody project={project} graph={chain} /> }
          : null;

  const sections: PageSection[] = [
    {
      id: 'standing',
      name: 'Estimate and certified',
      icon: Gauge,
      body: (
        <div className="grid grid-cols-1 gap-4 [@container(min-width:56rem)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <QuickAssessmentCard assessment={assessment} />
          <CertifiedPanel project={project} workstream={ws.key} onChanged={setProject} />
        </div>
      ),
    },
    ...(centre ? [centre] : []),
    { id: 'checks', name: 'Checks', icon: ListChecks, body: <WorkstreamChecks project={project} workstream={ws.key} onChanged={setProject} onOpenCheck={nav.openCheck} marked={part === 'checks' ? item : null} /> },
    { id: 'documents', name: 'Documents', icon: FileStack, body: <WorkstreamDocuments project={project} workstream={ws.key} onOpenDocument={nav.openDocument} marked={lit} landed={part === 'documents' || openId ? visit : null} /> },
    {
      id: 'connections',
      name: 'Connections',
      icon: Waypoints,
      body: (
        <>
          <Connections project={project} workstream={ws.key} onOpenWorkstream={nav.openWorkstream} />
          <WorkstreamEngagements project={project} workstream={ws.key} />
        </>
      ),
    },
  ];

  return (
    <>
      <SectionPage sections={sections} jump={jump} />
      {/* A document a link named opens over the page it belongs to, at the page cited, as it does on the register. */}
      {proof ? (
        <EvidenceProof
          projectId={project.id}
          evidence={proof}
          // The file that was read: the row's values, pages and reading are the latest file's.
          file={proof.attachments[proof.attachments.length - 1]}
          quotes={proofQuotes}
          citedPage={cited ? Number(cited) || undefined : undefined}
          onProject={setProject}
          onClose={() =>
            setQuery(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('evidence');
                next.delete('page');
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : null}
    </>
  );
}
