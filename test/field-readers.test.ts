/**
 * A field's value is read through the standing functions, or not at all.
 *
 * A check's fields and a field set's sheets both hold values that wait: a
 * model's value nobody has accepted, two values in dispute. A reader that
 * takes `check.fields` or a stored sheet's `values` for itself reads those as
 * if they stood, and a proposed figure reaches a report, a rule or the graph
 * wearing an accepted one's authority. The one question is `fieldStands`
 * (`check-fields.ts`), asked through `standingField`, `standingValues`,
 * `withComputed`, `resolveFields`, `readSheet` and `standingFieldLines`.
 *
 * This test reads the source, as `standing-readers.test.ts` does for a
 * paper's values. Every place that reads a check's stored fields or a field
 * set's stored values past those functions is listed here with why it may. A
 * new one fails until somebody decides what it is: something that acts, to
 * go through a standing function, or something that writes, copies or
 * decides, to be added below with its reason.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOTS = ['packages/shared/src', 'packages/agents/src', 'apps/api/src', 'apps/web/src'];

/**
 * Every read of stored field values that is not handed straight to a
 * standing function, with why it may. `file` is a file. `has` is words the
 * line holds; without it every such line of the file is meant.
 */
const ALLOWED: ReadonlyArray<{ file: string; has?: string; why: string }> = [
  // The choke points: where stored values are sorted into what stands and what waits.
  { file: 'packages/shared/src/operating-model/field-sheets.ts', why: 'the field system itself: every stored value is read here once, and handed on as what stands (`resolveFields`) or as a view that says where it stands (`readSheet`)' },
  { file: 'packages/shared/src/operating-model/check-fields.ts', has: 'const held = check.fields ?? {};', why: 'a check’s own reading: `held` is everything stored, for the screen, and `values` beside it is only what stands' },
  { file: 'packages/shared/src/operating-model/check-waiting.ts', has: 'const own = check.fields ?? {};', why: 'lays the values waiting on a check’s cards over what it stores, each marked proposed: a reading for the field system, which asks `fieldStands` of every one' },

  { file: 'packages/shared/src/operating-model/field-periods.ts', why: 'the periods of a set: a record’s period and what tells it from another are read through `standingField`; what waits on it is counted, never read, before an issue is allowed; an issued record is copied whole into its revision; every figure compared comes through `resolveFields`' },

  { file: 'packages/shared/src/operating-model/sheet-periods.ts', why: 'a sheet’s periods: an issue copies what the sheet stores and freezes a reading made by `readSheet`; what waits is counted, never read; the sheet is then cleared through `stand`; every figure compared or drawn comes through `resolveFields` or from what was frozen' },
  { file: 'packages/shared/src/operating-model/as-at.ts', why: 'turns the stored sheets and checks back to a past day, each value through `fieldAsAt`, which hands on only what stood: the reading it makes is then read by the field system like any project' },

  { file: 'packages/shared/src/operating-model/report-observations.ts', why: 'offering a report’s observations: it asks only whether the same words were offered before, waiting, standing or set aside, so that a paper read again offers nothing twice. It acts on no value and says none' },

  // Working out from a check's values goes through `withComputed`, which drops what does not stand before any formula runs.
  { file: 'packages/shared/src/operating-model/operations.ts', has: 'withComputed(fields, check.fields ?? {})', why: 'the tolerance readings: `withComputed` reads only what stands' },
  { file: 'packages/shared/src/operating-model/valuation-run.ts', has: 'withComputed(def?.fields ?? [], check.fields ?? {})', why: 'the valuation’s inputs: `withComputed` reads only what stands' },

  // Writing is not reading.
  { file: 'packages/shared/src/operating-model/operations.ts', has: 'const held = { ...(check.fields ?? {}) };', why: 'records a person’s values onto the check, keeping the keys it did not touch: each is put there by `stand`, which keeps what the field held before' },
  { file: 'packages/shared/src/operating-model/operations.ts', has: 'check.fields = held;', why: 'the same write, put back on the check' },
  { file: 'packages/shared/src/operating-model/review.ts', has: 'const written = outcome.check.fields?.[k];', why: 'the value just accepted off a card, read back to keep the public source it was read from' },
  { file: 'packages/shared/src/operating-model/review.ts', has: "outcome.check.fields![k] = { ...written, state: 'accepted', origin", why: 'writes that source beside the value just accepted' },

  // Naming who and what, not acting on a value.
  { file: 'packages/shared/src/operating-model/mem-answer.ts', has: 'Object.values(check.fields ?? {}).map((held) => held.by)', why: 'the names of people who recorded anything, so an answer can tell a person’s name from a figure: no value is read' },
  { file: 'packages/shared/src/operating-model/tell.ts', has: 'holds ${String(check.fields![fact.key]!.value)}', why: 'says what a check holds beside a paper that differs: the check was chosen two lines above by `standingField`, so the value stands' },

  // Another thing called fields: the columns a checklist line asks for, not a check's stored values.
  { file: 'packages/shared/src/operating-model/document-intake.ts', has: 'for (const field of check.fields ?? []) if (keys.has(field.key))', why: 'a requirement’s list of field definitions, which holds no value' },

  { file: 'packages/shared/src/operating-model/sweep-rules.ts', has: 'Object.keys(project.fieldSheets ?? {}).length', why: 'whether the project keeps any sheet at all, before the daily review reads any: a count, never a value' },
  { file: 'packages/shared/src/operating-model/sweep-rules.ts', has: 'project.fieldSheets?.[set.id] ? [undefined] : []', why: 'whether this sheet has been started, so the review reads only sheets that hold something; what it then reads comes through `readSheet` and `resolveFields`' },

  // The appraisal's months, added up for three figures: each value is asked `fieldStands` before it is counted.
  { file: 'packages/shared/src/operating-model/field-figures.ts', has: 'project.fieldSheets?.[CASH_FLOW_SET]?.records', why: 'the cash-flow months behind the peak-funding figures: a record taken off its list is left out, and each value is counted only where `fieldStands` says it stands' },
  { file: 'packages/shared/src/operating-model/field-figures.ts', has: 'record.values[CASH_FLOW_MONTH]', why: 'the month of one of those records, asked `fieldStands` on the next line' },
  { file: 'packages/shared/src/operating-model/field-figures.ts', has: 'amount(record.values[CASH_FLOW_IN])', why: 'the money in and out of one month, through `amount`, which reads nothing that does not stand' },

  // The door for modules outside the field system (the schedule, the tender tracker, the figures): records still on their list, each cut to what stands before it is handed on.
  { file: 'packages/shared/src/operating-model/standing-records.ts', has: 'project.fieldSheets?.[setId]?.records', why: 'the one place those modules read a set’s records: every record is passed through `standingValues` on this line, and one taken off its list is left out' },

  // Asking whether anything is kept at all, not what it says.
  { file: 'packages/shared/src/operating-model/report-fields.ts', has: 'Object.keys(sheet.values).length > 0', why: 'whether a project keeps any sheet value at all, so a status report knows to carry a field section: no value is read, and the section itself is resolved through `readSheet`' },
  { file: 'packages/shared/src/operating-model/report-fields.ts', has: 'Object.keys(check.fields ?? {}).length > 0', why: 'the same question of a project’s checks: a count of keys, never a value' },

  // Asking whether anything points at a thing before it is taken away or renamed: a guard on a write, which acts on no value.
  { file: 'packages/shared/src/operating-model/cost-report.ts', has: 'JSON.stringify(project.fieldSheets ?? {})', why: 'whether any field, standing or waiting, links to a work package, before the package is taken off with the Cost Report row that made it: a link that only waits still must not be left pointing at nothing' },

  // Copying a project for somebody whose grant does not reach all of it. Nothing is acted on: what is copied is read again by the field system.
  { file: 'packages/shared/src/operating-model/project-view.ts', why: 'cuts the stored sheets to what a grant reaches and strips the citations of papers it does not, standing or not' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
  });
}

