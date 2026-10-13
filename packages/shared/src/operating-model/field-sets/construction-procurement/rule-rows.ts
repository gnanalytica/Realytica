/**
 * The figures Construction's and Procurement's fields read from a code, an
 * Act or a standard form of contract: how many cube samples a pour needs,
 * what a sample and a group of four may not fall below, what a grade of
 * steel must reach, the workforce that asks for a safety officer, and what
 * two forms of contract usually set for a guarantee and for a notice.
 *
 * Every row is unverified. The Indian Standards are paid documents and were
 * read through summaries, which disagree with each other on the margins;
 * the contract forms were read through excerpts or recalled. Each row says
 * so in its source, and the screen says "not verified" beside every value
 * worked out from one. A row is marked verified only by a named person who
 * has held it against the instrument.
 *
 * Where only the year of an edition is known, the row is in force from the
 * first day of that year.
 */

import type { RuleRow } from '../../types';

const IS_456 = 'IS 456:2000, Plain and reinforced concrete: code of practice (read through summaries, not the Bureau’s text)';
const IS_456_URL = 'https://infralens.in/handbook/cube-test-acceptance';
const IS_1786 = 'IS 1786:2008, High strength deformed steel bars and wires for concrete reinforcement (limits read through a summary, not the Bureau’s text)';
const IS_1786_URL = 'https://infralens.in/code/IS-1786-2008';
const BOCW = 'Building and Other Construction Workers (Regulation of Employment and Conditions of Service) Act, 1996';
const BOCW_URL = 'https://audit.hrylabour.gov.in/staticdocs/labourActpdfdocs/BOCW_Act.pdf';
const CPWD = 'CPWD General Conditions of Contract 2023 (clause read in an older text of the same clause)';
const CPWD_URL = 'https://iitk.ac.in/iwd/file/2025/12-AC-EE-2025/GCC2023.pdf';
const FIDIC = 'FIDIC Conditions of Contract, 2017 edition (recalled, not read)';

const GRADES: ReadonlyArray<[grade: string, strength: number]> = [
  ['M15', 15],
  ['M20', 20],
  ['M25', 25],
  ['M30', 30],
  ['M35', 35],
  ['M40', 40],
  ['M45', 45],
  ['M50', 50],
];

/** Samples by the volume poured: each band takes its lower end and stops short of its upper. */
const SAMPLE_BANDS: ReadonlyArray<[min: number, max: number, samples: number]> = [
  [0, 5.01, 1],
  [5.01, 15.01, 2],
  [15.01, 30.01, 3],
  [30.01, 50.01, 4],
  // Four, and one more for each further fifty cubic metres or part of it.
  ...Array.from({ length: 19 }, (_, i): [number, number, number] => [50.01 + i * 50, 100.01 + i * 50, 5 + i]),
];

const STEEL_YIELD: ReadonlyArray<[grade: string, yieldStress: number]> = [
  ['Fe 415', 415],
  ['Fe 415D', 415],
  ['Fe 500', 500],
  ['Fe 500D', 500],
  ['Fe 550', 550],
  ['Fe 550D', 550],
];

