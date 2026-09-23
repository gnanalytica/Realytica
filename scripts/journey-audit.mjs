#!/usr/bin/env node
/**
 * A new customer's first hour, played against a running API, with every
 * answer checked for the things a person should never see.
 *
 * It creates a fresh project, talks to the copilot the way somebody who has
 * never used it would, drops the sample documents into the chat one by one,
 * approves what it proposes, and asks about the file. Each turn is checked for:
 *
 *   - leaked internals: an error message, a status code, an endpoint URL,
 *     "undefined", "[object Object]";
 *   - an unanswered turn: the copilot fell through to a model it could not
 *     reach and said so, instead of answering from the registers;
 *   - a wall of text where a line was asked for;
 *   - an expectation per step: the right tool, the right document kind, the
 *     right evidence row, a field value read off the page.
 *
 * Run (server on :5174):   node scripts/journey-audit.mjs
 * Exits non-zero when anything failed, so it can gate a change.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.REALYTICA_API ?? 'http://localhost:5174/api';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../apps/api/sample-documents');
const VERBOSE = process.argv.includes('--verbose');

const LEAK = /hit an error|Error \d{3}|\b(?:4|5)\d\d\b [A-Z]|https?:\/\/(?:localhost|openrouter|api\.)|model endpoint|stack trace|\bundefined\b|\[object Object\]|\bNaN\b|TypeError|ReferenceError/i;
const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function json(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

/** The chat streams NDJSON; the last `result` line is the turn. */
function lastResult(text) {
  let result = null;
  const steps = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'result') result = o;
      else if (o.type === 'step') steps.push(o.step?.label);
      else if (o.type === 'error') result = { error: o.error ?? o.message ?? 'error line' };
    } catch {
      /* partial line */
    }
  }
  return { result, steps };
}

