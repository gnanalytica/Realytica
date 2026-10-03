import { useMemo } from 'react';
import { Navigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  DEPARTMENT_ROLE_LABEL,
  QUICK_VERDICT_LABEL,
  STAGES,
  cockpitPath,
  currentCertified,
  departmentDefinition,
  departmentRole,
  projectLinks,
  quickAssessment,
  workstreamDefinition,
  type DdProject,
  type DepartmentKey,
  type WorkstreamDefinition,
} from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, TONE_FILL, cn } from '../../../components/ui/kit';
import { VERDICT_TONE } from '../../../components/departments/QuickAssessmentCard';
import { DEPARTMENT_ICON } from '../../../components/departments/icons';
import { Reveal, Stagger, StaggerItem } from '../../../lib/motion';
import { useMe } from '../../../lib/useMe';
import { useWorkstreamNav } from './WorkstreamPage';
import type { ProjectOutlet } from '../ProjectLayout';

function WorkstreamCard({ project, ws, onOpen }: { project: DdProject; ws: WorkstreamDefinition; onOpen: () => void }) {
  const live = ws.status === 'live';
  const qa = useMemo(() => (live ? quickAssessment(project, ws.key) : null), [project, ws.key, live]);
  const certified = live ? currentCertified(project, ws.key) : undefined;
  const stageNow = STAGES.find((s) => s.subStages.includes(project.currentStage))?.key;
  const due = ws.deliverables.find((d) => d.stage === stageNow) ?? ws.deliverables[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative flex h-full min-h-[9.5rem] w-full flex-col overflow-hidden rounded-2xl p-4 text-left',
        'transition-[transform,box-shadow] duration-base ease-enter hover:-translate-y-0.5 active:translate-y-0 motion-reduce:hover:translate-y-0',
        live ? 'bg-surface shadow-card ring-1 ring-[var(--ring)] hover:shadow-raised' : 'border border-dashed border-[var(--axis)] bg-transparent hover:bg-surface/60',
      )}
    >
      {/* The verdict, as the card's top edge: a row of these reads like a status board. */}
      {live && qa ? <span aria-hidden className={cn('absolute inset-x-0 top-0 h-[3px]', TONE_FILL[VERDICT_TONE[qa.verdict]])} /> : null}
      <div className="flex w-full items-start gap-2">
        <p className={cn('flex-1 text-[14px] font-semibold', live ? 'text-ink' : 'text-ink-secondary')}>{ws.label}</p>
        {live && qa ? <Badge tone={VERDICT_TONE[qa.verdict]}>{QUICK_VERDICT_LABEL[qa.verdict]}</Badge> : <Badge tone="neutral">Coming soon</Badge>}
      </div>
      {live && qa ? <p className="mt-1.5 line-clamp-2 text-[13px] text-ink">{qa.headline}</p> : <p className="mt-1.5 text-[13px] text-ink-secondary">{ws.purpose}</p>}
      <div className="mt-auto space-y-0.5 pt-3 text-micro text-ink-muted">
        {due ? <p>Delivers now: {due.title}</p> : null}
        {live ? <p>{certified ? `Certified by ${certified.signer.name}${certified.revisit && !certified.revisit.acknowledgedAt ? ' · to revisit' : ''}` : 'No certified report yet'}</p> : null}
      </div>
      <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand opacity-0 transition-[opacity,transform] duration-quick ease-state group-hover:translate-x-0.5 group-hover:opacity-100">
        Open <ArrowRight size={12} />
      </span>
    </button>
  );
}

/**
 * A department at a glance: each workstream's estimate and certified report,
 * what this department exchanges with the others, and who works in it.
 */
