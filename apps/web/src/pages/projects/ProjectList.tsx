import { Link } from 'react-router-dom';
import {
  PROJECT_ARCHETYPE_LABEL,
  PROJECT_HEALTH_LABEL,
  PROJECT_STATUS_LABEL,
  stageDefinition,
  stageOf,
  type ProjectSummary,
} from '@realytica/shared';
import { Badge, Card, CardBody } from '../../components/ui/kit';
import { healthTone } from './shared';

/**
 * The projects as a list: one row each, with the counts a board has no room
 * for.
 *
 * This was a page of its own beside the portfolio, with its own entry in the
 * sidebar, its own search and its own three figures. It showed the same
 * projects the portfolio does, arranged differently, so it is now one of the
 * portfolio's two views and this is only the rows.
 */
export function ProjectRows({ projects }: { projects: ProjectSummary[] }) {
  const grouped = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const key = p.portfolio?.trim() || 'Ungrouped';
    const rows = grouped.get(key) ?? [];
    rows.push(p);
    grouped.set(key, rows);
  }
  // A firm that names its portfolios gets them as headings; one that does not gets no heading at all.
  const showGroups = projects.some((p) => p.portfolio?.trim());
  const groupEntries: Array<[string, ProjectSummary[]]> = showGroups ? [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)) : [['__all__', projects]];

  if (projects.length === 0) {
    return <p className="rounded-xl border border-dashed border-[var(--axis)] px-3 py-7 text-center text-[12px] text-ink-muted">No projects match.</p>;
  }

  return (
    <div className="space-y-6">
      {groupEntries.map(([group, rows]) => (
        <div key={group} className="space-y-2">
          {showGroups ? <h2 className="text-[12px] font-semibold text-ink-secondary">{group}</h2> : null}
          {rows.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="block">
              <Card className="transition-colors hover:bg-sunken/60">
                <CardBody className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] text-ink-muted">{p.reference}</p>
                    <p className="mt-0.5 text-[15px] font-semibold text-ink">{p.name}</p>
                    <p className="mt-1 text-[13px] text-ink-secondary">
                      {PROJECT_ARCHETYPE_LABEL[p.type]} · {p.city} · {stageDefinition(stageOf(p.currentStage)).label}
                      {/* The portfolio is the heading these rows sit under
                          whenever grouping is on, and repeating it on every
                          row put "Bengaluru" twice in one line: once as the
                          city, once inside "Bengaluru residential". Only
                          shown when nothing above already says it. */}
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
  );
}
