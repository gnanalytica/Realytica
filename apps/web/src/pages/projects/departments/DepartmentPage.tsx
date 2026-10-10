import { useMemo } from 'react';
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  DEPARTMENT_ROLE_LABEL,
  QUICK_VERDICT_LABEL,
  cockpitPath,
  currentCertified,
  departmentDefinition,
  departmentRole,
  projectDepartments,
  projectLinks,
  quickAssessment,
  workstreamDefinition,
  type DepartmentKey,
} from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, Skeleton, StatTile } from '../../../components/ui/kit';
import { VERDICT_TONE } from '../../../components/departments/QuickAssessmentCard';
import { DEPARTMENT_ICON } from '../../../components/departments/icons';
import { EngineeringDashboard } from '../../../components/departments/EngineeringDesk';
import { ProfessionRoster } from '../../../components/departments/ProfessionRoster';
import { DepartmentLinksDiagram } from '../../../components/charts';
import { Reveal } from '../../../lib/motion';
import { useMe } from '../../../lib/useMe';
import { useAsync } from '../../../lib/useAsync';
import { api } from '../../../lib/api';
import { money } from '../../../lib/format';
import { exampleOfDepartment } from '../../example/paths';
import type { ProjectOutlet } from '../ProjectLayout';

/**
 * A department Summary: standing and relationships only. No waiting list, no
 * desk steps — those sit on the function tabs. Profession slots here let you
 * associate who signs for each named profession.
 */
export default function DepartmentPage() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const { department = '' } = useParams<{ department: string }>();
  const me = useMe();
  const dept = departmentDefinition(department as DepartmentKey);
  const people = useAsync(() => api.projectPeople(project.id), [project.id]);
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
  const live = useMemo(() => {
    if (!dept || dept.status !== 'live') return [];
    const enabled = projectDepartments(project);
    if (!enabled.includes(dept.key)) return [];
    return dept.workstreams
      .filter((ws) => ws.status === 'live')
      .map((ws) => ({
        ws,
        qa: quickAssessment(project, ws.key),
        certified: currentCertified(project, ws.key),
      }));
  }, [project, dept]);
  const staff = useMemo(
    () => (people.data?.staff ?? []).map((s) => ({ email: s.email, name: s.name, workspaceRole: s.role })),
    [people.data],
  );
  if (!dept) return <Navigate to={cockpitPath(project.id, 'overview')} replace />;
  const myRole = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, dept.key) : undefined;
  const DeptIcon = DEPARTMENT_ICON[dept.key];
  const example = exampleOfDepartment(dept.key);

  return (
    <div className="space-y-4">
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-ink shadow-card ring-1 ring-[var(--ring)]" aria-hidden>
              <DeptIcon size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink-muted">{dept.key === 'design' ? 'Engineering' : 'Department'}</p>
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{dept.label}</h2>
              <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-secondary">{dept.purpose}</p>
            </div>
          </div>
          {myRole ? <Badge tone="brand">You: {DEPARTMENT_ROLE_LABEL[myRole]}</Badge> : <Badge tone="neutral">You can read this department</Badge>}
        </div>
      </Reveal>

      {dept.status === 'coming_soon' ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-secondary">
            <span>{dept.label} is coming soon.</span>
            {example ? (
              <Link to={example} className="group inline-flex items-center gap-1 font-medium text-brand hover:underline coarse:min-h-11">
                See it in the example project
                <ArrowRight size={13} aria-hidden className="transition-transform duration-quick ease-state group-hover:translate-x-0.5" />
              </Link>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {dept.status === 'live' && live.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [@container(min-width:52rem)]:grid-cols-3">
          {live.map(({ ws, qa, certified }) => (
            <StatTile
              key={ws.key}
              label={ws.label}
              value={
                qa.figure
                  ? qa.figure.unit === 'INR'
                    ? money(qa.figure.value, project.currency, { compact: true })
                    : `${Math.round(qa.figure.value)}%`
                  : QUICK_VERDICT_LABEL[qa.verdict]
              }
              hint={
                <>
                  <span className="block">{qa.headline}</span>
                  {certified ? (
                    <span className="mt-0.5 block">
                      Certified by {certified.signer.name}
                      {certified.revisit && !certified.revisit.acknowledgedAt ? ' · to revisit' : ''}
                    </span>
                  ) : (
                    <span className="mt-0.5 block">No certified report yet</span>
                  )}
                </>
              }
              tone={VERDICT_TONE[qa.verdict]}
            />
          ))}
        </div>
      ) : null}

      {dept.status === 'live' && dept.key === 'construction' ? (
        <EngineeringDashboard
          project={project}
          department={dept.key}
          show="figures"
          onOpenFindings={() => undefined}
          onOpenActions={() => undefined}
        />
      ) : null}

      <Card>
        <CardHeader title="Between departments" subtitle="What it feeds, gates or needs" />
        <CardBody>
          <DepartmentLinksDiagram links={links} focus={dept.key} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="People" subtitle="Who signs for each profession on this department" />
        <CardBody>
          {people.loading && !people.data ? <Skeleton className="h-28 w-full" /> : null}
          {people.data || !people.loading ? (
            <ProfessionRoster
              project={project}
              department={dept.key}
              professions={dept.professions}
              staff={staff}
              onChanged={setProject}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
