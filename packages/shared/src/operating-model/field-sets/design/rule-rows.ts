/**
 * The figures a code or a regulation sets for the design functions, and the
 * ones it sets that nobody has yet read in the instrument.
 *
 * `DESIGN_RULE_ROWS` are figures with a value. Not one was read in the
 * official primary text: each came from a secondary summary, a press report
 * or a search excerpt, and its `clause` says which, so each is unverified
 * and shows as unverified beside every value worked out from it.
 *
 * `DESIGN_RULE_SHAPES` are limits the sheets compare against whose figures
 * could not be read at all: what each is keyed by and where it is written,
 * with no value. A formula that reads one gives no answer, and the standing
 * over it says the limit is not on file, until a person loads the rows from
 * the instrument.
 */

import type { RuleRow, RuleShape } from '../../types';

const BENGALURU = { state: 'Karnataka', city: 'Bengaluru' };
const NBC = 'National Building Code of India 2016';
const ZONING = 'Zoning Regulations, Revised Master Plan 2015, Bengaluru';
const ZONING_URL = 'https://site.bbmp.gov.in/PDF/townplanning/Zoning_Regulations_RMP2015f%20(1).pdf';
const AMENDMENT = 'Zonal Regulations of the Revised Master Plan 2015 (Amendment) Regulations, 2025';
const AMENDMENT_URL = 'https://data.opencity.in/dataset/16da705e-9f8f-4248-b428-ab8863603779/resource/d7b00660-a3bc-49cf-b35a-3d70283ace0a/download/20250801-zr-of-rmp-2015-of-lpa-of-bengaluru-amendment-regulations-2025.pdf';
const SEISMIC = 'IS 1893 (Part 1):2016, Criteria for earthquake resistant design of structures';
const SEISMIC_URL = 'https://infralens.in/code/IS-1893-Part-1-2016/clause/table-2';
const CPHEEO = 'Manual on Water Supply and Treatment, Central Public Health and Environmental Engineering Organisation';
const TABLE_7 = 'Part 4, Table 7; the scan read was not legible enough to take the figures';
const TABLE_7_URL = 'https://suratmunicipal.gov.in/Content/Documents/Departments/FireAndEmergencyServices/NBC_PART4.pdf';

const setback = (min: number, max: number, value: number): RuleRow => ({
  key: 'setback_all_round_m',
  label: 'All-round setback for the height of the building',
  jurisdiction: BENGALURU,
  when: { height_m: { min, max } },
  value,
  unit: 'm',
  from: '2025-08-01',
  source: { regulation: AMENDMENT, clause: 'setbacks by height of building; read through search excerpts and a law firm’s commentary, not in the gazette', url: AMENDMENT_URL },
  verified: false,
});

const zoneFactor = (zone: string, value: number): RuleRow => ({
  key: 'seismic_zone_factor',
  label: 'Seismic zone factor',
  jurisdiction: {},
  when: { zone },
  value,
  from: '2016-12-01',
  source: { regulation: SEISMIC, clause: 'zone factor table; from a secondary summary', url: SEISMIC_URL },
  verified: false,
});

const reduction = (system: string, value: number): RuleRow => ({
  key: 'response_reduction_max',
  label: 'Response reduction factor for the structural system',
  jurisdiction: {},
  when: { system },
  value,
  from: '2016-12-01',
  source: { regulation: SEISMIC, clause: 'response reduction factors; from a secondary summary', url: SEISMIC_URL },
  verified: false,
});

