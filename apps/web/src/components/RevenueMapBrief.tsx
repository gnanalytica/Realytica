import type { ReactNode } from 'react';
import { AlertTriangle, Compass, Landmark, Map as MapIcon, Route, ThumbsUp, Waves } from 'lucide-react';
import { revenueMapBrief, type RevenueBriefItem, type RevenueMapRead } from '@realytica/shared';
import { Badge, cn, type Tone } from './ui/kit';

/**
 * The revenue-map read as points, not prose.
 *
 * The hits under the map were sentences — a headline, the rule behind it and
 * the source, run together, eight of them in a row. Nobody scans that. A
 * reader asks five short questions of a survey number: what is wrong with it,
 * what is coming near it, what does the plan say it is, what else is around
 * it, and what does the state say it is worth. Those are the headings, and
 * each answer is one line with the rule folded beneath it in smaller type.
 *
 * The engine's percentages never appear here. A number beside a lake reads as
 * the adjustment rather than as one engine's opinion of one; see the design
 * note for the revenue map.
 */

const TONE: Record<RevenueBriefItem['tone'], Tone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  good: 'good',
};

const TONE_WORD: Record<RevenueBriefItem['tone'], string> = {
  critical: 'Blocks',
  warning: 'Warning',
  info: 'Note',
  good: 'Plus',
};

function Item({ item }: { item: RevenueBriefItem }) {
  return (
    <li className="flex gap-2">
      <Badge tone={TONE[item.tone]} className="mt-0.5 shrink-0 self-start">
        {TONE_WORD[item.tone]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-ink">
          <span className="font-medium">{item.title}</span>
          {item.where ? <span className="text-ink-muted"> · {item.where}</span> : null}
        </p>
        <p className="text-[13px] leading-snug text-ink-secondary">{item.says}</p>
        {item.why ? <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{item.why}</p> : null}
      </div>
    </li>
  );
}

function Section({
  icon,
  title,
  items,
  hint,
}: {
  icon: ReactNode;
  title: string;
  items: RevenueBriefItem[];
  hint?: string;
}) {
  if (!items.length) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
        {icon}
        {title}
        <span className="tabular-nums">({items.length})</span>
        {hint ? <span className="font-normal"> — {hint}</span> : null}
      </h4>
      <ul className="space-y-2">
        {items.map((i) => (
          <Item key={i.code + (i.featureId ?? '')} item={i} />
        ))}
      </ul>
    </section>
  );
}

export function RevenueMapBrief({ read, className }: { read: RevenueMapRead; className?: string }) {
  const brief = revenueMapBrief(read);
  const nothingFound = !brief.warnings.length && !brief.planned.length && !brief.zoning.length && !brief.nearby.length && !brief.positives.length;

  return (
    <div className={cn('space-y-4 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-ink">
          What the state’s maps say about Sy. {brief.parcel.surveyNo}
        </h3>
        <span className="text-[12px] text-ink-muted">
          {brief.parcel.place} · {brief.parcel.source} · read {brief.parcel.readOn}
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] text-ink-secondary sm:grid-cols-2">
        <li>
          <span className="text-ink-muted">Extent on the map: </span>
          <span className="tabular-nums text-ink">{brief.parcel.extentSqm.toLocaleString()} sqm</span>
          {brief.parcel.registerExtent ? <span className="text-ink-muted"> (register says “{brief.parcel.registerExtent}”)</span> : null}
        </li>
        {brief.parcel.classification ? (
          <li>
            <span className="text-ink-muted">Revenue class: </span>
            <span className="text-ink">{brief.parcel.classification}</span>
          </li>
        ) : null}
        <li>
          <span className="text-ink-muted">Prohibited register: </span>
          {brief.register.state === 'listed' ? (
            <Badge tone="critical">Listed — {brief.register.category}</Badge>
          ) : brief.register.state === 'unjoined' ? (
            <span className="text-ink">not checkable from this map — verify the district list</span>
          ) : (
            <span className="text-ink">no entry</span>
          )}
        </li>
        {brief.guidance ? (
          <li>
            <span className="text-ink-muted">Guidance value{brief.guidance.locality ? ` (${brief.guidance.locality})` : ''}: </span>
            <span className="tabular-nums text-ink">
              ₹{brief.guidance.perUnit.toLocaleString()} per {brief.guidance.unit === 'sqyd' ? 'sq yd' : 'sq ft'}
            </span>
          </li>
        ) : null}
      </ul>

      {nothingFound ? (
        <p className="text-[13px] text-ink-secondary">No government layer flagged anything within 3 km of this parcel.</p>
      ) : null}

      <Section icon={<AlertTriangle size={13} />} title="Warnings" items={brief.warnings} />
      <Section icon={<Route size={13} />} title="Planned near the plot" items={brief.planned} hint="roads, rail, widening, stations" />
      <Section icon={<MapIcon size={13} />} title="Town planning says" items={brief.zoning} />
      <Section icon={<Waves size={13} />} title="Also nearby" items={brief.nearby} />
      <Section icon={<ThumbsUp size={13} />} title="In the plot’s favour" items={brief.positives} />

      {brief.guidance ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-muted">
          <Landmark size={13} className="mt-0.5 shrink-0" />
          <span>{brief.guidance.note}</span>
        </p>
      ) : null}

      {brief.notChecked.length ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink">
          <Compass size={13} className="mt-0.5 shrink-0" />
          <span>
            Not checked (server did not answer): {brief.notChecked.map((u) => u.layer).join(', ')}. Read again later.
          </span>
        </p>
      ) : null}

      <p className="text-[12px] leading-snug text-ink-muted">
        Government maps read by machine. Not a survey, not evidence — the extract still has to be attached by a person.
      </p>
    </div>
  );
}
