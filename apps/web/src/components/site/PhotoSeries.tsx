/**
 * Photographs of one place over time.
 *
 * The series viewer shows the shots of a station, or the photographs a field
 * holds, by the period each was taken in, the newest first, with two periods
 * side by side: this one and the last, or any two picked. Under each
 * photograph is its date and who took it, and nothing else. On a phone the
 * two stack.
 *
 * Around it, on the Site record's sheets: the stations not photographed this
 * period, the photographs each milestone needs, and the recent photographs
 * that name no place, each with the one thing a person does about it. Where
 * a photograph was taken is a station or links to what the project keeps; a
 * model's pick of an element is offered and taken by a person, and words a
 * model wrote before photographs were read as picks are shown marked as such.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PHOTO_ELEMENTS,
  PHOTO_ELEMENT_LABEL,
  PLACE_FLOOR_MOST,
  asAtMoment,
  STATIONS_SET,
  STATION_ROUND_SET,
  STATION_STANDING_LABEL,
  daySaid,
  milestonePhotoChecklist,
  milestonePhotoSaid,
  photoSeries,
  photoStations,
  placeSaid,
  projectShots,
  refChoices,
  seriesPair,
  shotsOfEvidence,
  stationPlace,
  stationRound,
  stationShots,
  type CheckFieldDef,
  type DdProject,
  type PhotoElement,
  type PhotoPlace,
  type SeriesGroup,
  type StationEvery,
  type StationShot,
  type StationStanding,
} from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { personNamed } from '../../lib/format';
import { useAuthedUrl } from '../../lib/useAuthedUrl';
import { workspaceApi } from '../../lib/workspace-api';
import { Badge, Button, cn, useToast } from '../ui/kit';

/** The project a sheet's photographs are read from, and how a station's own sheet is opened from a line that names it. */
export const PhotoProject = createContext<{ project: DdProject; onChanged: (project: DdProject) => void; mayEdit: boolean; openRecord?: (set: string, record: string) => void } | null>(null);
/** The sheet, and the record of it, a field is drawn on. */
export const PhotoHolder = createContext<{ set: string; record?: string } | null>(null);

const STANDING_TONE: Record<StationStanding, 'good' | 'info' | 'warning' | 'neutral'> = { shot: 'good', due: 'info', overdue: 'warning', never: 'neutral' };
const quartersOf = (project: DdProject) => project.reportDay?.setting?.quarters;

function shotPath(project: DdProject, shot: StationShot): string | undefined {
  if (shot.evidenceId && shot.fileId) return evidenceFileUrl(project.id, shot.evidenceId, shot.fileId, { inline: true });
  return shot.siteLog ? workspaceApi.sitePhotoUrl(project.id, shot.siteLog.entryId, shot.siteLog.index) : undefined;
}

/** One photograph, drawn. Empty until its bytes arrive. */
export function ShotImage({ project, shot, className, print = false }: { project: DdProject; shot: StationShot; className?: string; print?: boolean }) {
  const { url } = useAuthedUrl(shotPath(project, shot));
  return (
    <span className={cn('grid place-items-center overflow-hidden rounded-lg', print ? 'border border-neutral-300 bg-neutral-100' : 'bg-sunken ring-1 ring-inset ring-[var(--ring)]', className)}>
      {url ? <img src={url} alt={`Photograph taken ${daySaid(shot.day)}`} className="size-full object-cover" /> : <Camera size={16} className="text-ink-muted" aria-hidden />}
    </span>
  );
}

/** Under a photograph: the day it was taken and who took it, as the project's team names them. */
function shotSaid(project: DdProject, shot: StationShot): string {
  const by = personNamed(project, shot.by);
  return by ? `${daySaid(shot.day)} · ${by}` : daySaid(shot.day);
}

/** The moment a project in hand is read at: the end of the day it is read as at, else now. */
const readAt = (project: DdProject): Date => (project.asAt ? asAtMoment(project.asAt) : new Date());

