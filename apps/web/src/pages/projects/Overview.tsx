import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import {
  DEPARTMENTS,
  LIFECYCLE_STAGE_LABEL,
  PROJECT_HEALTH_LABEL,
  QUICK_VERDICT_LABEL,
  approvalsRegister,
  cockpitPath,
  currentCertified,
  openAlerts,
  progressSummary,
  projectDepartments,
  quickAssessment,
  stageAndStep,
  type DdProject,
  type DepartmentDefinition,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { AnimatedNumber, EASE_ENTER, Reveal, Stagger, StaggerItem, motion } from '../../lib/motion';
import { Badge, Disclosure, Skeleton, TONE_FILL, cn, toneText } from '../../components/ui/kit';
import { KeyFacts, NeedsDecisionCard, OpenItemsCard, RecentActivityCard, WaitingOnCard } from '../../components/project/ProjectPanels';
import { EngagementsCard } from '../../components/project/EngagementEditor';
import { VERDICT_TONE } from '../../components/departments/QuickAssessmentCard';
import { DEPARTMENT_ICON } from '../../components/departments/icons';
import { DepartmentsControl } from '../../components/departments/DepartmentsControl';
import { WORKSTREAM_PANE } from './cockpit/rail';
import { formatWhen, healthTone } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

/* The map carries Leaflet. Lazy, so the rest of the overview paints first. */
const GisOverlayCard = lazy(() => import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })));

/**
 * A department, as a card a person can read in a glance.
 *
 * The bar under the heading is the department's standing before any word of
 * it is read: one segment a workstream, coloured by its verdict, drawn in
 * when the page opens. Each workstream row then says the same thing in words,
 * and opens the workstream.
 */
