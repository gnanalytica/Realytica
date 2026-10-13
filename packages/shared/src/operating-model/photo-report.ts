/**
 * A report's photographs, by place and period.
 *
 * A section of a report asks for the shots of named stations, or of every
 * station at a place, for a period, alone or beside the period before. Code
 * resolves it: the period is the one the report is of (its `from` and `to`
 * where it has them, else the one today is in), each station gives its
 * newest shot of that period, and a station with none is printed as not
 * photographed. Nobody ticks a photograph into this section, and no word in
 * it is a model's: each row is a station, a period, a day and who took it.
 *
 * The older section of photographs a person ticked (`site_photographs`) is
 * untouched and reads as before.
 */

import type { PhotoPlace } from './capture';
import { photoPeriod, photoStations, placeSaid, projectShots, stationPlace, stationShots, type PhotoPeriod, type PhotoStation, type StationShot } from './photo-stations';
import { QUARTER_YEAR_DEFAULT, indiaToday, isQuarter } from './quarters';
import { countSaid, daySaid } from './said';
import type { DdProject, GeneratedReport, ReportBoundSource, ReportPhotosAsk, ReportTable, ResolvedReportBlock } from './types';

/** The most stations one section prints, whatever it asks for. */
export const REPORT_PHOTOS_MOST = 24;

export const STATION_PHOTO_COLUMNS = ['Station', 'Place', 'Period', 'Taken', 'By'] as const;
/** What a row says in its Taken column where the station holds no shot of the period. */
export const NOT_PHOTOGRAPHED = 'Not photographed';

/** A person as a report names them: the name, without the address the record keeps beside it. */
export const shotBySaid = (by: string | undefined): string => (by ?? '').replace(/\s*\([^)]*@[^)]*\)\s*$/, '').trim();

const placeMeets = (of: PhotoPlace, asked: PhotoPlace): boolean => (Object.keys(asked) as Array<keyof PhotoPlace>).every((key) => asked[key] === undefined || of[key] === asked[key]);

/** The stations a section asks for, in the order it names them: the ones named, else the ones at its place, else every one. */
export function stationsAsked(stations: readonly PhotoStation[], ask: Pick<ReportPhotosAsk, 'stations' | 'place'>): PhotoStation[] {
  if (ask.stations?.length) return ask.stations.flatMap((id) => stations.filter((station) => station.id === id));
  return ask.place ? stations.filter((station) => placeMeets(stationPlace(station), ask.place!)) : [...stations];
}

/** The period a section is of, and the one before it. */
export function reportPhotoPeriods(project: Pick<DdProject, 'reportDay'>, source: Pick<ReportBoundSource, 'to' | 'photos'>, at: Date): { period: PhotoPeriod; last: PhotoPeriod } {
  const every = source.photos?.every ?? 'month';
  const year = project.reportDay?.setting?.quarters ?? QUARTER_YEAR_DEFAULT;
  // A report's `to` is the moment its period ends, which is the first moment of the next, and a report's periods are cut in UTC: the day asked of is the one before, as UTC has it.
  const ends = source.to ? Date.parse(source.to) : Number.NaN;
  const day = Number.isNaN(ends) ? indiaToday(at) : new Date(ends - 1).toISOString().slice(0, 10);
  return { period: photoPeriod(day, every, 0, year), last: photoPeriod(day, every, -1, year) };
}

