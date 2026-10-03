import { useMemo } from 'react';
import { Reveal } from '../../../lib/motion';
import { DEPARTMENT_ICON } from '../../../components/departments/icons';
import { Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Clock } from 'lucide-react';
import {
  STAGES,
  cockpitPath,
  departmentDefinition,
  titleGraphFromProject,
  workstreamChecks,
  workstreamDefinition,
  workstreamDocuments,
  type DdProject,
} from '@realytica/shared';
import { Card, CardBody, CardHeader } from '../../../components/ui/kit';
import { QuickAssessmentCard, useQuickAssessment } from '../../../components/departments/QuickAssessmentCard';
import { CertifiedPanel } from '../../../components/departments/CertifiedPanel';
import { Connections } from '../../../components/departments/Connections';
import { WorkstreamChecks, WorkstreamDocuments, WorkstreamEngagements } from '../../../components/departments/WorkstreamRecords';
import { ApprovalsRegister } from '../../../components/departments/ApprovalsRegister';
import { ProgressBoard } from '../../../components/departments/ProgressBoard';
import { TitleChainDiagram } from '../../../components/charts';
import { ScheduleOfProperty } from '../../../components/ScheduleOfProperty';
import { WORKSTREAM_PANE } from '../cockpit/rail';
import type { ProjectOutlet } from '../ProjectLayout';

/** Where a workstream lives: its own page, or the pane that has always been it. */
export function useWorkstreamNav(project: DdProject) {
  const navigate = useNavigate();
  return {
    openWorkstream: (key: string) => navigate(cockpitPath(project.id, WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key })),
    openDocument: (evidenceId: string) => navigate(cockpitPath(project.id, 'evidence', { evidenceId })),
    openCheck: (where: { ddId: string; scopeId: string; checkId: string }) => navigate(cockpitPath(project.id, 'scope', where)),
    pairPhone: () => navigate(`${cockpitPath(project.id, 'people')}#pair`),
  };
}

/**
 * The frame every live workstream shares: its quick assessment and the
 * certified report beside it, how it connects to the rest of the project, and
 * the engagements drawing on it. The Value and Site pages carry it too.
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

function ComingSoon({ project, workstream }: { project: DdProject; workstream: string }) {
  const ws = workstreamDefinition(workstream)!;
  const checks = workstreamChecks(project, workstream);
  const docs = workstreamDocuments(project, workstream).filter((e) => e.attachments.length);
  return (
    <Card>
      <CardHeader icon={<Clock size={15} />} title={`${ws.label} is coming`} subtitle={ws.purpose} />
      <CardBody className="space-y-3 text-[13px]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">What it will produce</p>
          <ul className="mt-1 space-y-0.5">
            {ws.deliverables.map((d) => (
              <li key={`${d.stage}-${d.title}`} className="text-ink">
                {d.title} <span className="text-ink-muted">· {STAGES.find((s) => s.key === d.stage)?.label}</span>
              </li>
            ))}
          </ul>
        </div>
        {ws.signers.length ? <p className="text-ink-secondary">Signed by: {ws.signers.join(', ')}</p> : null}
        <p className="text-ink-secondary">
          Already on the file and waiting for it: {checks.length} check{checks.length === 1 ? '' : 's'} and {docs.length} document{docs.length === 1 ? '' : 's'}. They stay where they are and move here when it opens.
        </p>
      </CardBody>
    </Card>
  );
}

function TitleBody({ project }: { project: DdProject }) {
  const graph = useMemo(() => titleGraphFromProject(project), [project]);
  if (!graph.nodes.length) return null;
  // Approvals alone are context, not a chain: say what draws one instead.
  if (!graph.nodes.some((n) => n.kind === 'party' || n.kind === 'instrument' || n.kind === 'parcel')) {
    return (
      <Card>
        <CardHeader title="Title chain" subtitle="Owners, the instruments between them, and what charges the land" />
        <CardBody>
          <p className="text-[13px] text-ink-secondary">
            Not drawn yet. The chain is built when the deeds and encumbrance certificates on file are checked against the state&rsquo;s title rules — run <span className="font-medium text-ink">Value this property</span> from Finance › Valuation, and each sale, its parties and the charges on the land appear here with the page they were read from.
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Title chain" subtitle="Owners, the instruments between them, and what charges the land — read from the deeds and encumbrance certificates" />
      <CardBody className="space-y-4">
        <TitleChainDiagram graph={graph} summary={project.lastScreenResult?.titleGraph} />
        <ScheduleOfProperty graph={graph} />
      </CardBody>
    </Card>
  );
}

/** One workstream: its frame, then the work that is its own. */
export default function WorkstreamPage() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
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
        <ComingSoon project={project} workstream={ws.key} />
      ) : (
        <>
          <WorkstreamFrame project={project} workstream={ws.key} setProject={setProject} />
          {ws.key === 'legal.approvals' ? <ApprovalsRegister project={project} onOpenDocument={nav.openDocument} /> : null}
          {ws.key === 'construction.progress' ? <ProgressBoard project={project} onChanged={setProject} onPairPhone={nav.pairPhone} /> : null}
          {ws.key === 'legal.title' ? <TitleBody project={project} /> : null}
          <div className="grid grid-cols-1 gap-4 [@container(min-width:56rem)]:grid-cols-2">
            <WorkstreamChecks project={project} workstream={ws.key} onChanged={setProject} onOpenCheck={nav.openCheck} />
            <WorkstreamDocuments project={project} workstream={ws.key} onOpenDocument={nav.openDocument} />
          </div>
        </>
      )}
    </div>
  );
}