function Side({ project, group, groups, label, onPick }: { project: DdProject; group: SeriesGroup; groups: readonly SeriesGroup[]; label: string; onPick: (key: string) => void }) {
  // A period shot more than once shows its newest shot, and steps to the others: the two sides stay level.
  const [step, setStep] = useState<{ key: string; at: number }>({ key: group.period.key, at: 0 });
  const at = step.key === group.period.key ? Math.min(step.at, group.shots.length - 1) : 0;
  const shot = group.shots[at]!;
  const to = (next: number) => setStep({ key: group.period.key, at: next });
  const stepCls = 'grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-sunken disabled:opacity-40 coarse:size-11';
  return (
    <section className="min-w-0 space-y-2" data-series-side={group.period.key}>
      <div className="flex min-h-8 items-center justify-between gap-2">
        {groups.length > 2 ? (
          <select aria-label={label} value={group.period.key} onChange={(event) => onPick(event.target.value)} className="h-8 min-w-0 rounded-md border border-hairline bg-surface px-2 text-[13px] font-semibold text-ink coarse:h-11">
            {groups.map((held) => (
              <option key={held.period.key} value={held.period.key}>
                {held.period.label}
              </option>
            ))}
          </select>
        ) : (
          <h4 className="text-[13px] font-semibold text-ink">{group.period.label}</h4>
        )}
        {group.shots.length > 1 ? (
          <span className="flex shrink-0 items-center text-[12px] text-ink-muted">
            <button type="button" aria-label={`A later shot of ${group.period.label}`} disabled={at === 0} onClick={() => to(at - 1)} className={stepCls}>
              <ChevronLeft size={14} aria-hidden />
            </button>
            <span className="font-mono tabular-nums">
              {at + 1} of {group.shots.length}
            </span>
            <button type="button" aria-label={`An earlier shot of ${group.period.label}`} disabled={at === group.shots.length - 1} onClick={() => to(at + 1)} className={stepCls}>
              <ChevronRight size={14} aria-hidden />
            </button>
          </span>
        ) : null}
      </div>
      <figure>
        <ShotImage project={project} shot={shot} className="aspect-[4/3] w-full" />
        <figcaption className="mt-1 text-[12px] text-ink-secondary">{shotSaid(project, shot)}</figcaption>
      </figure>
    </section>
  );
}

/**
 * The series viewer: every period that holds a shot in a strip, newest
 * first, and two of them side by side.
 */