export const DESIGN_RULE_ROWS: RuleRow[] = [
  setback(11.5, 15, 5),
  setback(15, 18, 6),
  setback(18, 21, 7),
  {
    key: 'high_rise_height_m',
    label: 'Height at or above which a building is high-rise',
    jurisdiction: {},
    value: 15,
    unit: 'm',
    from: '2017-01-01',
    source: { regulation: NBC, clause: 'Part 4, definition of a high-rise building; from memory of the code, not checked against the text' },
    verified: false,
  },
  {
    key: 'high_rise_height_m',
    label: 'Height at or above which the fire service’s approval is needed',
    jurisdiction: { state: 'Karnataka' },
    value: 21,
    unit: 'm',
    from: '2023-01-01',
    source: {
      regulation: 'Karnataka Fire Force (Amendment) Act, 2023',
      clause: 'as reported in the press; the city corporation’s list of approvals for a building plan still gives the lower figure, and the two are not reconciled',
      url: 'https://www.deccanherald.com/india/karnataka/bengaluru/govt-frames-fire-safety-rules-2349515',
    },
    verified: false,
  },
  {
    key: 'basement_fire_air_changes',
    label: 'Air changes an hour in a basement in fire mode',
    jurisdiction: {},
    value: 12,
    unit: 'air changes an hour',
    from: '2017-01-01',
    source: { regulation: NBC, clause: 'Part 4 and Part 8; a commonly cited figure, from memory, not checked against the text' },
    verified: false,
  },
  {
    key: 'lift_required_height_m',
    label: 'Height above which a building needs a lift',
    jurisdiction: {},
    value: 15,
    unit: 'm',
    from: '2017-01-01',
    source: { regulation: NBC, clause: 'Part 8, Section 5; a commonly cited figure, from memory, not checked against the text' },
    verified: false,
  },
  zoneFactor('II', 0.1),
  zoneFactor('III', 0.16),
  zoneFactor('IV', 0.24),
  zoneFactor('V', 0.36),
  reduction('smrf', 5),
  reduction('omrf', 3),
  {
    key: 'water_per_capita_cum',
    label: 'Water supply norm a person a day, where there is sewerage',
    jurisdiction: {},
    value: 0.135,
    unit: 'cu m',
    from: '1999-01-01',
    source: { regulation: CPHEEO, clause: 'per-capita supply norms; from a secondary summary', url: 'https://www.studiomatrx.org/guides/cpheeo-manual-india' },
    verified: false,
  },
  {
    key: 'water_per_capita_cum',
    label: 'Water supply norm a person a day, in a metropolitan city',
    jurisdiction: {},
    when: { city_class: 'metro' },
    value: 0.15,
    unit: 'cu m',
    from: '1999-01-01',
    source: { regulation: CPHEEO, clause: 'per-capita supply norms; from a secondary summary', url: 'https://www.studiomatrx.org/guides/cpheeo-manual-india' },
    verified: false,
  },
  {
    key: 'sewage_share_of_supply',
    label: 'Sewage generated as a share of the water supplied',
    jurisdiction: {},
    value: 80,
    unit: '%',
    from: '1999-01-01',
    source: { regulation: CPHEEO, clause: 'as cited in a reply in the Rajya Sabha; the manual itself was not read', url: 'https://rsdebate.nic.in/bitstream/123456789/739770/1/PQ_259_06022023_U418_p263_p264.pdf' },
    verified: false,
  },
  {
    key: 'sewage_plant_units_from',
    label: 'Units from which a project needs its own sewage treatment plant',
    jurisdiction: BENGALURU,
    value: 20,
    unit: 'units',
    from: '2016-01-01',
    to: '2016-12-31',
    source: { regulation: 'Water supply and sewerage board’s order of 2016', clause: 'as reported in the press; the order and its date were not read', url: 'https://citizenmatters.in/bwssb-kspcb-stp-sewage-treatment-rules-apartments-bengaluru-news/' },
    verified: false,
  },
  {
    key: 'sewage_plant_units_from',
    label: 'Units from which a project needs its own sewage treatment plant',
    jurisdiction: BENGALURU,
    value: 50,
    unit: 'units',
    from: '2017-01-01',
    source: { regulation: 'Water supply and sewerage board’s relaxation of 2017', clause: 'as reported in the press, which disagrees on the figure now in force; the notification was not read', url: 'https://thenewsminute.com/article/relief-bengaluru-flat-dwellers-not-all-complexes-now-need-sewage-treatment-plants-73173' },
    verified: false,
  },
];

export const DESIGN_RULE_SHAPES: RuleShape[] = [
  { key: 'far_limit', label: 'Floor area ratio permissible', jurisdiction: BENGALURU, keyedBy: ['zone', 'road_width_ft', 'plot_area_sqm'], unit: 'ratio', source: { regulation: ZONING, clause: 'FAR tables by zone, road width and plot size; the file would not open', url: ZONING_URL } },
  { key: 'ground_coverage_max_pct', label: 'Ground coverage permissible', jurisdiction: BENGALURU, keyedBy: ['zone', 'plot_area_sqm'], unit: '%', source: { regulation: ZONING, clause: 'coverage tables by zone and plot size; the file would not open', url: ZONING_URL } },
  { key: 'building_height_max_m', label: 'Building height permissible', jurisdiction: BENGALURU, keyedBy: ['zone', 'road_width_ft'], unit: 'm', source: { regulation: ZONING, clause: 'height by zone and road width; the file would not open', url: ZONING_URL } },
  { key: 'parking_spaces_norm', label: 'Car spaces for each dwelling, or each square metre, of a use', jurisdiction: BENGALURU, keyedBy: ['use', 'basis'], unit: 'spaces', source: { regulation: ZONING, clause: 'parking table; the file would not open', url: ZONING_URL } },
  { key: 'fire_underground_tank_cum', label: 'Underground static water tank for fire fighting', jurisdiction: {}, keyedBy: ['occupancy', 'height_m'], unit: 'cu m', source: { regulation: NBC, clause: TABLE_7, url: TABLE_7_URL } },
  { key: 'fire_terrace_tank_cum', label: 'Terrace tank for fire fighting', jurisdiction: {}, keyedBy: ['occupancy', 'height_m'], unit: 'cu m', source: { regulation: NBC, clause: TABLE_7, url: TABLE_7_URL } },
  { key: 'fire_pump_lpm', label: 'Fire pump flow near the underground tank', jurisdiction: {}, keyedBy: ['occupancy', 'height_m'], unit: 'lpm', source: { regulation: NBC, clause: TABLE_7, url: TABLE_7_URL } },
  { key: 'stair_width_min_m', label: 'Least clear width of an escape staircase', jurisdiction: {}, keyedBy: ['occupancy'], unit: 'm', source: { regulation: NBC, clause: 'Part 4, means of egress; not read' } },
  { key: 'travel_distance_max_m', label: 'Most travel distance to an exit', jurisdiction: {}, keyedBy: ['occupancy'], unit: 'm', source: { regulation: NBC, clause: 'Part 4, means of egress; not read' } },
  { key: 'basic_wind_speed_mps', label: 'Basic wind speed on the code’s map, by city', jurisdiction: {}, keyedBy: [], unit: 'm/s', source: { regulation: 'IS 875 (Part 3), Wind loads on buildings and structures', clause: 'basic wind speed map; not read' } },
];