/**
 * A read of a check's stored fields (`check.fields`, `seated.check.fields`,
 * `currentCheck(…)?.fields`), of a project's stored sheets (`fieldSheets`), or
 * of one sheet's or record's stored values (`sheet.values`, `record.values`).
 * Not the schema of a check (`checkSchema(check).fields`), nor the list of
 * fields with values waiting (`waitingOnCheck(…).fields`): those are
 * definitions and a reading, and hold no stored value.
 */
const READS = /\b(?!checkSchema\b|waitingOnCheck\b|checkFieldReading\b)\w*[cC]heck\w*(?:\([^()]*\))?[?!]?\.fields\b|(?<![\w'"`])fieldSheets\b(?!\??:)|\b(?:sheet|record|stored)[?!]?\.values\b/;

/** Handed straight to a standing function: that is the door, and the read is its argument. */
const THROUGH = /\b(?:standingField|standingValues|fieldStands)\(\s*[\w.?!()[\]'" ,]*\.fields\b/;

/**
 * A copy of the project with values the file offers written in as if they
 * were recorded (`withValueOffers`). A figure worked out from one is a
 * figure from values nobody accepted: the Valuation page once said "Valued
 * on 2,833 sqm" of an extent a paper offered and no person had accepted. The
 * function may be defined and tested; nothing in the product may call it.
 */
const OFFERED_AS_RECORDED = /\bwithValueOffers\(/;

describe('who works a figure out from values that wait', () => {
  it('nobody: no figure is worked out from a copy of the project with offered values written in', () => {
    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((text, i) => {
            const code = text.trim();
            if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*') || code.startsWith('export function withValueOffers(')) return;
            if (OFFERED_AS_RECORDED.test(code)) found.push(`${file.split(path.sep).join('/')}:${i + 1}  ${code.slice(0, 140)}`);
          });
      }
    }
    assert.deepEqual(found, [], 'Each of these works something out from values the file offers and nobody has accepted. Work it out from the project as it is recorded, and list what waits beside it.');
    assert.ok(OFFERED_AS_RECORDED.test('const working = runValuationApproaches(withValueOffers(project, waiting));'), 'and it finds what it is meant to find');
  });
});

describe('who reads a field’s stored value', () => {
  const found: Array<{ file: string; line: number; text: string }> = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          const code = text.trim();
          // Words about the code are not the code.
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (READS.test(code) && !THROUGH.test(code)) found.push({ file: file.split(path.sep).join('/'), line: i + 1, text: code });
        });
    }
  }
  const allows = (entry: (typeof ALLOWED)[number], read: (typeof found)[number]) => read.file === entry.file && (!entry.has || read.text.includes(entry.has));

  it('goes through a standing function, or is on the list with its reason', () => {
    const unlisted = found.filter((read) => !ALLOWED.some((entry) => allows(entry, read)));
    assert.deepEqual(
      unlisted.map((read) => `${read.file}:${read.line}  ${read.text.slice(0, 140)}`),
      [],
      'Each of these reads a check’s stored fields or a field set’s stored values for itself. If it acts on them (a rule, a figure, a report, the graph, a sentence in chat), ' +
        'read them through `standingField`, `standingValues`, `withComputed`, `resolveFields`, `readSheet` or `standingFieldLines`. If it writes, copies or only names who recorded them, add it to ALLOWED in this file with why.',
    );
  });

  it('keeps no reason on the list that nothing answers to any more', () => {
    const stale = ALLOWED.filter((entry) => !found.some((read) => allows(entry, read)));
    assert.deepEqual(stale.map((entry) => `${entry.file}${entry.has ? `  ${entry.has}` : ''}`), [], 'an allowance nothing uses is a door left open for the next reader');
  });

  it('finds what it is meant to find, and leaves alone what goes through the door', () => {
    for (const reads of [
      'const extent = check.fields?.extent_title?.value;',
      'for (const [key, held] of Object.entries(seated.check.fields ?? {})) use(held);',
      'const rate = currentCheck(project, id)?.fields?.rate_per_sqm;',
      'const tenure = project.fieldSheets?.[setId]?.values.tenure;',
      'const share = record.values.share_pct?.value;',
      'return sheet.values[key];',
    ]) {
      assert.ok(READS.test(reads) && !THROUGH.test(reads), reads);
    }
    for (const not of [
      'const held = standingField(check.fields?.[key]);',
      'for (const [key, held] of Object.entries(standingValues(check.fields))) {',
      'const defs = set.fields.filter((def) => !def.retired);',
      'fieldSheets?: Record<string, StoredFieldSheet>;',
      'const views = reading.fields.map((view) => view.def);',
      'const { fields, rules } = checkSchema(check);',
      'const def = checkSchema(check).fields.find((f) => f.key === key);',
      'const waiting = waitingOnCheck(project, check.id).fields;',
    ]) {
      assert.equal(READS.test(not) && !THROUGH.test(not), false, not);
    }
    assert.ok(found.length >= ALLOWED.length, 'and the source was read');
  });
});