export function PhotoSeries({ project, shots, every }: { project: DdProject; shots: readonly StationShot[]; every: StationEvery }) {
  // Read as at a past day, the series ends with the period that day is in.
  const groups = useMemo(() => photoSeries(shots, every, quartersOf(project), project.asAt), [shots, every, project]);
  const [picked, setPicked] = useState<{ left?: string; right?: string }>({});
  const pair = seriesPair(groups, picked);
  if (!pair.right) return <p className="text-[12px] text-ink-muted">No photograph yet.</p>;
  const shown = new Set([pair.left?.period.key, pair.right.period.key]);
  // A period pressed in the strip is put beside the later one; the later one itself is changed from its own list.
  const press = (group: SeriesGroup) => setPicked(group.period.from < pair.right!.period.from ? { left: group.period.key, right: pair.right!.period.key } : { left: pair.left?.period.key, right: group.period.key });
  return (
    <div className="space-y-3" data-series>
      {groups.length > 2 ? (
        <ol className="flex gap-2 overflow-x-auto pb-1" aria-label="Periods photographed, newest first">
          {groups.map((group) => (
            <li key={group.period.key} className="shrink-0">
              <button type="button" aria-pressed={shown.has(group.period.key)} onClick={() => press(group)} className={cn('block w-24 rounded-lg p-1 text-left hover:bg-sunken coarse:min-h-11', shown.has(group.period.key) && 'bg-sunken ring-1 ring-inset ring-[var(--ring)]')}>
                <ShotImage project={project} shot={group.shots[0]!} className="aspect-[4/3] w-full" />
                <span className="mt-1 block truncate text-[11px] text-ink-secondary">{group.period.label}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className={cn('grid grid-cols-1 gap-3', pair.left && 'sm:grid-cols-2')}>
        {pair.left ? <Side project={project} group={pair.left} groups={groups} label="Earlier period" onPick={(key) => setPicked({ left: key, right: pair.right!.period.key })} /> : null}
        <Side project={project} group={pair.right} groups={groups} label="Later period" onPick={(key) => setPicked({ left: pair.left?.period.key, right: key })} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Where a photograph was taken                                          */
/* ------------------------------------------------------------------ */

const selectCls = 'h-8 min-w-0 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11';

/**
 * One photograph's place: said in a line, and set by a person. A station
 * gives the photograph its own place; the links beside it add to that.
 */
export function ShotPlace({ project, shot, mayEdit, onChanged }: { project: DdProject; shot: StationShot; mayEdit: boolean; onChanged: (project: DdProject) => void }) {
  const toast = useToast();
  const stations = useMemo(() => photoStations(project), [project]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ stationId: string; place: PhotoPlace }>({ stationId: shot.stationId ?? '', place: shot.place ?? {} });
  const station = stations.find((held) => held.id === shot.stationId);
  const said = placeSaid(project, shot.place, station?.label) || shot.zone || '';
  const ref = shot.evidenceId ? { evidenceId: shot.evidenceId } : { entryId: shot.siteLog!.entryId, index: shot.siteLog!.index };
  const send = (body: { stationId?: string | null; place?: PhotoPlace | null }) => {
    setBusy(true);
    void workspaceApi
      .setPhotoPlace(project.id, { ...ref, ...body })
      .then((out) => {
        onChanged(out.project);
        setOpen(false);
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That place could not be set', 'critical'))
      .finally(() => setBusy(false));
  };
  const part = (key: 'building' | 'unit' | 'milestone', label: string) => (
    <select aria-label={label} value={draft.place[key] ?? ''} onChange={(event) => setDraft((held) => ({ ...held, place: { ...held.place, [key]: event.target.value || undefined } }))} className={selectCls}>
      <option value="">{label}…</option>
      {refChoices(project, key).map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-1.5 text-[12px]" data-shot-place={shot.key}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ink-secondary">
        <span className="text-ink">{said || 'Place not set'}</span>
        {shot.placed?.how === 'near' ? <span className="text-ink-muted">matched by position, {shot.placed.metres} m from the station</span> : null}
        {mayEdit ? (
          <button type="button" className="font-medium text-brand hover:underline coarse:min-h-11" onClick={() => setOpen((was) => !was)}>
            {said ? 'Change' : 'Set place'}
          </button>
        ) : null}
      </p>
      {shot.offer && mayEdit ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-ink-secondary">
          <span>Element a model picked: {PHOTO_ELEMENT_LABEL[shot.offer.element]}</span>
          <button type="button" disabled={busy} className="font-medium text-brand hover:underline coarse:min-h-11" onClick={() => send({ place: { ...(shot.place ?? {}), element: shot.offer!.element } })}>
            Accept
          </button>
        </p>
      ) : null}
      {shot.writtenBefore ? (
        <p className="text-ink-secondary">
          {shot.writtenBefore} <span className="text-ink-muted">Written by a model, before this change.</span>
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline p-2">
          <select aria-label="Station" value={draft.stationId} onChange={(event) => setDraft((held) => ({ ...held, stationId: event.target.value }))} className={selectCls}>
            <option value="">No station</option>
            {stations.map((held) => (
              <option key={held.id} value={held.id}>
                {held.label}
              </option>
            ))}
          </select>
          {part('building', 'Building')}
          <input aria-label="Floor" placeholder="Floor" maxLength={PLACE_FLOOR_MOST} value={draft.place.floor ?? ''} onChange={(event) => setDraft((held) => ({ ...held, place: { ...held.place, floor: event.target.value || undefined } }))} className={cn(selectCls, 'w-24')} />
          {part('unit', 'Unit')}
          {part('milestone', 'Milestone')}
          <select aria-label="Element" value={draft.place.element ?? ''} onChange={(event) => setDraft((held) => ({ ...held, place: { ...held.place, element: (event.target.value || undefined) as PhotoElement | undefined } }))} className={selectCls}>
            <option value="">Element…</option>
            {PHOTO_ELEMENTS.map((key) => (
              <option key={key} value={key}>
                {PHOTO_ELEMENT_LABEL[key]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => send({ stationId: draft.stationId || null, place: Object.values(draft.place).some(Boolean) ? draft.place : null })}>
            Save place
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A field that holds photographs                                        */
/* ------------------------------------------------------------------ */

/**
 * The photographs of a field, through the series viewer. A station's shots
 * are its own, from the site log and the register alike. Any other field's
 * photographs are drawn this way once they span more than one period;
 * until then `fallback` is drawn, as before. Each takes a place.
 */
export function FieldPhotos({ def, ids, fallback }: { def: CheckFieldDef; ids: readonly string[]; fallback: ReactNode }) {
  const held = useContext(PhotoProject);
  const holder = useContext(PhotoHolder);
  const project = held?.project;
  const station = useMemo(() => (project && holder?.set === STATIONS_SET && holder.record ? photoStations(project).find((one) => one.id === holder.record) : undefined), [project, holder]);
  const shots = useMemo(() => (!project ? [] : station ? stationShots(station, projectShots(project)) : shotsOfEvidence(project, ids)), [project, station, ids]);
  if (!held || !project) return <>{fallback}</>;
  const series = def.viewer === 'series' || photoSeries(shots, 'month').length > 1;
  return (
    <div className="mt-2 space-y-2">
      {series ? <PhotoSeries project={project} shots={shots} every={station?.every ?? 'month'} /> : fallback}
      {!station && shots.length ? (
        <details>
          <summary className="cursor-pointer select-none text-[12px] font-medium text-ink-secondary coarse:min-h-11">Where each was taken</summary>
          <ul className="mt-1.5 space-y-2">
            {shots.map((shot) => (
              <li key={shot.key} className="flex gap-2">
                <ShotImage project={project} shot={shot} className="size-12 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-muted">{shotSaid(project, shot)}</p>
                  <ShotPlace project={project} shot={shot} mayEdit={held.mayEdit} onChanged={held.onChanged} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inside the round's sheet                                              */
/* ------------------------------------------------------------------ */

/**
 * What the round's one line under Needs you opens on: the stations not
 * photographed this period, each with where it stands and its last shot;
 * the photographs each milestone needs, ticked or not; and the recent
 * photographs that name no place.
 */
function RoundInside() {
  const held = useContext(PhotoProject);
  const project = held?.project;
  const round = useMemo(() => (project ? stationRound(project, readAt(project)) : undefined), [project]);
  const checks = useMemo(() => (project ? milestonePhotoChecklist(project, readAt(project)) : []), [project]);
  if (!held || !project || !round?.rows.length) return null;
  return (
    <div className="space-y-4" data-photo-round>
      {round.due.length ? (
        <section className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-ink">Not photographed this period</h4>
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {round.due.map((row) => (
              <li key={row.station.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {row.guide ? <ShotImage project={project} shot={row.guide} className="size-10 shrink-0 opacity-60" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{row.station.label}</span>
                  <span className="block truncate text-[12px] text-ink-muted">
                    {[placeSaid(project, stationPlace(row.station)), row.period.label, row.lastDay ? `last shot ${daySaid(row.lastDay)}` : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <Badge tone={STANDING_TONE[row.standing]}>{STATION_STANDING_LABEL[row.standing]}</Badge>
                {held.openRecord ? (
                  <button type="button" className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11" onClick={() => held.openRecord!(STATIONS_SET, row.station.id)}>
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {checks.length ? (
        <section className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-ink">Photographs each milestone needs</h4>
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.milestoneId} className="rounded-lg border border-hairline px-3 py-2">
                <p className={cn('text-[13px]', check.complete && check.short && !check.waived ? 'font-medium text-critical' : 'text-ink')}>{milestonePhotoSaid(check)}</p>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {check.stations.map((row) => (
                    <li key={row.id} className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                      <input type="checkbox" checked={row.have} readOnly disabled aria-label={`${row.label}: ${row.have ? 'photographed' : 'not photographed'}`} className="size-3.5" />
                      {row.label}
                      {row.day ? <span className="text-ink-muted">{daySaid(row.day)}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {round.placeNotSet.length ? (
        <section className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-ink">Place not set</h4>
          <ul className="space-y-2">
            {round.placeNotSet.slice(0, 12).map((shot) => (
              <li key={shot.key} className="flex gap-2 rounded-lg border border-hairline p-2">
                <ShotImage project={project} shot={shot} className="size-16 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-muted">{shotSaid(project, shot)}</p>
                  <ShotPlace project={project} shot={shot} mayEdit={held.mayEdit} onChanged={held.onChanged} />
                </div>
              </li>
            ))}
          </ul>
          {round.placeNotSet.length > 12 ? <p className="text-[12px] text-ink-muted">and {round.placeNotSet.length - 12} more.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

/** What a sheet draws below its fields, where it is one of the Site record's. Nothing for any other sheet. */
export function SheetInside({ set }: { set: string }) {
  return set === STATION_ROUND_SET ? <RoundInside /> : null;
}
