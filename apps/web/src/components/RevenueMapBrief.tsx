import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Compass, Landmark, Map as MapIcon, Route, ThumbsUp, Waves } from 'lucide-react';
import {
  extentAgainstDocuments,
  revenueSiteBrief,
  surveyNumbersLabel,
  unacceptedWords,
  wholeNumberWords,
  type DdProject,
  type RevenueBriefItem,
  type RevenueExtentParcel,
  type RevenueSiteBrief,
  type RevenueSiteItem,
} from '@realytica/shared';
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
 * A site on several survey numbers is one brief, not one for each: the
 * parcels and what they add up to at the top, and under the headings each
 * finding once, naming the parcel it is about.
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

/** A township can stand on sixty survey numbers; past this many the table folds. */
const PARCELS_SHOWN = 8;

function sqm(n: number): string {
  return `${Math.round(n).toLocaleString()} sqm`;
}

function Item({ item }: { item: RevenueSiteItem }) {
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
  items: RevenueSiteItem[];
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
        {items.map((i, n) => (
          <Item key={`${i.code}${i.featureId ?? ''}${n}`} item={i} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the documents state beside what the map shows for the same land: two
 * figures and the gap, in square metres. Marked when they are far enough
 * apart to raise — and only said, not marked, while some of the numbers the
 * documents name are not read, or where the map holds the whole of a survey
 * number the documents state a part of.
 */
function AgainstDocuments({ extent }: { extent: RevenueSiteBrief['extent'] }) {
  const words = extentAgainstDocuments(extent);
  if (!words) return null;
  const apartPct = extent.documents?.compared?.apartPct ?? 0;
  return (
    <>
      <span className="text-ink-muted">Documents state: </span>
      <span className="tabular-nums text-ink">{words.stated}</span>
      <span className="text-ink-muted"> · </span>
      <span className={cn('tabular-nums', words.apart ? 'font-medium text-[var(--status-warning-text)]' : 'text-ink')}>
        {words.verdict}
        {words.apart ? `, ${apartPct.toFixed(1)}% apart` : ''}
      </span>
    </>
  );
}

/**
 * What a parcel is beyond its number: the whole of a survey number where a
 * part was asked for, so its outline may be more land than the site; and a
 * number that comes off a reading nobody has accepted, in the colour of what
 * a machine suggested.
 */
function Standing({ parcel }: { parcel: Pick<RevenueExtentParcel, 'askedAs' | 'unaccepted'> }) {
  if (!parcel.askedAs.length && !parcel.unaccepted) return null;
  return (
    <>
      {parcel.askedAs.length ? <span className="text-ink-muted">{wholeNumberWords(parcel.askedAs)}</span> : null}
      {parcel.askedAs.length && parcel.unaccepted ? <span className="text-ink-muted"> · </span> : null}
      {parcel.unaccepted ? <span className="text-ai-ink">{unacceptedWords(parcel.unaccepted)}</span> : null}
    </>
  );
}

/** Each parcel's area from its outline beside what the register records for it, what the outlines add up to, and the documents beside that. */
function Parcels({ brief }: { brief: RevenueSiteBrief }) {
  const [all, setAll] = useState(false);
  const rows = all ? brief.extent.parcels : brief.extent.parcels.slice(0, PARCELS_SHOWN);
  // Karnataka's map carries no extent of its own, and a column of dashes says nothing: it is there when a register records one.
  const registers = brief.extent.parcels.some((p) => p.registerExtent);
  const whole = brief.extent.parcels.filter((p) => p.askedAs.length);
  return (
    <div className="space-y-1">
      <table className="w-full text-left text-[12px] sm:w-auto sm:min-w-[20rem]">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-0.5 pr-4 font-medium">Survey no</th>
            <th className="py-0.5 pr-4 text-right font-medium">From the outline</th>
            {registers ? <th className="py-0.5 font-medium">Register records</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline text-ink-secondary">
          {rows.map((p) => (
            <tr key={p.parcelRef} className="align-top">
              <td className="py-0.5 pr-4">
                <span className="font-mono text-ink">{p.label}</span>
                {p.askedAs.length || p.unaccepted ? (
                  <span className="block leading-snug">
                    <Standing parcel={p} />
                  </span>
                ) : null}
              </td>
              <td className="py-0.5 pr-4 text-right tabular-nums text-ink">{sqm(p.areaSqm)}</td>
              {registers ? <td className="py-0.5">{p.registerExtent ? `“${p.registerExtent}”` : '—'}</td> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-hairline align-top font-medium text-ink">
            <td className="py-0.5 pr-4">
              Total, {brief.extent.parcels.length} parcels
              {whole.length ? (
                <span className="block font-normal leading-snug text-ink-muted">with the whole of {surveyNumbersLabel(whole.map((p) => p.label))}</span>
              ) : null}
            </td>
            <td className="py-0.5 pr-4 text-right tabular-nums">{sqm(brief.extent.totalSqm)}</td>
            {registers ? <td /> : null}
          </tr>
        </tfoot>
      </table>
      {rows.length < brief.extent.parcels.length ? (
        <button
          type="button"
          className="rounded text-[12px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          onClick={() => setAll(true)}
        >
          Show all {brief.extent.parcels.length} parcels
        </button>
      ) : null}
      {brief.extent.documents ? (
        <p className="text-[12px] text-ink-secondary">
          <AgainstDocuments extent={brief.extent} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * The prohibited register, for one parcel or for each of several by its
 * number. A listing on one parcel does not answer for the others: where the
 * map they came from is not joined to the register, that silence is said too.
 */
function Register({ brief }: { brief: RevenueSiteBrief }) {
  const listed = brief.parcels.filter((p) => p.register.state === 'listed');
  const unjoined = brief.parcels.filter((p) => p.register.state === 'unjoined');
  const several = brief.parcels.length > 1;
  if (!listed.length && !unjoined.length) return <span className="text-ink">no entry</span>;
  return (
    <>
      {listed.length ? (
        <span className="inline-flex flex-wrap gap-1 align-middle">
          {listed.map((p) => (
            <Badge key={p.parcelRef} tone="critical">
              Listed — {p.register.state === 'listed' ? p.register.category : ''}
              {several ? ` · Sy. ${p.label}` : ''}
            </Badge>
          ))}
        </span>
      ) : null}
      {unjoined.length ? (
        <span className="text-ink">
          {listed.length ? ' · ' : ''}not checkable from this map
          {several && unjoined.length < brief.parcels.length ? ` for ${surveyNumbersLabel(unjoined.map((p) => p.label))}` : ''} — verify the district list
        </span>
      ) : null}
    </>
  );
}

export function RevenueMapBrief({ project, className }: { project: DdProject; className?: string }) {
  const brief = useMemo(() => revenueSiteBrief(project), [project]);
  if (!brief) return null;
  const several = brief.parcels.length > 1;
  const first = brief.parcels[0];
  const numbers = brief.parcels.map((p) => p.label);
  const sources = [...new Set(brief.parcels.map((p) => p.source))].join(' and ');
  const places = [...new Set(brief.parcels.map((p) => p.place))];
  const readOn = brief.parcels.reduce((latest, p) => (p.readOn > latest ? p.readOn : latest), '');
  const classes = [...new Set(brief.parcels.map((p) => p.classification).filter(Boolean))];
  // Karnataka's map gives a parcel's hobli and no class of land. A hobli is a place, and is said as one.
  const hoblis = [...new Set(brief.parcels.map((p) => p.hobli).filter(Boolean))];
  const nothingFound = !brief.warnings.length && !brief.planned.length && !brief.zoning.length && !brief.nearby.length && !brief.positives.length;

  return (
    <div className={cn('space-y-4 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-ink">What the state’s maps say about {surveyNumbersLabel(numbers)}</h3>
        <span className="text-[12px] text-ink-muted">
          {places.length === 1 ? `${places[0]} · ` : ''}
          {sources} · read {readOn}
        </span>
      </div>

      {several ? <Parcels brief={brief} /> : null}

      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] text-ink-secondary sm:grid-cols-2">
        {several ? null : (
          <li>
            <span className="text-ink-muted">Extent on the map: </span>
            <span className="tabular-nums text-ink">{first.extentSqm.toLocaleString()} sqm</span>
            {first.registerExtent ? <span className="text-ink-muted"> (register says “{first.registerExtent}”)</span> : null}
            {first.askedAs.length || first.unaccepted ? (
              <>
                <span className="text-ink-muted"> · </span>
                <Standing parcel={first} />
              </>
            ) : null}
          </li>
        )}
        {!several && brief.extent.documents ? (
          <li>
            <AgainstDocuments extent={brief.extent} />
          </li>
        ) : null}
        {classes.length ? (
          <li>
            <span className="text-ink-muted">Revenue class: </span>
            <span className="text-ink">
              {classes.length === 1
                ? classes[0]
                : classes.map((c) => `${c} (${surveyNumbersLabel(brief.parcels.filter((p) => p.classification === c).map((p) => p.label))})`).join(' · ')}
            </span>
          </li>
        ) : null}
        {hoblis.length ? (
          <li>
            <span className="text-ink-muted">Hobli: </span>
            <span className="text-ink">
              {hoblis.length === 1
                ? hoblis[0]
                : hoblis.map((h) => `${h} (${surveyNumbersLabel(brief.parcels.filter((p) => p.hobli === h).map((p) => p.label))})`).join(' · ')}
            </span>
          </li>
        ) : null}
        <li>
          <span className="text-ink-muted">Prohibited register: </span>
          <Register brief={brief} />
        </li>
        {brief.guidance ? (
          <li>
            <span className="text-ink-muted">Guidance value{brief.guidance.locality ? ` (${brief.guidance.locality})` : ''}: </span>
            <span className="tabular-nums text-ink">
              ₹{brief.guidance.perUnit.toLocaleString()} per {brief.guidance.unit === 'sqyd' ? 'sq yd' : 'sq ft'}
            </span>
            {several ? <span className="text-ink-muted"> · Sy. {brief.guidance.surveyNo}</span> : null}
            {brief.guidance.differing.length ? (
              <span className="text-ink">
                {' '}
                · differs: {brief.guidance.differing.map((d) => `Sy. ${d.surveyNo} ₹${d.perUnit.toLocaleString()}`).join(', ')}
              </span>
            ) : null}
            {several && brief.guidance.unpriced.length ? <span className="text-ink"> · none published for {surveyNumbersLabel(brief.guidance.unpriced)}</span> : null}
          </li>
        ) : null}
      </ul>

      {nothingFound ? (
        <p className="text-[13px] text-ink-secondary">
          No government layer flagged anything within 3 km of {several ? 'these parcels' : 'this parcel'}.
        </p>
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
            Not checked (server did not answer):{' '}
            {brief.notChecked
              .map((u) => (several && u.parcels.length < brief.parcels.length ? `${u.layer} (${surveyNumbersLabel(u.parcels)})` : u.layer))
              .join(', ')}
            . Read again later.
          </span>
        </p>
      ) : null}

      <p className="text-[12px] leading-snug text-ink-muted">
        Government maps read by machine. Not a survey, not evidence — the extract still has to be attached by a person.
      </p>
    </div>
  );
}