function DepartmentCard({ project, dept }: { project: DdProject; dept: DepartmentDefinition }) {
  const navigate = useNavigate();
  const rows = useMemo(() => dept.workstreams.filter((w) => w.status === 'live').map((w) => ({ ws: w, qa: quickAssessment(project, w.key), certified: currentCertified(project, w.key) })), [project, dept]);
  const open = (key: string) => navigate(cockpitPath(project.id, WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key }));
  const Icon = DEPARTMENT_ICON[dept.key];
  return (
    <section className="group/card flex h-full flex-col rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)] transition-shadow duration-base ease-enter hover:shadow-tile">
      <header className="flex items-center gap-3 px-4 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sunken text-ink ring-1 ring-inset ring-[var(--ring)]" aria-hidden>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-ink">{dept.label}</h3>
          <p className="text-[12px] text-ink-muted">
            {rows.length} workstream{rows.length === 1 ? '' : 's'} in use
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(cockpitPath(project.id, 'department', { department: dept.key }))}
          className="group/open inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft coarse:min-h-11"
        >
          Open
          <ArrowRight size={12} className="transition-transform duration-quick ease-state group-hover/open:translate-x-0.5" />
        </button>
      </header>
      {rows.length ? (
        <div className="mx-4 mt-3 flex h-1.5 gap-1" aria-hidden>
          {rows.map(({ ws, qa }, i) => (
            <motion.span
              key={ws.key}
              className={cn('flex-1 origin-left rounded-full', TONE_FILL[VERDICT_TONE[qa.verdict]])}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: EASE_ENTER, delay: 0.15 + i * 0.07 }}
            />
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="mt-2 flex-1 px-2 pb-2">
          {rows.map(({ ws, qa, certified }) => (
            <li key={ws.key}>
              <button
                type="button"
                onClick={() => open(ws.key)}
                /* On a narrow card the verdict drops under the headline rather
                   than squeezing it to a word a line. */
                className="group/row flex w-full flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-quick hover:bg-sunken/70 coarse:min-h-11"
              >
                <span className="min-w-[9rem] flex-1">
                  <span className="block text-[12px] font-medium text-ink-muted">{ws.label}</span>
                  <span className={cn('block text-[14px] font-medium', qa.verdict === 'insufficient' ? 'text-ink-secondary' : 'text-ink')}>{qa.headline}</span>
                  {certified ? (
                    <span className={cn('mt-0.5 block text-micro', certified.revisit && !certified.revisit.acknowledgedAt ? 'font-medium text-[var(--status-warning-text)]' : 'text-ink-muted')}>
                      Certified by {certified.signer.name}
                      {certified.revisit && !certified.revisit.acknowledgedAt ? ' — to revisit' : ''}
                    </span>
                  ) : null}
                </span>
                <Badge tone={VERDICT_TONE[qa.verdict]}>{QUICK_VERDICT_LABEL[qa.verdict]}</Badge>
                <ChevronRight size={14} className="mt-0.5 shrink-0 text-ink-muted opacity-0 transition-[opacity,transform] duration-quick ease-state group-hover/row:translate-x-0.5 group-hover/row:opacity-100 coarse:hidden" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[13px] text-ink-secondary">{dept.purpose}</p>
      )}
    </section>
  );
}

/** One figure of where the file stands. The number counts to itself when the page opens. */
function Figure({ label, value, of, hint, tone }: { label: string; value: number | string; of?: number; hint?: ReactNode; tone?: 'critical' | 'warning' | 'good' }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="truncate text-[12px] text-ink-muted">{label}</p>
      <p className={cn('mt-1 flex items-baseline gap-1 text-[22px] font-semibold leading-none tracking-tight tabular-nums', tone ? toneText(tone) : 'text-ink')}>
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        {of !== undefined ? <span className="text-[13px] font-medium text-ink-muted">/ {of}</span> : null}
      </p>
      {hint ? <p className="mt-1 truncate text-[12px] text-ink-secondary">{hint}</p> : null}
    </div>
  );
}

function StandingFigures({ project }: { project: DdProject }) {
  const alerts = openAlerts(project);
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const register = approvalsRegister(project);
  const due = register.filter((l) => l.status === 'in_force' || l.status === 'expiring' || l.status === 'expired' || l.status === 'missing');
  const inForce = register.filter((l) => l.status === 'in_force' || l.status === 'expiring').length;
  const progress = progressSummary(project).percent;
  const documents = project.evidence.filter((e) => e.attachments.length > 0).length;
  const health = healthTone(project.health);
  return (
    // The hairline between figures is the grid's own ground showing through a
    // one-pixel gap, so it falls right at two columns and at five.
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-hairline shadow-card ring-1 ring-[var(--ring)] [@container(min-width:40rem)]:grid-cols-5 [&>*]:bg-surface [@container(max-width:40rem)]:[&>*:last-child]:col-span-2">
      <Figure label="Health" value={PROJECT_HEALTH_LABEL[project.health]} tone={health === 'critical' ? 'critical' : health === 'warning' ? 'warning' : health === 'good' ? 'good' : undefined} hint={stageAndStep(project.currentStage)} />
      <Figure label="Approvals in force" value={inForce} of={due.length} tone={inForce < due.length ? 'warning' : undefined} hint={`${due.length - inForce} lapsed or missing`} />
      <Figure label="Open alerts" value={alerts.length} tone={critical ? 'critical' : undefined} hint={critical ? `${critical} critical` : 'Nothing critical'} />
      <Figure label="Documents filed" value={documents} hint="In the vault" />
      <Figure label="Progress" value={progress === null ? '—' : `${Math.round(progress)}%`} hint={progress === null ? 'No milestones yet' : 'Weighted milestones'} />
    </div>
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
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-ink-muted">{project.reference}</p>
            <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{project.name}</h2>
            <p className="text-[13px] text-ink-secondary">{subtitle}</p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <StandingFigures project={project} />
      </Reveal>

      <Stagger className="grid grid-cols-1 items-stretch gap-4 [@container(min-width:52rem)]:grid-cols-2 [@container(min-width:84rem)]:grid-cols-3">
        {departments.filter((d) => d.status === 'live').map((d) => (
          <StaggerItem key={d.key} className="h-full">
            <DepartmentCard project={project} dept={d} />
          </StaggerItem>
        ))}
      </Stagger>
      {departments.some((d) => d.status === 'coming_soon') ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-secondary">
          <span className="mr-1">Coming soon</span>
          {departments.filter((d) => d.status === 'coming_soon').map((d) => {
            const Icon = DEPARTMENT_ICON[d.key];
            return (
              <span key={d.key} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                <Icon size={12} aria-hidden />
                {d.label}
              </span>
            );
          })}
        </div>
      ) : null}

      <DepartmentsControl project={project} onSaved={setProject} />

      <EngagementsCard project={project} onSaved={setProject} />

      <div className="grid grid-cols-1 gap-4 [@container(min-width:52rem)]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <GisOverlayCard project={project} onChanged={async () => setProject(await api.getProject(project.id))} />
          </Suspense>
        </div>
        <KeyFacts project={project} />
      </div>

      <div className="grid grid-cols-1 gap-4 [@container(min-width:52rem)]:grid-cols-2">
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
