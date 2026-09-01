/**
 * Score the critic (or any model judge) against human-graded transcripts.
 *
 *   pnpm eval:calibration                      # reads evals/calibration/labels.jsonl
 *   pnpm eval:calibration --file path.jsonl
 *
 * The labels are yours to write — one JSON object per line:
 *
 *   {"id":"run_123","human":"fail","judge":"pass","note":"cited a circular as the Fire NOC"}
 *
 * Grade 20–50 transcripts drawn from REAL runs, failures included; a label
 * file where every human verdict is "pass" calibrates nothing, and this tool
 * says so instead of printing a flattering agreement number. Expect to
 * re-grade over time: criteria drift is normal, not a mistake.
 */

import { readFileSync } from 'node:fs';
import { calibrate, parseCalibrationLine, summariseCalibration, type CalibrationRecord } from '../packages/agents/src/eval/calibration';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

function main(): void {
  const file = arg('file') ?? 'evals/calibration/labels.jsonl';
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`No label file at ${file}.`);
    console.error('Start from evals/calibration/labels.example.jsonl — copy it to labels.jsonl and replace the examples with your own graded transcripts.');
    process.exit(2);
  }

  const records: CalibrationRecord[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((line, index) => {
    const parsed = parseCalibrationLine(line, index + 1);
    if ('error' in parsed) {
      if (parsed.error) problems.push(parsed.error);
      return;
    }
    if (seen.has(parsed.id)) {
      problems.push(`line ${index + 1}: duplicate id "${parsed.id}" — the first occurrence wins`);
      return;
    }
    seen.add(parsed.id);
    records.push(parsed);
  });

  for (const problem of problems) console.error(`⚠ ${problem}`);
  const report = calibrate(records);
  for (const line of summariseCalibration(report)) console.log(line);

  // Exit code carries the verdict so this can gate: kappa below 0.4 means the
  // judge is not measuring what the person is, and automation built on it
  // inherits that. No labels is exit 0 — absence of measurement is reported,
  // not punished, or nobody would ever get to the first label.
  if (report.records >= 20 && report.kappa !== null && report.kappa < 0.4) process.exit(1);
}

main();
