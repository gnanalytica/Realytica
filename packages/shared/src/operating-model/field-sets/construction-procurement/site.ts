/**
 * The Site record's fields: the photo stations and the round above them.
 *
 * A station is a place shot again and again from the same spot. Its shots
 * are photographs, kept where photographs are kept (the site log and the
 * document register); the station's sheet holds only where it is and how
 * often it is to be shot, and reads the rest as figures
 * (`photo-figures.ts`). Its standing is worked out each time it is read.
 *
 * The round is the one sheet above them. What needs a person is said there
 * once, as a count: the stations not photographed this period are one line
 * under Needs you, not one for each station, so a station's own standing is
 * never in a tone that would raise a line of its own.
 */

import { PHOTO_ELEMENTS, PHOTO_ELEMENT_LABEL } from '../../photo-picks';
import { SITE_FN, STATIONS_SET, STATION_EVERY, STATION_EVERY_LABEL, STATION_ROUND_SET } from '../../photo-stations';
import type { FieldSet } from '../../types';
import { at, computed, computedDay, countOf, figure, text } from './parts';

export const SITE_SETS: FieldSet[] = [
  {
    id: STATION_ROUND_SET,
    fn: SITE_FN,
    title: 'Photograph round',
    v: 1,
    fields: [
      computed('stations', 'Stations', countOf(STATIONS_SET), { precision: 0 }),
      computed('shot', 'Photographed this period', figure('photos.stations_shot'), { precision: 0 }),
      computed('due', 'Not photographed this period', figure('photos.stations_due'), { precision: 0 }),
      computed('overdue', 'A whole period behind', figure('photos.stations_overdue'), { precision: 0 }),
      computed('place_not_set', 'Recent photographs with no place set', figure('photos.place_not_set'), { precision: 0 }),
      computed('milestones_short', 'Milestones complete with a required photograph missing', figure('photos.milestones_short'), { precision: 0 }),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        cases: [
          { when: { kind: 'at_least', fields: ['stations'], against: 1, say: 'No photo station is kept.', severity: 'low' }, label: 'No station kept', tone: 'neutral' },
          { when: { kind: 'at_most', fields: ['milestones_short'], against: 0, say: 'Milestones reported complete with a required photograph missing: {a}.', severity: 'high' }, label: 'Milestone photographs missing', tone: 'critical' },
          { when: { kind: 'at_most', fields: ['due'], against: 0, say: 'Stations with no photograph this period: {a}.', severity: 'medium' }, label: 'Stations to photograph', tone: 'warning' },
        ],
        otherwise: { label: 'Every station photographed this period', tone: 'good' },
      },
    ],
    rules: [
      { kind: 'at_most', fields: ['milestones_short'], against: 0, say: 'Milestones reported complete with a required photograph missing: {a}.', severity: 'high' },
      { kind: 'at_most', fields: ['due'], against: 0, say: 'Stations with no photograph this period: {a}.', severity: 'medium' },
      { kind: 'at_most', fields: ['place_not_set'], against: 0, say: 'Recent photographs with no place set: {a}.', severity: 'medium' },
    ],
  },
  {
    id: STATIONS_SET,
    fn: SITE_FN,
    title: 'Photo stations',
    v: 1,
    records: { of: 'station', titleField: 'label', summaryFields: ['building', 'every', 'standing'] },
    optionSets: [
      { id: 'photo_element', label: 'Element', options: PHOTO_ELEMENTS.map((key) => ({ key, label: PHOTO_ELEMENT_LABEL[key] })) },
      { id: 'station_every', label: 'How often', options: STATION_EVERY.map((key) => ({ key, label: STATION_EVERY_LABEL[key] })) },
    ],
    fields: [
      text('label', 'Station'),
      { key: 'building', label: 'Building or wing', kind: 'ref', target: 'building', required: false },
      text('floor', 'Floor', { required: false }),
      { key: 'element', label: 'Element', kind: 'enum', optionSet: 'photo_element', required: false },
      { key: 'milestone', label: 'Milestone', kind: 'ref', target: 'milestone', required: false },
      { key: 'needed', label: 'Its photograph is needed before the milestone reads complete', kind: 'boolean', control: 'tick', required: false, tier: 'situational', showWhen: { field: at(SITE_FN, STATIONS_SET, 'milestone'), is: 'set' } },
      { key: 'every', label: 'To be photographed', kind: 'enum', control: 'segmented', optionSet: 'station_every' },
      { key: 'shots', label: 'Shots', kind: 'evidence', accepts: 'image', viewer: 'series', required: false },
      { key: 'lat', label: 'Latitude it is shot from', kind: 'number', min: -90, max: 90, precision: 6, required: false, tier: 'expert' },
      { key: 'lng', label: 'Longitude it is shot from', kind: 'number', min: -180, max: 180, precision: 6, required: false, tier: 'expert' },
      computed('shots_taken', 'Shots taken', figure('photos.station_shots'), { precision: 0, tier: 'expert' }),
      computed('behind', 'Periods since the last shot', figure('photos.station_behind'), { precision: 0, tier: 'expert' }),
      computedDay('last_shot_on', 'Last photographed', figure('photos.station_last_shot')),
      {
        key: 'standing',
        label: 'Standing',
        kind: 'status',
        // Never in a tone that raises a line: what is due is one line on the round, with its count.
        cases: [
          { when: { kind: 'at_least', fields: ['shots_taken'], against: 1, say: 'This station has never been photographed.', severity: 'low' }, label: 'Never shot', tone: 'neutral' },
          { when: { kind: 'at_most', fields: ['behind'], against: 1, say: 'This station has gone a whole period without a photograph.', severity: 'low' }, label: 'Overdue', tone: 'info' },
          { when: { kind: 'at_most', fields: ['behind'], against: 0, say: 'This station has no photograph this period.', severity: 'low' }, label: 'Due', tone: 'info' },
        ],
        otherwise: { label: 'Shot this period', tone: 'good' },
      },
    ],
    rules: [],
  },
];
