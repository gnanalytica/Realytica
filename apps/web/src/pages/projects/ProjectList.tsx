import { Link, useNavigate } from 'react-router-dom';
import { FolderTree, Plus, RotateCw } from 'lucide-react';
import {
  LIFECYCLE_STAGE_LABEL,
  PROJECT_ARCHETYPE_LABEL,
  PROJECT_HEALTH_LABEL,
  PROJECT_STATUS_LABEL,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Badge, Button, Callout, Card, CardBody, EmptyState, Input, Skeleton, StatTile, useToast } from '../../components/ui/kit';
import { healthTone } from './shared';
import { useState } from 'react';

/** Below this many projects the eye is faster than a search box. */
const SEARCH_FROM = 6;

export default function ProjectList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, refresh } = useAsync(() => api.listProjects(), []);
  const [seeding, setSeeding] = useState(false);
  const [query, setQuery] = useState('');

  async function seed() {
    setSeeding(true);
    try {
      await api.seedDemo();
      await refresh();
      toast('Sample project restored', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not seed', 'critical');
    } finally {
      setSeeding(false);
    }
  }

  // Fine at two projects; a firm with forty needs to type a name. Reference
  // and city are in the haystack because "RYT-0021" and "Whitefield" are both
  // things people say out loud about a file.
  const all = data ?? [];
  const needle = query.trim().toLowerCase();
  const list = needle
    ? all.filter((p) =>
        [p.name, p.reference, p.city, p.location, p.portfolio ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : all;
  // Tiles count the portfolio, not the filtered view — a search should not
  // make the number of at-risk projects appear to fall.
  const active = all.filter((p) => p.status === 'active').length;
  const red = all.filter((p) => p.health === 'red').length;
  const overdue = all.reduce((n, p) => n + p.overdueActions, 0);
  const grouped = new Map<string, typeof list>();
  for (const p of list) {
    const key = p.portfolio?.trim() || 'Ungrouped';
    const rows = grouped.get(key) ?? [];
    rows.push(p);
    grouped.set(key, rows);
  }
  const showGroups = list.some((p) => p.portfolio?.trim());
  const groupEntries = showGroups
    ? [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
    : ([['__all__', list]] as Array<[string, typeof list]>);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Projects</h1>
          {all.length >= SEARCH_FROM ? (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project"
              aria-label="Find a project"
              className="w-56"
            />
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RotateCw size={14} />} onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
          <Button icon={<Plus size={14} />} onClick={() => navigate('/projects/new')}>
            New project
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Projects" value={String(all.length)} hint={`${active} active`} />
        <StatTile label="At risk" value={String(red)} hint="Health red" />
        <StatTile label="Overdue actions" value={String(overdue)} />
      </div>

      {error ? <Callout tone="critical" title="Could not load projects">{error}</Callout> : null}
      {loading && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {!loading && list.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={22} />}
          title="No projects yet"
          description="Create a project and asset tree, then start a due diligence assessment from the library. AI is not required."
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate('/projects/new')}>Create project</Button>
              <Button variant="ghost" onClick={() => void seed()} disabled={seeding}>
                Load sample township
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          {groupEntries.map(([group, rows]) => (
            <div key={group} className="space-y-2">
              {showGroups ? (
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{group}</h2>
              ) : null}
              {rows.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="block">
                  <Card className="transition-colors hover:bg-sunken/60">
                    <CardBody className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] text-ink-muted">{p.reference}</p>
                        <p className="mt-0.5 text-[15px] font-semibold text-ink">{p.name}</p>
                        <p className="mt-1 text-[13px] text-ink-secondary">
                          {PROJECT_ARCHETYPE_LABEL[p.type]} · {p.city} · {LIFECYCLE_STAGE_LABEL[p.currentStage]}
                          {/* The portfolio is the heading these cards sit
                              under whenever grouping is on, and repeating it
                              on every card put "Bengaluru" twice in one line:
                              once as the city, once inside "Bengaluru
                              residential". Only shown when nothing above
                              already says it. */}
                          {p.portfolio && !showGroups ? ` · ${p.portfolio}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={healthTone(p.health)}>{PROJECT_HEALTH_LABEL[p.health]}</Badge>
                        <Badge>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                        <span className="text-[12px] text-ink-muted">
                          {p.activeDdCount} DD · {p.openFindings} findings · {p.openRisks} risks
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
