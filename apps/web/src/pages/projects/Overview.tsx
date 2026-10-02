import { Suspense, lazy, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  DEPARTMENTS,
  LIFECYCLE_STAGE_LABEL,
  QUICK_VERDICT_LABEL,
  cockpitPath,
  currentCertified,
  projectDepartments,
  quickAssessment,
  stageAndStep,
  type DdProject,
  type DepartmentDefinition,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Card, CardBody, CardHeader, Disclosure, Skeleton, cn } from '../../components/ui/kit';
import { KeyFacts, NeedsDecisionCard, OpenItemsCard, RecentActivityCard, WaitingOnCard } from '../../components/project/ProjectPanels';
import { EngagementsCard } from '../../components/project/EngagementEditor';
import { VERDICT_TONE } from '../../components/departments/QuickAssessmentCard';
import { WORKSTREAM_PANE } from './cockpit/rail';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

/* The map carries Leaflet. Lazy, so the rest of the overview paints first. */
const GisOverlayCard = lazy(() => import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })));

function DepartmentCard({ project, dept }: { project: DdProject; dept: DepartmentDefinition }) {
  const navigate = useNavigate();
  const live = dept.workstreams.filter((w) => w.status === 'live');
  const rows = useMemo(() => dept.workstreams.filter((w) => w.status === 'live').map((w) => ({ ws: w, qa: quickAssessment(project, w.key), certified: currentCertified(project, w.key) })), [project, dept]);
  const open = (key: string) => navigate(cockpitPath(project.id, WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key }));
  return (
    <Card>
      <CardHeader
        title={dept.label}
        subtitle={dept.status === 'live' ? `${live.length} workstream${live.length === 1 ? '' : 's'} in use` : 'Coming soon'}
        action={
          <button type="button" onClick={() => navigate(cockpitPath(project.id, 'department', { department: dept.key }))} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            Open <ArrowRight size={12} />
          </button>
        }
      />
      <CardBody className="p-0">
        {rows.length ? (
          <ul className="divide-y divide-hairline">
            {rows.map(({ ws, qa, certified }) => (
              <li key={ws.key}>
                <button type="button" onClick={() => open(ws.key)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-ink-secondary">{ws.label}</span>
                    <span className="block text-[13px] text-ink">{qa.headline}</span>
                    {certified ? (
                      <span className={cn('block text-micro', certified.revisit && !certified.revisit.acknowledgedAt ? 'font-medium text-warning' : 'text-ink-muted')}>
                        Certified by {certified.signer.name}
                        {certified.revisit && !certified.revisit.acknowledgedAt ? ' — to revisit' : ''}
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={VERDICT_TONE[qa.verdict]}>{QUICK_VERDICT_LABEL[qa.verdict]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-secondary">{dept.purpose}</p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The project's one summary page: where it stands in each department, the
 * engagements commissioned on it, where the site is, and what needs a person.
 * The stage it is at sits in the timeline at the top of every page.
 */
export default function Overview() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const enabled = projectDepartments(project);
  const departments = DEPARTMENTS.filter((d) => enabled.includes(d.key));
  const subtitle = [[project.location, project.city].filter(Boolean).join(', '), stageAndStep(project.currentStage)].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">{project.name}</h2>
        <p className="text-[12px] text-ink-secondary">{subtitle}</p>
      </div>

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-2 [@container(min-width:84rem)]:grid-cols-3">
        {departments.filter((d) => d.status === 'live').map((d) => (
          <DepartmentCard key={d.key} project={project} dept={d} />
        ))}
      </div>
      {departments.some((d) => d.status === 'coming_soon') ? (
        <p className="text-[12px] text-ink-secondary">
          Coming soon: {departments.filter((d) => d.status === 'coming_soon').map((d) => d.label).join(', ')}. Each is listed with what it will hold.
        </p>
      ) : null}

      <EngagementsCard project={project} onSaved={setProject} />

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <GisOverlayCard project={project} onChanged={async () => setProject(await api.getProject(project.id))} />
          </Suspense>
        </div>
        <KeyFacts project={project} />
      </div>

      <div className="grid gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <OpenItemsCard project={project} />
        <NeedsDecisionCard project={project} />
        <WaitingOnCard project={project} />
        <RecentActivityCard project={project} />
      </div>

      {project.stageHistory.length > 1 ? (
        <Disclosure title="Stage history" count={project.stageHistory.length}>
          <ul className="divide-y divide-hairline">
            {project.stageHistory.slice().reverse().map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 px-1 py-2">
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    {s.subject === 'asset' ? `${project.assets.find((a) => a.id === s.assetId)?.name ?? 'A phase'}: ` : ''}
                    {LIFECYCLE_STAGE_LABEL[s.stage]}
                  </p>
                  <p className="text-[12px] text-ink-secondary">{s.reason}</p>
                </div>
                <p className="shrink-0 font-mono text-[11px] text-ink-muted">{formatWhen(s.effectiveAt)}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