export default function DepartmentPage() {
  const { project } = useOutletContext<ProjectOutlet>();
  const { department = '' } = useParams<{ department: string }>();
  const me = useMe();
  const nav = useWorkstreamNav(project);
  const dept = departmentDefinition(department as DepartmentKey);
  const links = useMemo(
    () =>
      projectLinks(project).filter(
        (l) =>
          l.origin === 'system' &&
          l.from.kind === 'workstream' &&
          l.to.kind === 'workstream' &&
          (l.from.id.startsWith(`${department}.`) || l.to.id.startsWith(`${department}.`)) &&
          workstreamDefinition(l.from.id)?.department !== workstreamDefinition(l.to.id)?.department,
      ),
    [project, department],
  );
  if (!dept) return <Navigate to={cockpitPath(project.id, 'overview')} replace />;
  const myRole = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, dept.key) : undefined;
  const team = (project.team ?? []).filter((t) => t.departments[dept.key]);
  const DeptIcon = DEPARTMENT_ICON[dept.key];

  return (
    <div className="space-y-4">
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card ring-1 ring-[var(--ring)]" aria-hidden>
              <DeptIcon size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink-muted">Department</p>
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{dept.label}</h2>
              <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-secondary">{dept.purpose}</p>
            </div>
          </div>
          {myRole ? <Badge tone="brand">You: {DEPARTMENT_ROLE_LABEL[myRole]}</Badge> : <Badge tone="neutral">You can read this department</Badge>}
        </div>
      </Reveal>

      {dept.status === 'coming_soon' ? (
        <Card>
          <CardBody className="text-[13px] text-ink-secondary">
            {dept.label} is coming. Its workstreams are listed below with what each will produce, and anything already on the file that belongs to them waits where it is.
          </CardBody>
        </Card>
      ) : null}

      <Stagger className="grid items-stretch gap-3 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
        {dept.workstreams.map((ws) => (
          <StaggerItem key={ws.key} className="h-full">
            <WorkstreamCard project={project} ws={ws} onOpen={() => nav.openWorkstream(ws.key)} />
          </StaggerItem>
        ))}
      </Stagger>

      <div className="grid grid-cols-1 gap-4 [@container(min-width:52rem)]:grid-cols-2">
        <Card>
          <CardHeader title="Between departments" subtitle="What this department's work feeds, gates or depends on elsewhere" />
          <CardBody>
            {links.length ? (
              <ul className="space-y-2">
                {links.map((l) => {
                  const from = workstreamDefinition(l.from.id)!;
                  const to = workstreamDefinition(l.to.id)!;
                  return (
                    <li key={l.id} className="text-[13px]">
                      <button type="button" className="font-medium text-brand hover:underline" onClick={() => nav.openWorkstream(from.key)}>
                        {departmentDefinition(from.department).label.split(' ')[0]} › {from.label}
                      </button>{' '}
                      <span className="text-ink-muted">{l.type === 'draws_on' ? 'draws on' : l.type}</span>{' '}
                      <button type="button" className="font-medium text-brand hover:underline" onClick={() => nav.openWorkstream(to.key)}>
                        {departmentDefinition(to.department).label.split(' ')[0]} › {to.label}
                      </button>
                      {l.note ? <span className="block text-micro text-ink-muted">{l.note}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-secondary">No links to other departments yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="People" subtitle={`Professions: ${dept.professions.join(', ')}`} />
          <CardBody>
            {team.length ? (
              <ul className="space-y-1">
                {team.map((t) => (
                  <li key={t.email} className="flex items-baseline gap-2 text-[13px]">
                    <span className="flex-1 text-ink">{t.name ?? t.email}</span>
                    <Badge tone={t.departments[dept.key] === 'lead' ? 'brand' : 'neutral'}>{DEPARTMENT_ROLE_LABEL[t.departments[dept.key]!]}</Badge>
                    {t.signer ? <span className="text-micro text-ink-muted">{t.signer.profession}{t.signer.registration ? ` · ${t.signer.registration}` : ''}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-secondary">The firm's own people work here by their firm role. Add a lead, a signer or an outside contributor in People.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
