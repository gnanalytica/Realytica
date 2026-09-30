import { Suspense, lazy, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, ChevronLeft, MessageSquare } from 'lucide-react';
import { ENGAGEMENT_STAGE_LABEL, LIFECYCLE_STAGE_LABEL, REPORT_KIND_LABEL } from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Skeleton } from '../../components/ui/kit';
import {
  KeyFacts,
  LifecycleStepper,
  NeedsDecisionCard,
  OpenItemsCard,
  SampleBadge,
  ViewTiles,
  WaitingOnCard,
} from '../../components/project/ProjectPanels';

/*
 * The map carries Leaflet. Lazy, so the rest of the dashboard paints first.
 */
const GisOverlayCard = lazy(() =>
  import('../../components/GisOverlayCard').then((m) => ({ default: m.GisOverlayCard })),
);

const ASK_STARTERS = ['Summarise where this file stands', "What's missing?", 'Which findings are critical?'];

/**
 * The case dashboard: the whole file at a glance, full width, no chat.
 *
 * Outside the case the product is dashboards; inside it the work is a
 * conversation beside a canvas. This page is the door between the two:
 * everything here links into the workspace, and "Ask" opens the workspace
 * with the question already asked.
 */
export default function ProjectDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data: project, error, loading, setData } = useAsync(() => api.getProject(projectId as string), [projectId]);
  const [question, setQuestion] = useState('');

  if (loading && !project) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (error || !project) {
    return <Callout tone="critical" title="Project not found">{error ?? 'This project is not in the store.'}</Callout>;
  }

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    navigate(`/projects/${project.id}?ask=${encodeURIComponent(text)}`);
  };
  const latestReport = project.reports.at(-1);
  const subtitle = [
    [project.location, project.city].filter(Boolean).join(', '),
    project.engagement?.scope,
    latestReport ? `${REPORT_KIND_LABEL[latestReport.kind]}, ${latestReport.status === 'issued' ? 'issued' : 'draft'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            to="/portfolio"
            className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken coarse:min-h-11"
          >
            <ChevronLeft size={15} />
            Portfolio
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">{project.name}</h1>
              <Badge tone="neutral">{LIFECYCLE_STAGE_LABEL[project.currentStage]}</Badge>
              {project.engagement ? <Badge tone="brand">{ENGAGEMENT_STAGE_LABEL[project.engagement.stage]}</Badge> : null}
              <SampleBadge project={project} />
            </div>
            <p className="mt-0.5 text-[13px] text-ink-secondary">{subtitle}</p>
          </div>
        </div>
        <Button variant="primary" icon={<MessageSquare size={15} />} onClick={() => navigate(`/projects/${project.id}`)}>
          Open workspace
        </Button>
      </header>

      <LifecycleStepper project={project} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
            <GisOverlayCard project={project} onChanged={async () => setData(await api.getProject(project.id))} />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <KeyFacts project={project} />
          <Card>
            <CardHeader title="Ask Copilot" subtitle="Opens the workspace with your question" />
            <CardBody className="space-y-2.5">
              <form
                className="flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ring-inset ring-[var(--ring)] focus-within:ring-brand"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
              >
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={`Ask about ${project.name}`}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-ink placeholder:text-ink-muted focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Ask"
                  disabled={!question.trim()}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-ink-inverse disabled:opacity-40 coarse:h-11 coarse:w-11"
                >
                  <ArrowUp size={15} />
                </button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {ASK_STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken hover:text-ink coarse:min-h-11"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[14px] font-semibold text-ink">Open a view</h2>
          <p className="text-[12px] text-ink-secondary">Each opens in the workspace, with Copilot beside it</p>
        </div>
        <ViewTiles project={project} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <OpenItemsCard project={project} />
        <WaitingOnCard project={project} />
        <NeedsDecisionCard project={project} />
      </div>
    </div>
  );
}