/** A section of photographs by place and period, resolved from the two stores. */
export function resolveStationPhotos(project: DdProject, source: ReportBoundSource, at: Date = new Date()): ResolvedReportBlock {
  const ask: ReportPhotosAsk = source.photos ?? { show: 'period', most: 12 };
  const all = photoStations(project);
  if (!all.length) return { lines: [], recordIds: [], note: 'No photo station is kept on this project. Add them under Site, and their photographs print here by period.' };
  const asked = stationsAsked(all, ask);
  if (!asked.length) return { lines: [], recordIds: [], note: 'No photo station is kept at the place this section asks for.' };
  const most = Math.max(1, Math.min(ask.most || 1, REPORT_PHOTOS_MOST));
  const printed = asked.slice(0, most);
  const { period, last } = reportPhotoPeriods(project, source, at);
  const periods = ask.show === 'period_and_last' ? [last, period] : [period];
  const shots = projectShots(project);
  const within = (station: PhotoStation, of: PhotoPeriod): StationShot | undefined => stationShots(station, shots).find((shot) => shot.day >= of.from && shot.day <= of.to);
  const rows: ReportTable['rows'] = [];
  const lines: string[] = [];
  let taken = 0;
  for (const station of printed) {
    const where = placeSaid(project, stationPlace(station));
    for (const of of periods) {
      const shot = within(station, of);
      if (shot && of === period) taken += 1;
      const by = shotBySaid(shot?.by);
      rows.push({
        cells: [station.label, where, of.said, shot ? daySaid(shot.day) : NOT_PHOTOGRAPHED, by],
        recordId: station.id,
        ...(shot?.evidenceId ? { evidenceIds: [shot.evidenceId] } : {}),
        ...(shot?.siteLog ? { sitePhoto: shot.siteLog } : {}),
      });
      lines.push(shot ? `${station.label}, ${of.said}: taken ${daySaid(shot.day)}${by ? ` by ${by}` : ''}.` : `${station.label}, ${of.said}: not photographed.`);
    }
  }
  const left = asked.length - printed.length;
  return {
    lines,
    recordIds: printed.map((station) => station.id),
    table: { columns: [...STATION_PHOTO_COLUMNS], rows },
    note: `${taken} of ${countSaid(printed.length, 'station')} photographed in ${period.said}.${left > 0 ? ` ${countSaid(left, 'more station')} not printed.` : ''}`,
  };
}

/** The most stations an owner pack prints. */
export const OWNER_PACK_PHOTOS = 6;

/**
 * The photographs an owner pack places under its schedule: the stations'
 * shots for the pack's period beside the period before, a quarter where the
 * pack is of a quarter and a month otherwise. Nothing on a project that
 * keeps no station, so a pack made without them reads as it always did.
 */
export function ownerPackPhotos(project: DdProject, period: { from: string; to: string }, at: Date = new Date()): ResolvedReportBlock | undefined {
  if (!photoStations(project).length) return undefined;
  return resolveStationPhotos(project, { kind: 'station_photographs', to: period.to, photos: { show: 'period_and_last', most: OWNER_PACK_PHOTOS, every: isQuarter(period) ? 'quarter' : 'month' } }, at);
}

/** What is wrong with what a section asks for, in a sentence. Nothing where it can be resolved. */
export function stationPhotosFault(source: ReportBoundSource): string | undefined {
  const ask = source.photos;
  // Asked for with nothing said: every station, this period, as `resolveStationPhotos` reads it.
  if (!ask) return undefined;
  if (ask.show !== 'period' && ask.show !== 'period_and_last') return 'A photographs section shows this period, or this period beside the last.';
  if (!(ask.most >= 1) || ask.most > REPORT_PHOTOS_MOST) return `A photographs section prints between 1 and ${REPORT_PHOTOS_MOST} stations.`;
  return undefined;
}

/**
 * The reports of a copy made for somebody working from a grant, with the
 * photograph sections cut to the stations and the files that copy holds. A
 * section kept as it read the day it was issued keeps only the rows of
 * stations on the copy, and of those only a photograph the copy holds: one
 * still in the site log is the firm's.
 */
export function stationPhotosOfCopy(reports: readonly GeneratedReport[], stationIds: ReadonlySet<string>, evidenceIds: ReadonlySet<string>): GeneratedReport[] {
  return reports.map((report) => {
    let changed = false;
    const blocks = (report.body.blocks ?? []).map((block) => {
      const kind = block.source?.kind ?? block.detachedFrom;
      const rows = block.frozenTable?.rows;
      if (kind !== 'station_photographs' || !rows) return block;
      const keep = rows.map((row) => Boolean(row.recordId && stationIds.has(row.recordId)) && !row.sitePhoto && (row.evidenceIds ?? []).every((id) => evidenceIds.has(id)));
      if (keep.every(Boolean)) return block;
      changed = true;
      const lines = (block.frozen ?? []).filter((_, at) => keep[at]);
      return { ...block, frozen: lines, frozenRecordIds: (block.frozenRecordIds ?? []).filter((id) => stationIds.has(id)), frozenTable: { ...block.frozenTable!, rows: rows.filter((_, at) => keep[at]) }, ...(block.text !== undefined ? { text: lines.join('\n') } : {}) };
    });
    return changed ? { ...report, body: { ...report.body, blocks } } : report;
  });
}
