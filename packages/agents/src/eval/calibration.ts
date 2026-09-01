/**
 * Calibrating the critic against human judgment.
 *
 * The critic is a model grading other models, and this product currently has
 * no measurement of whether a person would agree with it. That gap has a
 * name in the literature: LLM judges carry self-preference bias — a judge
 * favours outputs stylistically close to its own — and here the critic and
 * the agents it grades are the same model family, so the bias is structural
 * rather than hypothetical. The remedy is not a better prompt; it is a
 * measurement: a set of transcripts a person has graded, and a number for
 * how often the critic agrees with them.
 *
 * Two design decisions, both from the "who validates the validators" work
 * (EvalGen, UIST 2024):
 *
 * **Agreement alone is not the number.** With imbalanced labels — and
 * diligence verdicts are imbalanced; most findings are sound — raw agreement
 * flatters a judge that just says "pass" to everything. Cohen's kappa
 * corrects for chance agreement, and the confusion matrix says WHICH
 * direction the critic errs in: a critic that misses real problems (false
 * passes) is a different, worse instrument than one that nags (false fails).
 *
 * **Criteria drift is expected.** People cannot fully specify their grading
 * criteria before grading; the criteria firm up as they read outputs. So
 * calibration is not a one-time setup step — the label file is meant to be
 * re-graded and re-run as the corpus and the product's standards move, which
 * is why this module reads a plain JSONL file a person can edit rather than
 * anything stored in the app.
 *
 * The labels themselves come from a person. Nothing in this module can
 * manufacture them, and an empty label file produces a report that says
 * "nothing measured" rather than a flattering default.
 */

export type CalibrationVerdict = 'pass' | 'fail';

export interface CalibrationRecord {
  /** Identifies the transcript both verdicts are about — a run id, a case id, anything stable. */
  id: string;
  /** What the person concluded, reading the same transcript. */
  human: CalibrationVerdict;
  /** What the critic (or any model judge) concluded. */
  judge: CalibrationVerdict;
  /** Optional note — most useful on disagreements, where it is the start of the next rubric. */
  note?: string;
}

export interface CalibrationReport {
  records: number;
  agreement: number;
  /** Cohen's kappa: agreement corrected for chance. NaN-free — null when undefined (single-class labels). */
  kappa: number | null;
  /** Judge said pass, human said fail — the dangerous direction in a diligence product. */
  falsePasses: number;
  /** Judge said fail, human said pass — the nagging direction. */
  falseFails: number;
  confusion: { passPass: number; passFail: number; failPass: number; failFail: number };
  /** Disagreeing ids, so the transcripts worth re-reading are named rather than counted. */
  disagreements: { id: string; human: CalibrationVerdict; judge: CalibrationVerdict; note?: string }[];
  /** Honest caveats: small samples and single-class label sets mislead. */
  warnings: string[];
}

/** Read one JSONL line into a record, or say exactly why it is not one. */
export function parseCalibrationLine(line: string, lineNo: number): CalibrationRecord | { error: string } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return { error: '' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { error: `line ${lineNo}: not JSON` };
  }
  if (typeof raw !== 'object' || raw === null) return { error: `line ${lineNo}: not an object` };
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const human = row.human === 'pass' || row.human === 'fail' ? row.human : null;
  const judge = row.judge === 'pass' || row.judge === 'fail' ? row.judge : null;
  if (!id) return { error: `line ${lineNo}: missing id` };
  if (!human) return { error: `line ${lineNo}: human must be "pass" or "fail"` };
  if (!judge) return { error: `line ${lineNo}: judge must be "pass" or "fail"` };
  return { id, human, judge, note: typeof row.note === 'string' ? row.note : undefined };
}

export function calibrate(records: CalibrationRecord[]): CalibrationReport {
  const confusion = { passPass: 0, passFail: 0, failPass: 0, failFail: 0 };
  const disagreements: CalibrationReport['disagreements'] = [];

  for (const record of records) {
    if (record.human === 'pass' && record.judge === 'pass') confusion.passPass += 1;
    else if (record.human === 'fail' && record.judge === 'fail') confusion.failFail += 1;
    else if (record.human === 'fail' && record.judge === 'pass') confusion.passFail += 1;
    else confusion.failPass += 1;
    if (record.human !== record.judge) {
      disagreements.push({ id: record.id, human: record.human, judge: record.judge, note: record.note });
    }
  }

  const n = records.length;
  const agree = confusion.passPass + confusion.failFail;
  const agreement = n === 0 ? 0 : agree / n;

  // Cohen's kappa. Expected agreement from the marginals; undefined when
  // either grader used only one label — reported as null rather than 1 or 0,
  // because a label set with no failing examples cannot calibrate anything.
  let kappa: number | null = null;
  if (n > 0) {
    const humanPass = (confusion.passPass + confusion.failPass) / n;
    const judgePass = (confusion.passPass + confusion.passFail) / n;
    const expected = humanPass * judgePass + (1 - humanPass) * (1 - judgePass);
    kappa = expected >= 1 ? null : (agreement - expected) / (1 - expected);
    if (kappa !== null) kappa = Math.round(kappa * 1000) / 1000;
  }

  const warnings: string[] = [];
  if (n === 0) warnings.push('No labels. Grade 20–50 real transcripts (drawn from real failures, not synthetic ones) and re-run.');
  else if (n < 20) warnings.push(`Only ${n} label(s) — agreement numbers on fewer than ~20 are noise. Keep grading.`);
  const humanFails = confusion.passFail + confusion.failFail;
  if (n > 0 && humanFails === 0) {
    warnings.push('Every human verdict is "pass". A judge is calibrated by the cases a person failed; add should-fail transcripts or the numbers here measure nothing.');
  }
  if (confusion.passFail > 0) {
    warnings.push(
      `${confusion.passFail} false pass(es): the judge cleared what a person failed. In this product that is the expensive direction — a fabricated figure the critic waves through ships.`,
    );
  }

  return { records: n, agreement: Math.round(agreement * 1000) / 1000, kappa, falsePasses: confusion.passFail, falseFails: confusion.failPass, confusion, disagreements, warnings };
}

/** The report as lines a person reads at a terminal. */
export function summariseCalibration(report: CalibrationReport): string[] {
  const lines: string[] = [];
  lines.push(`Labels: ${report.records}`);
  if (report.records > 0) {
    lines.push(`Agreement: ${(report.agreement * 100).toFixed(1)}%`);
    lines.push(
      report.kappa === null
        ? 'Cohen’s kappa: undefined — one of the graders used a single label for everything.'
        : `Cohen’s kappa: ${report.kappa.toFixed(3)} (${describeKappa(report.kappa)})`,
    );
    lines.push(
      `Confusion (human × judge): pass/pass ${report.confusion.passPass} · fail/fail ${report.confusion.failFail} · human-fail/judge-pass ${report.confusion.passFail} · human-pass/judge-fail ${report.confusion.failPass}`,
    );
    for (const row of report.disagreements) {
      lines.push(`  disagreement ${row.id}: human ${row.human}, judge ${row.judge}${row.note ? ` — ${row.note}` : ''}`);
    }
  }
  for (const warning of report.warnings) lines.push(`⚠ ${warning}`);
  return lines;
}

function describeKappa(kappa: number): string {
  if (kappa >= 0.8) return 'strong — the judge can be trusted to triage, with spot checks';
  if (kappa >= 0.6) return 'moderate — usable for ranking, not for gating on its own';
  if (kappa >= 0.4) return 'weak — read transcripts before believing any judge verdict';
  return 'no better than guessing — the judge is not measuring what the person is';
}
