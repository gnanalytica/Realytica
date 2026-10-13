/**
 * The figures of the photo stations, for the Site record's sheets to read.
 *
 * A station's shots are kept in the site log and on the document register,
 * never on its sheet, so what its sheet says of them is read here: how many
 * shots, the day of the last, how many periods behind it is. Above the
 * stations, the round reads how many are shot and how many are not this
 * period, how many recent photographs wait for a place, and how many
 * milestones are reported complete with a required photograph missing.
 *
 * Each is null, never nought, on a project that keeps no station: a project
 * with photographs and no stations is told nothing about a round it does
 * not run.
 */

import { dayNumber } from './check-fields';
import type { ProjectFigure } from './field-figures';
import { milestonePhotoChecklist, milestonesShortOfPhotos, stationRound, type StationRound, type StationRow } from './photo-stations';
import type { DdProject } from './types';

interface Round {
  round: StationRound;
  short: number;
}

/** The round as it stands, worked out once for a reading however many figures a sheet names. */
function roundOf(project: DdProject, at: Date, shared: Map<string, unknown>): Round | null {
  if (!shared.has('photo_round')) {
    const round = stationRound(project, at);
    shared.set('photo_round', round.rows.length ? { round, short: milestonesShortOfPhotos(milestonePhotoChecklist(project, at)).length } : null);
  }
  return shared.get('photo_round') as Round | null;
}

const ofRound = (read: (held: Round) => number) => (project: DdProject, at: Date, _of: string | undefined, shared: Map<string, unknown>) => {
  const held = roundOf(project, at, shared);
  return held ? read(held) : null;
};

const ofStation = (read: (row: StationRow) => number | null) => (project: DdProject, at: Date, of: string | undefined, shared: Map<string, unknown>) => {
  const row = roundOf(project, at, shared)?.round.rows.find((held) => held.station.id === of);
  return row ? read(row) : null;
};

const FROM = 'photo stations';

export const PHOTO_FIGURES: Readonly<Record<string, ProjectFigure>> = {
  'photos.stations': { label: 'Photo stations kept', from: FROM, read: ofRound((held) => held.round.rows.length) },
  'photos.stations_shot': { label: 'Stations photographed this period', from: FROM, read: ofRound((held) => held.round.rows.length - held.round.due.length) },
  'photos.stations_due': { label: 'Stations not photographed this period', from: FROM, read: ofRound((held) => held.round.due.length) },
  'photos.stations_overdue': { label: 'Stations a whole period behind', from: FROM, read: ofRound((held) => held.round.due.filter((row) => row.standing === 'overdue').length) },
  'photos.place_not_set': { label: 'Recent photographs with no place set', from: FROM, read: ofRound((held) => held.round.placeNotSet.length) },
  'photos.milestones_short': { label: 'Milestones reported complete with a required photograph missing', from: FROM, read: ofRound((held) => held.short) },

  'photos.station_shots': { label: 'Shots of the station', from: FROM, own: true, read: ofStation((row) => row.shots.length) },
  'photos.station_last_shot': { label: 'Day of the station’s last shot', from: FROM, own: true, read: ofStation((row) => dayNumber(row.lastDay)) },
  'photos.station_behind': { label: 'Periods since the station’s last shot', from: FROM, own: true, read: ofStation((row) => row.behind ?? null) },
};
