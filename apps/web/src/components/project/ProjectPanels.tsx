import { amount, dayMonth as dayMonthSaid, person } from '../../lib/format';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  cockpitPath,
  currentEngagement,
  daySaid,
  projectFactsWaiting,
  type FactWaiting,
  parcelLabels,
  revenueGuidance,
  revenueReads,
  waitingOn,
  type DdProject,
  type FindingRecord,
  daysInWords,
} from '@realytica/shared';
import { AiMark, Badge, Card, CardBody, CardHeader, cn } from '../ui/kit';

/* ==================================================================== */
/* Small formatting helpers                                              */
/* ==================================================================== */


export function dayMonth(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : dayMonthSaid(iso.length === 10 ? iso : d);
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

/** Where a suggestion for a fact came from: the person's words in the chat, the paper it was read off, or the day it was raised. */
function factSource(project: DdProject, waiting: FactWaiting): string {
  const { card } = waiting;
  if (card.said) return `said in chat by ${person(card.said.by)}, ${daySaid(card.said.at)}`;
  const paper = (card.citedEvidenceIds ?? []).map((id) => project.evidence.find((row) => row.id === id)?.title).find(Boolean);
  return paper ? `from ${paper}` : `suggested ${daySaid(card.createdAt)}`;
}

/** The facts each row of Key facts shows, by their keys on the project: a suggestion for one of them waits under that row. */
const FACT_ROW_KEYS: Record<string, string[]> = {
  'Survey Nos.': ['parcelId'],
  Location: ['siteAddress', 'city', 'location'],
  Extent: ['landAreaSqm'],
  'Built-up': ['builtUpAreaSqm'],
  Developer: ['developer'],
};

/**
 * A suggestion for a fact, under the fact it would change: the value, where
 * it came from, and Accept and Set aside. A card that changes several facts
 * is decided whole, and says so on its buttons.
 */
function FactSuggestion({
  project,
  waiting,
  busy,
  onAccept,
  onSetAside,
}: {
  project: DdProject;
  waiting: FactWaiting;
  busy?: boolean;
  onAccept?: (id: string) => void;
  onSetAside?: (id: string) => void;
}) {
  const together = projectFactsWaiting(project).filter((other) => other.card.id === waiting.card.id).length;
  const act = 'rounded-md px-2 py-1 text-[12px] font-medium hover:underline disabled:opacity-50 coarse:min-h-11';
  return (
    <div className="mt-1 rounded-lg border border-ai bg-ai/5 px-2.5 py-1.5">
      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink">
        <AiMark size="xs" />
        <span>
          Suggested: {waiting.to}
          {waiting.unit ? ` ${waiting.unit}` : ''}
        </span>
        <span className="text-ink-muted">· {factSource(project, waiting)}</span>
      </p>
      {waiting.card.said?.quote ? <p className="mt-0.5 text-[11px] text-ink-muted">“{waiting.card.said.quote}”</p> : null}
      {onAccept && onSetAside ? (
        <p className="mt-0.5 flex gap-1">
          <button type="button" disabled={busy} className={cn(act, 'bg-action text-action-ink hover:no-underline')} onClick={() => onAccept(waiting.card.id)}>
            {together > 1 ? `Accept all ${together}` : 'Accept'}
          </button>
          <button type="button" disabled={busy} className={cn(act, 'text-ink-muted')} onClick={() => onSetAside(waiting.card.id)}>
            {together > 1 ? `Set aside all ${together}` : 'Set aside'}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The facts set once for a project, and any suggestion to change one, under
 * the fact it would change. A suggestion for a fact the card does not show
 * (the owner, the budget, the pin) is a row of its own, with what the fact
 * holds now.
 */
export function KeyFacts({
  project,
  className,
  busy,
  onAccept,
  onSetAside,
}: {
  project: DdProject;
  className?: string;
  busy?: boolean;
  onAccept?: (id: string) => void;
  onSetAside?: (id: string) => void;
}) {
  // One published value, from the first parcel read that carries one. On a site of several it says which parcel that is.
  const parcels = revenueReads(project);
  const published = revenueGuidance(parcels);
  const guidance = published?.anchor;
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
      `${amount(guidance.guidancePerUnit)} per ${guidance.unit === 'sqft' ? 'sq ft' : 'sq yd'}, as published${guidance.locality ? ` (${guidance.locality})` : ''}${
        published && parcels.length > 1
          ? `, for Sy. ${parcelLabels(parcels).get(published.read.parcelRef) ?? published.read.surveyNo}${published.differing.length ? '; other parcels carry other values' : ''}`
          : ''
      }`,
    ]);
  }
  const waiting = projectFactsWaiting(project);
  const shownKeys = new Set(rows.flatMap(([label]) => FACT_ROW_KEYS[label] ?? []));
  const under = (label: string) => waiting.filter((row) => (FACT_ROW_KEYS[label] ?? []).includes(row.key));
  // A suggestion for a fact no row shows is a row of its own, with what the fact holds now.
  const own = waiting.filter((row) => !shownKeys.has(row.key));
  const suggestion = (row: FactWaiting) => <FactSuggestion key={`${row.card.id}:${row.key}`} project={project} waiting={row} busy={busy} onAccept={onAccept} onSetAside={onSetAside} />;
  return (
    <Card className={className}>
      <CardHeader title="Key facts" subtitle={project.reference} />
      <CardBody>
        <dl className="divide-y divide-hairline">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-[13px]">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">
                {value}
                {under(label).map(suggestion)}
              </dd>
            </div>
          ))}
          {own.map((row) => (
            <div key={`${row.card.id}:${row.key}`} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-[13px]">
              <dt className="text-ink-secondary">{row.label}</dt>
              <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">
                {row.from ?? <span className="text-ink-muted">Not set</span>}
                {suggestion(row)}
              </dd>
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
            <Link to={cockpitPath(project.id, 'overview')} className="text-[12px] font-medium text-brand">
              All requests
            </Link>
          )
        }
      />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No requests sent. Ask someone for a document from the Overview.</p>
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
                  {daysInWords(e.text)}
                  {e.actor ? <span className="block text-[12px] text-ink-secondary">{person(e.actor)}</span> : null}
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
