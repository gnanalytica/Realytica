import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import type { DdProject } from '@realytica/shared';
import { LIFECYCLE_STAGE_LABEL, PROJECT_ARCHETYPE_LABEL, PROJECT_HEALTH_LABEL } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Callout, Skeleton, cn } from '../../components/ui/kit';
import { healthTone } from './shared';

export interface ProjectOutlet {
  project: DdProject;
  refresh: () => Promise<void>;
  setProject: (next: DdProject) => void;
}

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'cockpit', label: 'Cockpit' },
  { to: 'assets', label: 'Assets' },
  { to: 'dd', label: 'Due diligence' },
  { to: 'evidence', label: 'Evidence' },
  { to: 'findings', label: 'Findings' },
  { to: 'risks', label: 'Risks & actions' },
  { to: 'decisions', label: 'Decisions' },
  { to: 'reports', label: 'Reports' },
  { to: 'valuation', label: 'Valuation' },
  { to: 'graph', label: 'Graph' },
  { to: 'ai', label: 'AI drafts' },
];

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const { data: project, error, loading, refresh, setData } = useAsync(() => api.getProject(projectId as string), [projectId]);
  const isCockpit = /\/cockpit(?:\/|$|\?)/.test(location.pathname);

  if (loading && !project) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !project) {
    return <Callout tone="critical" title="Project not found">{error ?? 'This project is not in the store.'}</Callout>;
  }

  const outlet: ProjectOutlet = {
    project,
    refresh,
    setProject: (next) => setData(next),
  };

  if (isCockpit) {
    return <Outlet context={outlet} />;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">{project.reference}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{project.name}</h1>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {PROJECT_ARCHETYPE_LABEL[project.type]} · {project.city} · {LIFECYCLE_STAGE_LABEL[project.currentStage]}
            {project.owner ? ` · ${project.owner}` : ''}
          </p>
          {(project.landAreaSqm || project.builtUpAreaSqm || project.budget) ? (
            <p className="mt-1 font-mono text-[11px] text-ink-muted">
              {[
                project.landAreaSqm ? `Land ${project.landAreaSqm.toLocaleString()} sqm` : null,
                project.builtUpAreaSqm ? `BUA ${project.builtUpAreaSqm.toLocaleString()} sqm` : null,
                project.budget ? `Budget ${project.currency} ${project.budget.toLocaleString()}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <Badge tone={healthTone(project.health)}>{PROJECT_HEALTH_LABEL[project.health]}</Badge>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-hairline pb-px">
        {TABS.map((tab) => (
          <NavLink
            key={tab.label}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-secondary hover:text-ink',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={outlet} />
    </div>
  );
}