export const CONSTRUCTION_PROCUREMENT_RULE_ROWS: RuleRow[] = [
  /* --- Concrete: IS 456 ------------------------------------------------ */
  ...SAMPLE_BANDS.map(
    ([min, max, value]): RuleRow => ({
      key: 'cube_samples_required',
      label: 'Cube samples required for the volume poured',
      jurisdiction: {},
      when: { volume_cum: { min, max } },
      value,
      unit: 'samples',
      from: '2000-01-01',
      source: { regulation: IS_456, clause: 'clause 15.2.2', url: IS_456_URL },
      verified: false,
    }),
  ),
  ...GRADES.map(
    ([grade, value]): RuleRow => ({
      key: 'concrete_fck',
      label: 'Characteristic compressive strength of the grade',
      jurisdiction: {},
      when: { grade },
      value,
      unit: 'N/sqmm',
      from: '2000-01-01',
      source: { regulation: IS_456, clause: 'Table 2', url: 'https://infralens.in/code/IS-456' },
      verified: false,
    }),
  ),
  ...GRADES.map(
    ([grade, strength]): RuleRow => ({
      key: 'cube_individual_margin',
      label: 'How far below the characteristic strength one sample may be',
      jurisdiction: {},
      when: { grade },
      // The summaries give 3 for M15 and 4 for M20 and above, and do not agree with each other.
      value: strength < 20 ? 3 : 4,
      unit: 'N/sqmm',
      from: '2000-01-01',
      source: { regulation: IS_456, clause: 'clause 16.1 and Table 11', url: IS_456_URL },
      verified: false,
    }),
  ),
  ...GRADES.map(
    ([grade, strength]): RuleRow => ({
      key: 'cube_group_margin',
      label: 'How far above the characteristic strength the mean of four samples must be',
      jurisdiction: {},
      when: { grade },
      value: strength < 20 ? 3 : 4,
      unit: 'N/sqmm',
      from: '2000-01-01',
      source: { regulation: IS_456, clause: 'clause 16.1 and Table 11', url: IS_456_URL },
      verified: false,
    }),
  ),
  {
    key: 'cube_group_deviation_factor',
    label: 'Multiple of the established standard deviation added for the mean of four samples',
    jurisdiction: {},
    value: 0.825,
    unit: 'ratio',
    from: '2000-01-01',
    source: { regulation: IS_456, clause: 'clause 16.1 and Table 11', url: IS_456_URL },
    verified: false,
  },
  {
    key: 'cube_variation_limit_pct',
    label: 'How far one cube may be from the mean of its sample',
    jurisdiction: {},
    value: 15,
    unit: '%',
    from: '2000-01-01',
    source: { regulation: IS_456, clause: 'clause 15.4', url: IS_456_URL },
    verified: false,
  },
  {
    key: 'cube_test_age_days',
    label: 'Age at which a sample is held to the acceptance limit',
    jurisdiction: {},
    value: 28,
    unit: 'days',
    from: '2000-01-01',
    source: { regulation: IS_456, clause: 'clause 15.1', url: IS_456_URL },
    verified: false,
  },

  /* --- Reinforcement: IS 1786 ----------------------------------------- */
  ...STEEL_YIELD.map(
    ([grade, value]): RuleRow => ({
      key: 'rebar_yield_least',
      label: 'Least yield stress of the grade',
      jurisdiction: {},
      when: { grade },
      value,
      unit: 'N/sqmm',
      from: '2008-01-01',
      source: { regulation: IS_1786, clause: 'Table 3', url: IS_1786_URL },
      verified: false,
    }),
  ),
  // The catalog found limits for one grade only. A lot of another grade is held to its yield, and to nothing it could not find.
  {
    key: 'rebar_elongation_least',
    label: 'Least elongation of the grade',
    jurisdiction: {},
    when: { grade: 'Fe 500D' },
    value: 16,
    unit: '%',
    from: '2008-01-01',
    source: { regulation: IS_1786, clause: 'Table 3', url: IS_1786_URL },
    verified: false,
  },
  {
    key: 'rebar_ratio_least',
    label: 'Least ratio of tensile strength to yield stress of the grade',
    jurisdiction: {},
    when: { grade: 'Fe 500D' },
    value: 1.1,
    unit: 'ratio',
    from: '2008-01-01',
    source: { regulation: IS_1786, clause: 'Table 3', url: IS_1786_URL },
    verified: false,
  },

  /* --- Safety ------------------------------------------------------------ */
  {
    key: 'safety_officer_workers',
    label: 'Workers on site at which a safety officer and a safety committee are required',
    jurisdiction: {},
    value: 500,
    unit: 'workers',
    from: '1996-03-01',
    to: '2025-11-20',
    source: { regulation: BOCW, clause: 'section 38', url: BOCW_URL },
    verified: false,
  },
  {
    key: 'safety_officer_workers',
    label: 'Workers on site at which a safety officer and a safety committee are required',
    jurisdiction: {},
    value: 500,
    unit: 'workers',
    from: '2025-11-21',
    // The 1996 Act was repealed into the labour codes on this day. The figure is the old Act's, carried over: it was not read in the Code or in a state's rules under it.
    source: { regulation: 'Occupational Safety, Health and Working Conditions Code, 2020 (figure carried over from the 1996 Act; not read in the Code)' },
    verified: false,
  },

  /* --- Forms of contract ------------------------------------------------ */
  {
    key: 'performance_security_pct',
    label: 'Performance guarantee, of the tendered value',
    jurisdiction: {},
    when: { conditions: 'cpwd_gcc' },
    value: 5,
    unit: '%',
    from: '2023-01-01',
    source: { regulation: CPWD, clause: 'clause 1', url: CPWD_URL },
    verified: false,
  },
  {
    key: 'performance_security_margin_days',
    label: 'Days a performance guarantee is kept valid past completion',
    jurisdiction: {},
    value: 60,
    unit: 'days',
    from: '2023-01-01',
    source: { regulation: 'CPWD practice under the General Conditions of Contract 2023 (as reported; the clause was not read)', url: CPWD_URL },
    verified: false,
  },
  ...['fidic_red', 'fidic_yellow'].map(
    (conditions): RuleRow => ({
      key: 'claim_notice_days',
      label: 'Days from becoming aware of an event in which a claim is to be notified',
      jurisdiction: {},
      when: { conditions },
      value: 28,
      unit: 'days',
      from: '2017-01-01',
      source: { regulation: FIDIC, clause: 'sub-clause 20.2.1' },
      verified: false,
    }),
  ),
];
