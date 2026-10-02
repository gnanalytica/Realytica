import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  CircleAlert,
  FileStack,
  FileText,
  MapPin,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Users,
  Waypoints,
} from 'lucide-react';
import {
  LIFECYCLE_STAGE_LABEL,
  REPORT_KIND_LABEL,
  cockpitPath,
  currentEngagement,
  waitingOn,
  type DdProject,
  type FindingRecord,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, cn } from '../ui/kit';
import { money } from '../../lib/format';

/* ==================================================================== */
/* Small formatting helpers                                              */
/* ==================================================================== */

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function monthYear(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : MONTH.format(d);
}

export function dayMonth(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : DAY.format(d);
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

/** Square metres as a Karnataka file states land: acres and guntas beside m². */
export function extentLabel(sqm: number | undefined): string | null {
  if (!sqm || sqm <= 0) return null;
  // Rounded as guntas first and then split, so 39.99 guntas carries into the
  // next acre instead of reading "11 acres 40 guntas". One decimal, not a
  // whole gunta: a deed writes 38 guntas for 38.6, and a rounded 39 would
  // read as a disagreement with it.
  const totalGuntas = Math.round((sqm / 101.17141056) * 10) / 10;
  const acres = Math.floor(totalGuntas / 40);
  const guntas = Math.round((totalGuntas - acres * 40) * 10) / 10;
  const guntaText = Number.isInteger(guntas) ? String(guntas) : guntas.toFixed(1);
  const parts = [
    acres ? `${acres} acre${acres === 1 ? '' : 's'}` : null,
    guntas ? `${guntaText} gunta${guntas === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return `${Math.round(sqm).toLocaleString('en-IN')} m²${parts.length ? ` (${parts.join(' ')})` : ''}`;
}

const CLOSED_FINDING = new Set(['closed', 'rejected', 'duplicate', 'superseded']);
const SEVERITY_ORDER: FindingRecord['severity'][] = ['critical', 'high', 'medium', 'low'];

export function openFindings(project: DdProject): FindingRecord[] {
  return project.findings
    .filter((f) => !CLOSED_FINDING.has(f.status))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-semibold text-ink-secondary ring-1 ring-inset ring-[var(--ring)]',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/* ==================================================================== */
/* Lifecycle                                                             */
/* ==================================================================== */

export function KeyFacts({ project, className }: { project: DdProject; className?: string }) {
  const guidance = project.revenueMap?.anchor;
  const rows: Array<[string, ReactNode]> = [];
  if (project.parcelId) rows.push(['Survey Nos.', <span className="font-mono">{project.parcelId}</span>]);
  rows.push(['Location', [project.siteAddress || project.location, project.city].filter(Boolean).join(', ')]);
  const extent = extentLabel(project.landAreaSqm);
  if (extent) rows.push(['Extent', extent]);
  if (project.builtUpAreaSqm) rows.push(['Built-up', `${Math.round(project.builtUpAreaSqm).toLocaleString('en-IN')} m²`]);
  if (project.description) rows.push(['Scheme', project.description]);
  const engagement = currentEngagement(project);
  if (engagement?.client) rows.push(['Client', engagement.client]);
  if (project.developer) rows.push(['Developer', project.developer]);
  if (engagement) rows.push(['Engagement', engagement.scope ?? engagement.title]);
  if (guidance) {
    rows.push([
      'Guidance value',
      `₹${guidance.guidancePerUnit.toLocaleString('en-IN')} per ${guidance.unit === 'sqft' ? 'sq ft' : 'sq yd'}, as published${guidance.locality ? ` (${guidance.locality})` : ''}`,
    ]);
  }
  return (
    <Card className={className}>
      <CardHeader title="Key facts" subtitle={project.reference} />
      <CardBody>
        <dl className="divide-y divide-hairline">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-[13px]">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/* ==================================================================== */
/* Open items, waiting on, decisions, activity                           */
/* ==================================================================== */

const SEVERITY_WORD: Record<FindingRecord['severity'], { word: string; className: string }> = {
  critical: { word: 'Critical', className: 'text-critical' },
  high: { word: 'Major', className: 'text-warning' },
  medium: { word: 'Moderate', className: 'text-ink-secondary' },
  low: { word: 'Minor', className: 'text-ink-muted' },
};

export function OpenItemsCard({ project, className, limit = 5 }: { project: DdProject; className?: string; limit?: number }) {
  const findings = openFindings(project);
  const shown = findings.slice(0, limit);
  return (
    <Card className={className}>
      <CardHeader
        title="Open items"
        subtitle={`${findings.length} finding${findings.length === 1 ? '' : 's'} open`}
        action={
          <Link to={cockpitPath(project.id, 'findings')} className="text-[12px] font-medium text-brand">
            All findings
          </Link>
        }
      />
      <CardBody>
        {shown.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing open. Findings appear here as checks are recorded.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {shown.map((f) => (
              <li key={f.id}>
                <Link
                  to={cockpitPath(project.id, 'findings', { findingId: f.id })}
                  className="flex items-baseline justify-between gap-3 py-2 text-[13px] hover:text-brand"
                >
                  <span className="min-w-0 text-ink">{f.title}</span>
                  <span className={cn('shrink-0 text-[12px] font-medium', SEVERITY_WORD[f.severity].className)}>
                    {SEVERITY_WORD[f.severity].word}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function WaitingOnCard({
  project,
  className,
  action,
}: {
  project: DdProject;
  className?: string;
  action?: ReactNode;
}) {
  const items = waitingOn(project);
  return (
    <Card className={className}>
      <CardHeader
        title="Waiting on others"
        subtitle={items.length ? `${items.length} open` : 'Nothing outstanding'}
        action={
          action ?? (
            <Link to={cockpitPath(project.id, 'people')} className="text-[12px] font-medium text-brand">
              All requests
            </Link>
          )
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No requests sent. Ask someone for a document from the People tab.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.slice(0, 6).map(({ request, ageDays, overdue }) => (
              <li key={request.id} className="flex items-center gap-3 py-2">
                <Avatar name={request.recipient} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{request.recipient}</p>
                  <p className="truncate text-[12px] text-ink-secondary">{request.title}</p>
                </div>
                <Badge tone={overdue ? 'critical' : ageDays >= 5 ? 'warning' : 'neutral'}>
                  {overdue ? `Overdue ${dayMonth(request.dueAt)}` : request.dueAt ? `Due ${dayMonth(request.dueAt)}` : `${ageDays} day${ageDays === 1 ? '' : 's'}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function NeedsDecisionCard({ project, className }: { project: DdProject; className?: string }) {
  const proposals = (project.chatProposals ?? []).filter((p) => p.status === 'proposed');
  const drafts = (project.aiDrafts ?? []).filter((d) => d.status === 'draft' || d.status === 'in_review');
  const total = proposals.length + drafts.length;
  const rows = [
    ...proposals.map((p) => ({ id: p.id, title: p.title, href: `/projects/${project.id}` })),
    ...drafts.map((d) => ({ id: d.id, title: d.title, href: cockpitPath(project.id, 'drafts') })),
  ].slice(0, 5);
  return (
    <Card className={cn(total > 0 && 'ring-2 ring-brand/40', className)}>
      <CardHeader
        title="Needs your decision"
        subtitle={total ? `${total} proposal${total === 1 ? '' : 's'} waiting` : 'Nothing waiting'}
      />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing is waiting for a person. Proposals from the copilot appear here until someone accepts or rejects them.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand-soft text-brand">
                  <Sparkles size={11} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.title}</span>
                <Link to={row.href} className="shrink-0 text-[12px] font-medium text-brand">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-ink-muted">Only people change the record. AI proposals wait for a decision.</p>
      </CardBody>
    </Card>
  );
}

/** What changed on the file lately, from the edits people made. */
export function RecentActivityCard({ project, className, limit = 5 }: { project: DdProject; className?: string; limit?: number }) {
  const edits = (project.conversation ?? [])
    .filter((t) => t.role === 'assistant')
    .flatMap((t) =>
      ((t as { toolCalls?: Array<{ name: string; summary?: string }> }).toolCalls ?? [])
        .filter((c) => c.name === 'pane_write' && c.summary)
        .map((c) => ({ id: `${t.id}:${c.summary}`, at: t.at, text: c.summary!, actor: t.actor })),
    )
    .reverse()
    .slice(0, limit);
  return (
    <Card className={className}>
      <CardHeader title="Recent activity" />
      <CardBody>
        {edits.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No edits recorded yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {edits.map((e) => (
              <li key={e.id} className="grid grid-cols-[3.5rem_1fr] gap-3 py-2 text-[13px]">
                <span className="font-mono text-[11px] text-ink-muted">{dayMonth(e.at)}</span>
                <span className="min-w-0 text-ink">
                  {e.text}
                  {e.actor ? <span className="block text-[12px] text-ink-secondary">{e.actor}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { Avatar };