async function chat(projectId, question) {
  const res = await fetch(`${API}/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const text = await res.text();
  return { status: res.status, ...lastResult(text) };
}

async function chatFiles(projectId, files, question) {
  const form = new FormData();
  for (const name of files) {
    const bytes = readFileSync(path.join(DOCS, name));
    const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    form.append('files', new Blob([bytes], { type }), name);
  }
  if (question) form.append('question', question);
  const res = await fetch(`${API}/projects/${projectId}/chat/files`, { method: 'POST', body: form });
  const text = await res.text();
  return { status: res.status, ...lastResult(text) };
}

function turnText(turn) {
  return String(turn.result?.assistantTurn?.text ?? turn.result?.error ?? '');
}

function tools(turn) {
  return (turn.result?.assistantTurn?.toolCalls ?? []).map((t) => t.name);
}

/** The universal checks, applied to every turn before its own expectation. */
function vet(step, turn, { maxChars = 700 } = {}) {
  const text = turnText(turn);
  const problems = [];
  if (turn.status >= 400) problems.push(`HTTP ${turn.status}`);
  if (!turn.result) problems.push('no result');
  if (turn.result?.error) problems.push(`error: ${turn.result.error}`);
  if (LEAK.test(text)) problems.push(`leak: "${text.match(LEAK)?.[0]}"`);
  if (turn.result?.assistantTurn?.unanswered) problems.push('unanswered (fell through to an unreachable model)');
  if (text.length > maxChars) problems.push(`too long (${text.length} chars)`);
  if (!text.trim()) problems.push('empty answer');
  if (VERBOSE) console.log(`    [${tools(turn).join(',')}] ${text.replace(/\s+/g, ' ').slice(0, 220)}`);
  return problems;
}

function check(step, turn, expect, opts) {
  const problems = vet(step, turn, opts);
  const why = expect ? expect(turn) : null;
  if (why) problems.push(why);
  record(step, problems.length === 0, problems.join('; ') || `[${tools(turn).join(', ')}] ${turnText(turn).replace(/\s+/g, ' ').slice(0, 110)}`);
  return turn;
}

async function project(id) {
  return (await json('GET', `/projects/${id}`)).body;
}

async function main() {
  const health = await json('GET', '/health');
  if (health.status !== 200) {
    console.error(`No API at ${API} (${health.status}). Start it with \`pnpm dev\`.`);
    process.exit(2);
  }

  // ── 1. A file is opened ─────────────────────────────────────────────────
  const created = await json('POST', '/projects', {
    name: `Audit ${new Date().toISOString().slice(11, 19)} — Whitefield Tech Park Block C`,
    type: 'residential',
    city: 'Bengaluru',
    location: 'Whitefield Main Road, Sy. No. 118/2',
    jurisdiction: 'Karnataka',
    landAreaSqm: 12000,
    builtUpAreaSqm: 48000,
    budget: 950000000,
  });
  record('create project', created.status === 201 || created.status === 200, `HTTP ${created.status}`);
  const id = created.body.id ?? created.body.project?.id;
  if (!id) {
    console.error(created.body);
    process.exit(1);
  }

  // ── 2. Someone who has never used it ────────────────────────────────────
  check('chat: "hi"', await chat(id, 'hi'));
  check('chat: "what can you do?"', await chat(id, 'what can you do?'));
  check('chat: "what\'s next?"', await chat(id, "what's next?"));
  check('chat: "guide me"', await chat(id, 'guide me'));

  // ── 3. Documents, dropped into the chat one at a time ───────────────────
  const docs = [
    ['Sale_Deed_2019_Sy_118-2_Whitefield.pdf', /sale deed/i],
    ['Mother_Deed_1998_Sy_118-2.pdf', /mother deed|title chain/i],
    ['Encumbrance_Certificate_Form15_1995-2025.pdf', /encumbrance/i],
    ['Khata_Certificate_and_Extract_BBMP.pdf', /khata/i],
    ['Property_Tax_Receipt_BBMP_2025-26.pdf', /tax/i],
    ['Zoning_Certificate_BDA_RMP2015.pdf', /zoning|master plan|land use/i],
    ['DC_Conversion_Order_2017.pdf', /conversion/i],
    ['Building_Plan_Sanction_BBMP_2021.pdf', /sanction|plan/i],
    ['Survey_Sketch_11E_Sy_118-2.pdf', /survey/i],
  ];
  for (const [name, row] of docs) {
    const turn = await chatFiles(id, [name], 'File this');
    const proposals = turn.result?.proposals ?? [];
    const filing = proposals.find((p) => p.kind === 'file_evidence');
    check(`upload ${name}`, turn, () => {
      if (!filing) return 'no file_evidence card';
      const target = [filing.title, filing.payload?.matchedEvidenceTitle, filing.payload?.kind, filing.payload?.kindHint]
        .filter(Boolean)
        .join(' | ');
      const readable = /could not read|unread/i.test(turnText(turn));
      if (readable) return `reported unreadable (${target})`;
      if (!row.test(target)) return `filed as "${target}"`;
      return null;
    }, { maxChars: 900 });
    if (VERBOSE) {
      for (const p of proposals) console.log(`      card ${p.kind}: ${p.title} ${JSON.stringify(p.payload).slice(0, 160)}`);
    }
    check(`approve after ${name}`, await chat(id, 'approve all'));
  }

  // ── 4. Scans: no text layer, only OCR can read these ────────────────────
  for (const [name, row] of [
    ['SCANNED_Sale_Deed_Schedule_Page.jpg', /sale deed|title/i],
    ['SCANNED_Encumbrance_Certificate.pdf', /encumbrance/i],
  ]) {
    const turn = await chatFiles(id, [name], 'File this');
    const filing = (turn.result?.proposals ?? []).find((p) => p.kind === 'file_evidence');
    check(`OCR ${name}`, turn, () => {
      if (!filing) return 'no file_evidence card';
      if (/could not read|unread/i.test(turnText(turn))) return 'reported unreadable';
      const target = [filing.title, filing.payload?.kind, filing.payload?.kindHint].filter(Boolean).join(' | ');
      if (!row.test(target)) return `classified as "${target}"`;
      return null;
    }, { maxChars: 900 });
    check(`approve after ${name}`, await chat(id, 'approve all'));
  }

  // Anything still waiting — values offered once the DD started — is cleared
  // the way a person would: approve everything that is open.
  check('approve every open card', await chat(id, 'approve every open card'));

  // ── 5. What the documents should have put on the file ──────────────────
  const file = await project(id);
  const filed = file.evidence.filter((e) => (e.attachments ?? []).length);
  record('documents on the register', filed.length >= 9, `${filed.length} evidence rows carry a file`);
  record('parcel recorded from a document', file.parcelId === '118/2', `parcelId = ${file.parcelId ?? '(blank)'}`);
  const fieldValues = {};
  for (const a of file.assessments) for (const s of a.scopes) for (const c of s.checks) Object.assign(fieldValues, c.fields ?? {});
  const got = (k) => fieldValues[k]?.value;
  record('title extent read off the deed', Number(got('extent_title')) === 12000, `extent_title = ${got('extent_title') ?? '(blank)'}`);
  record('khata extent read off the khata', Number(got('extent_khata')) === 11850, `extent_khata = ${got('extent_khata') ?? '(blank)'}`);
  record('EC period read off the EC', Boolean(got('ec_from') && got('ec_to')), `ec_from = ${got('ec_from') ?? '-'}, ec_to = ${got('ec_to') ?? '-'}`);
  record('zoning read off the certificate', /residential/i.test(String(got('zoning') ?? '')), `zoning = ${got('zoning') ?? '(blank)'}`);
  record('permissible FAR read', Number(got('permissible_far')) === 2.25, `permissible_far = ${got('permissible_far') ?? '(blank)'}`);
  record('conversion read off the order', Boolean(got('conversion_status')), `conversion_status = ${got('conversion_status') ?? '(blank)'}`);
  record('sanctioned area read', Number(got('sanctioned_area')) === 27000, `sanctioned_area = ${got('sanctioned_area') ?? '(blank)'}`);
  const quoted = file.evidence.filter((e) => (e.quotes ?? []).length || (e.extractionNotes ?? '').length);
  record('evidence carries quotes from the page', quoted.length >= 5, `${quoted.length} rows with quotes/notes`);

  // ── 6. Asking about the file ────────────────────────────────────────────
  const asks = [
    ['which findings are critical?', (t) => (/finding/i.test(turnText(t)) ? null : 'no findings named')],
    ['what is the encumbrance status?', (t) => (/mortgage|encumbrance/i.test(turnText(t)) ? null : 'did not answer from the EC')],
    ['who owns the property?', (t) => (/Whitefield Tech Parks|owner/i.test(turnText(t)) ? null : 'no owner')],
    ['what is the extent?', (t) => (/12,?000|11,?850|sqm|square/i.test(turnText(t)) ? null : 'no extent')],
    ['is the land converted?', (t) => (/convert/i.test(turnText(t)) ? null : 'no conversion answer')],
    ['what documents are missing?', null],
    ['summarise this file', null],
    ['show me the evidence register', (t) => ((t.result?.navigations ?? []).some((n) => n.target === 'evidence') ? null : 'did not open evidence')],
    ['open the evidence register', (t) => ((t.result?.navigations ?? []).some((n) => n.target === 'evidence') ? null : 'did not open evidence')],
    ['open the findings', (t) => ((t.result?.navigations ?? []).some((n) => n.target === 'findings') ? null : 'did not open findings')],
    ['show me the graph', (t) => ((t.result?.navigations ?? []).some((n) => n.target === 'graph') ? null : 'did not open graph')],
    ['run the property screen', null],
    ['what is it worth?', (t) => (/₹|INR|value|crore|lakh/i.test(turnText(t)) ? null : 'no value')],
    ['add a risk: boundary wall encroachment on the north edge', (t) =>
      /Add asset: a risk/i.test(turnText(t)) ? 'created an asset called "a risk"' : null],
    ['add evidence: survey sketch', (t) => (/2 places to get this/i.test(turnText(t)) ? 'answered with portals, did not add evidence' : null)],
    ['generate a red flag report', null],
    ['close the finding', (t) => (tools(t).includes('clarify') ? null : 'did not ask which')],
    ['mark the encumbrance finding as critical', null],
    ['add a note: site visit booked for Friday', null],
    ['set owner to Asha Menon', null],
    ['thanks', null],
  ];
  // Answers keep to the house style: four lines, a few hundred characters.
  for (const [q, expect] of asks) check(`chat: "${q}"`, await chat(id, q), expect, { maxChars: 360 });

  // ── 6b. Somebody with no documents to hand ─────────────────────────────
  const fresh = await json('POST', '/projects', {
    name: `Audit samples ${new Date().toISOString().slice(11, 19)}`,
    type: 'residential',
    city: 'Bengaluru',
    location: 'Whitefield Main Road, Sy. No. 118/2',
    landAreaSqm: 12000,
    builtUpAreaSqm: 48000,
  });
  const sid = fresh.body.id ?? fresh.body.project?.id;
  const samples = await chat(sid, 'use the sample documents');
  check('chat: "use the sample documents"', samples, (t) => {
    const filings = (t.result?.proposals ?? []).filter((p) => p.kind === 'file_evidence').length;
    return filings >= 9 ? null : `only ${filings} documents read`;
  }, { maxChars: 700 });
  check('samples: approve all', await chat(sid, 'approve all'));
  check('samples: approve every open card', await chat(sid, 'approve every open card'));
  const sampled = await project(sid);
  const sampledFields = {};
  for (const a of sampled.assessments) for (const s of a.scopes) for (const c of s.checks) Object.assign(sampledFields, c.fields ?? {});
  record('samples: a DD was started from the documents', sampled.assessments.length >= 1, `${sampled.assessments.length} DD(s)`);
  record('samples: checks filled from the documents', Object.keys(sampledFields).length >= 8, `${Object.keys(sampledFields).length} check fields recorded`);
  record(
    'samples: the EC mortgage became a finding',
    sampled.findings.some((f) => /mortgage/i.test(f.title) && f.severity === 'critical'),
    sampled.findings.map((f) => f.title).slice(0, 3).join('; ') || '(none)',
  );

  // ── 7. The report ───────────────────────────────────────────────────────
  const report = await json('POST', `/projects/${id}/reports`, { kind: 'executive_dd' });
  record('generate executive report', report.status === 201, `HTTP ${report.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  ✗ ${f.step} — ${f.detail}`);
  }
  console.log(`\nProject: ${id}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
