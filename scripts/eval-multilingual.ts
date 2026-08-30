/**
 * Measure whether the model obeys the language rules the prompt states.
 *
 *   pnpm eval:multilingual                      # the configured extraction tier
 *   pnpm eval:multilingual --model <id>         # one named model
 *
 * A CLI and not a test, because it spends money and needs a key: `pnpm test`
 * must stay runnable with no network, and the code path these rules travel is
 * already covered there by `test/script.test.ts`. This measures the other
 * half — the half a prompt cannot guarantee.
 */

import { MULTILINGUAL_FIXTURES } from '../evals/multilingual/fixtures';
import { scoreField, tallyByRule } from '../evals/multilingual/score';
import type { Answer, FieldOutcome } from '../evals/multilingual/score';
import { apiKey, baseUrl, modelForTier } from '@realytica/agents';
import { isIdentifierKey, recoverIdentifierFromSource } from '@realytica/shared';

const RULES = `You are reading an Indian property document. Extract ONLY the fields asked for.

LANGUAGE RULES — these are the whole point of this task:
- For a name, place or description NOT written in English, put your English
  reading in "value" AND the exact original text from the page in
  "originalValue". Both, always.
- For an IDENTIFIER — survey number, document number, khata number, khasra
  number, registration number — copy the characters exactly and do NOT
  romanise them. Indic digits SHOULD be written as Latin digits, because
  १२३ and 123 are the same number. Letters must NOT be: there is no English
  spelling of an identifier, only the identifier.
- When the page text is already in English, "originalValue" is null. Do not
  invent an original.
- If the document does not state a field, omit it rather than guessing.

Reply with ONLY a JSON object, no prose and no code fence:
{"<key>": {"value": "...", "originalValue": "..." or null}, ...}`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function ask(model: string, prompt: string): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('No API key configured — set REALYTICA_API_KEY.');
  const base = baseUrl() ?? 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
}

/** A model told not to fence its JSON will fence it anyway often enough to handle. */
function parseAnswer(text: string): Record<string, Answer> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const out: Record<string, Answer> = {};
    for (const [k, v] of Object.entries(parsed)) {
      // A bare string is a legitimate shape for a model to reach for, and
      // reading it as "no original" is right: it did not supply one.
      if (typeof v === 'string') out[k] = { value: v };
      else if (v && typeof v === 'object') {
        const o = v as { value?: unknown; originalValue?: unknown };
        out[k] = {
          value: typeof o.value === 'string' ? o.value : null,
          originalValue: typeof o.originalValue === 'string' ? o.originalValue : null,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const model = arg('model') ?? modelForTier('extraction');
  const raw = process.argv.includes('--raw');
  console.log(
    `multilingual extraction eval · model=${model} · ${MULTILINGUAL_FIXTURES.length} fixtures · ` +
      `${raw ? 'RAW model output' : 'as shipped (identifier guard on)'}\n`,
  );

  const outcomes: FieldOutcome[] = [];
  /*
   * A fixture that never ran is not a fixture that passed.
   *
   * A free-tier 429 dropped one of three from the denominator and the run
   * reported 13/13 — a better number than the same models had just produced,
   * arrived at by not asking one of the questions. Skips are counted, named,
   * and fail the run, because a score computed over an unknown subset is
   * worse than no score.
   */
  const skipped: string[] = [];
  for (const fixture of MULTILINGUAL_FIXTURES) {
    const keys = fixture.expectations.map(e => e.key);
    const prompt = `${RULES}\n\nFields requested: ${keys.join(', ')}\n\nDOCUMENT:\n${fixture.text}`;
    process.stdout.write(`${fixture.label} … `);
    let answers: Record<string, Answer> = {};
    try {
      answers = parseAnswer(await ask(model, prompt));
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 90) : 'error';
      console.log(`SKIPPED (${why})`);
      skipped.push(`${fixture.id}: ${why}`);
      continue;
    }
    /*
     * Score what SHIPS, not what the model said.
     *
     * The production path runs an extracted identifier back against the page
     * it came from (`prepareValue` → `recoverIdentifierFromSource`), so an
     * eval scoring the raw reply would keep reporting a failure the product
     * no longer has — and, worse, would stop noticing if the guard broke.
     * `--raw` measures the model alone, which is the number to quote about a
     * model rather than about this deployment.
     */
    const guarded = raw
      ? answers
      : Object.fromEntries(
          Object.entries(answers).map(([k, a]) => [
            k,
            isIdentifierKey(k) && a.value
              ? { ...a, value: recoverIdentifierFromSource(a.value, fixture.text) }
              : a,
          ]),
        );
    const mine = fixture.expectations.map(e => scoreField(fixture, e, guarded[e.key]));
    outcomes.push(...mine);
    console.log(`${mine.filter(o => o.verdict === 'correct').length}/${mine.length}`);
  }

  console.log('\nBy rule:');
  for (const t of tallyByRule(outcomes)) {
    if (t.total === 0) continue;
    const extra = [
      t.romanised > 0 ? `${t.romanised} ROMANISED` : null,
      t.lostOriginal > 0 ? `${t.lostOriginal} lost the original` : null,
      t.missed > 0 ? `${t.missed} missed` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${t.rule.padEnd(22)} ${t.correct}/${t.total}${extra ? `  — ${extra}` : ''}`);
  }

  const failures = outcomes.filter(o => o.verdict !== 'correct');
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  [${f.verdict}] ${f.fixtureId}.${f.key}`);
      console.log(`      expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.got)}`);
      if (f.note) console.log(`      ${f.note}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} of ${MULTILINGUAL_FIXTURES.length} fixtures — the score below is over the rest:`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  const correct = outcomes.filter(o => o.verdict === 'correct').length;
  console.log(`\nOverall: ${correct}/${outcomes.length}`);
  /*
   * A romanised identifier fails the run on its own, whatever the total.
   * It is the failure that survives review — it looks like an identifier, it
   * is not the identifier, and nothing downstream can tell.
   */
  const romanised = outcomes.filter(o => o.verdict === 'romanised').length;
  if (romanised > 0) {
    console.log(`FAIL — ${romanised} identifier(s) transliterated.`);
    process.exit(1);
  }
  if (skipped.length > 0) {
    console.log('FAIL — not every fixture ran, so this number does not describe the set.');
    process.exit(1);
  }
}

void main();
