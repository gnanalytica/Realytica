/**
 * A value that waits acts on nothing.
 *
 * A model's reading nobody has accepted, and a value two readers differ on,
 * wait on their paper. No check card carries one, no lender's line counts
 * one, no valuation input is offered from one, no approval is dated by one,
 * and the chat says of one only that it waits. That is decided in one place,
 * `stands` in `fact-review.ts`, and this file holds the two halves of it.
 *
 * The first half reads the source. Every place that reads a paper's values
 * for itself, past the choke point, is listed here with why it may. A new one
 * fails this test until somebody decides what it is: something that acts, to
 * go through `standingFacts`, or something that only shows or files, to be
 * added below with its reason.
 *
 * The second half is each thing that acts, shown a waiting value.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DD_TYPE_DEFINITIONS,
  acceptWaiting,
  acceptedOneAtATime,
  addEvidence,
  answerFromFile,
  applyProjectChat,
  approvalsRegister,
  attachEvidenceFile,
  certifiedReadout,
  createAssessment,
  createProject,
  documentDisagreements,
  factFillProposals,
  factsOnFile,
  liveFacts,
  placeProposalsFromIngest,
  proposeFacts,
  proposalsFromIngest,
  readingsWaitingOnFile,
  reviewFacts,
  runValuationApproaches,
  standingAsRead,
  standingFacts,
  stands,
  valueChecks,
  valueOffers,
  valueReadingsWaiting,
  valueSummary,
  waitingAsRead,
  waitingReadings,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
  type ReadingCoverage,
} from '@realytica/shared';
import { PROPOSAL_IDENTITY, applyReviewedPayload } from '../apps/api/src/proposal-review';

/* ==================================================================== */
/* The source: who reads a paper's values for itself                     */
/* ==================================================================== */

const ROOTS = ['packages/shared/src', 'packages/agents/src', 'apps/api/src'];

/**
 * Every read of a paper's values that does not go through `standingFacts` or
 * `standingAsRead`, with why it may. `file` is a file, or a folder where it
 * ends in a slash. `has` is words the line holds; without it every such line
 * of the file is meant.
 */
const ALLOWED: ReadonlyArray<{ file: string; has?: string; why: string }> = [
  { file: 'packages/shared/src/operating-model/fact-review.ts', why: 'the choke point itself: where a paper’s values are sorted into what stands and what waits' },
  { file: 'apps/api/src/documents/intake.ts', why: 'the reader: where a reading’s values are made, laid together and counted, before anything can act on them' },
  { file: 'packages/agents/src/project/ingest-intelligence.ts', has: '= factsFromFields(', why: 'the model reader: where what it read becomes values, each marked a model’s and with what stands behind it' },
  { file: 'packages/agents/src/memory/', why: 'another thing called facts: what the agents remember across cases, not what a paper states' },
  { file: 'apps/api/src/flows/handlers.ts', has: 'result.facts', why: 'that same memory, recalled for a flow' },

  // Deciding values is not acting on them: these accept, set aside and reopen, and whatever they accept then stands.
  { file: 'packages/shared/src/operating-model/review.ts', has: 'const facts = evidence.facts ?? [];', why: 'the values a person is deciding' },
  { file: 'packages/shared/src/operating-model/review.ts', has: 'evidence.facts = rows;', why: 'writes the decided values back to the row' },
  { file: 'packages/shared/src/operating-model/review.ts', has: 'sourceRow(project, card)?.facts', why: 'asks whether a card’s field came from a reading that waits, so as to leave it' },
  { file: 'packages/shared/src/operating-model/review.ts', has: "(row?.facts ?? []).some((f) => f.key === k && factReview(f) === 'proposed'", why: 'the waiting value a person just accepted on a check is accepted on its paper too' },

  // Filing a reading is not acting on it: every value goes onto its row proposed, to wait there.
  { file: 'packages/shared/src/operating-model/wizard.ts', has: 'const facts = read ? read.facts :', why: 'puts the whole reading on the card that files it, in the order it was read' },
  { file: 'packages/shared/src/operating-model/wizard.ts', has: 'payload.facts', why: 'files the card’s reading on the row, each value proposed' },
  { file: 'apps/api/src/documents/register-read.ts', has: 'known ? doc.facts :', why: 'puts the whole reading on the row it was filed on, each value proposed' },
  { file: 'apps/api/src/documents/register-read.ts', has: 'evidence.facts = proposeFacts(evidence.facts ?? [], facts);', why: 'the same, written to the row' },

  // Asking whether a paper was read, or how much it has, is not reading what it states.
  { file: 'packages/shared/src/operating-model/chat-places.ts', has: '!(e.facts ?? []).length && !e.modelReadAt', why: 'counts the papers nobody has read' },
  { file: 'apps/api/src/documents/reread.ts', has: '(card.payload as { facts?: unknown }).facts', why: 'whether a waiting card carries a reading at all' },
  { file: 'apps/api/src/documents/reread.ts', has: '!(e.facts ?? []).length && (!e.modelReadAt', why: 'whether a row was ever read' },
  { file: 'apps/api/src/documents/reread.ts', has: '(e.facts ?? []).length < 3 && e.attachments.length > 0', why: 'how much a row has, to choose how it is read again' },
  { file: 'packages/shared/src/operating-model/mem-delta.ts', has: '!row.readMethod && !row.facts?.length', why: 'whether a paper was read, for the project’s memory' },
  { file: 'packages/shared/src/operating-model/mem-delta.ts', has: '?.facts?.find((fact) => names(fact.label))?.key', why: 'finds which value an audit line names, to record a decision a person already made' },

  // Showing what waits, as waiting.
  { file: 'packages/shared/src/operating-model/revenue-map.ts', has: 'for (const fact of liveFacts(row))', why: 'the survey number picker: every number read is offered, each said to be accepted, waiting or a model’s, and `stands` says which may be counted' },
  { file: 'apps/api/src/routes/projects.ts', has: 'facts: read.read?.facts ?? []', why: 'streams this server’s reading to the desk, which shows each value as waiting' },
  { file: 'apps/api/src/routes/projects.ts', has: 'facts: merged.read.facts', why: 'streams the reading with the model’s laid over it to the same desk' },

  // An offer's own list of the values it was read from, by row and key. Not a paper's values.
  { file: 'packages/shared/src/operating-model/value-inputs.ts', has: 'rest.facts?.[0]?.key', why: 'names an offer by the first value it was read from' },
  { file: 'packages/shared/src/operating-model/value-inputs.ts', has: 'offer.facts ? { facts: offer.facts }', why: 'carries that list from one offer to the one made from it' },
  { file: 'packages/shared/src/operating-model/value-inputs.ts', has: 'for (const read of offer.facts ?? [])', why: 'accepts on its paper the value an accepted offer was read from, looked up through `standingFacts`' },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
  });
}

/** A call of `liveFacts`, a read of `.facts` (not a list spread as `...facts`), or `facts` taken out of something by its name. */
const READS = /\bliveFacts\(|(?<!\.)\.facts\b|\{[^{}]*\bfacts\b[^{}]*\}\s*=[^=>]/;

describe('who reads a paper’s values', () => {
  const found: Array<{ file: string; line: number; text: string }> = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          const code = text.trim();
          // Words about the code are not the code.
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (READS.test(code)) found.push({ file: file.split(path.sep).join('/'), line: i + 1, text: code });
        });
    }
  }
  const allows = (entry: (typeof ALLOWED)[number], read: (typeof found)[number]) =>
    (entry.file.endsWith('/') ? read.file.startsWith(entry.file) : read.file === entry.file) && (!entry.has || read.text.includes(entry.has));

  it('goes through `standingFacts`, or is on the list with its reason', () => {
    const unlisted = found.filter((read) => !ALLOWED.some((entry) => allows(entry, read)));
    assert.deepEqual(
      unlisted.map((read) => `${read.file}:${read.line}  ${read.text.slice(0, 140)}`),
      [],
      'Each of these reads a paper’s values for itself. If it acts on them (a card, a lender’s line, a valuation input, an approval, a sentence in chat), ' +
        'read them through `standingFacts` or `standingAsRead`. If it only files, counts or shows them as waiting, add it to ALLOWED in this file with why.',
    );
  });

  it('keeps no reason on the list that nothing answers to any more', () => {
    const stale = ALLOWED.filter((entry) => !found.some((read) => allows(entry, read)));
    assert.deepEqual(stale.map((entry) => `${entry.file}${entry.has ? `  ${entry.has}` : ''}`), [], 'an allowance nothing uses is a door left open for the next reader');
  });

  it('finds what it is meant to find', () => {
    // The pattern is the test: held to the three shapes a read takes, and to what it must leave alone.
    for (const reads of ['for (const f of liveFacts(row)) use(f);', 'const first = evidence.facts?.[0];', 'const { title, facts } = evidence;', 'const { facts = [] } = row;']) assert.ok(READS.test(reads), reads);
    for (const not of ['const facts = standingFacts(row);', 'facts?: DocumentFact[];', 'return { facts: kept, withheld };', 'if (facts.length) return;', 'run(({ facts }) => facts.length);', 'let rows = [...facts];']) assert.equal(READS.test(not), false, not);
    assert.ok(found.length >= ALLOWED.length, 'and the source was read');
  });
});

/* ==================================================================== */
/* The choke point                                                       */
/* ==================================================================== */

const fact = (key: string, label: string, value: DocumentFact['value'], display: string, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label, value, display, page: 1, quote: `${label}: ${display}`, ...more });
const byModel = (proof: 'page_text' | 'second_reader'): Partial<DocumentFact> => ({ source: 'model', proof, pageCheck: proof === 'page_text' ? 'text' : 'page' });

/** The rules read 73/4, a model 73/1, each with its words on a page. */
const contested = (): DocumentFact =>
  fact('survey_numbers', 'Survey number', '73/4', '73/4', {
    quote: 'Survey No. 73/4, situated at Navilugudda Village',
    otherReading: fact('survey_numbers', 'Survey number', '73/1', '73/1', { quote: 'Survey No. 73/1, situated at Navilugudda Village', page: 2, ...byModel('second_reader') }),
  });

function project(): DdProject {
  return createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
}

/** A project with a diligence running, so a value has checks to be offered to. */
function withDiligence(): DdProject {
  const p = project();
  const dd = DD_TYPE_DEFINITIONS.find((d) => d.key !== 'custom')!;
  createAssessment(p, { ddType: dd.key, owner: 'tester', targetType: 'project', name: dd.label }, 'tester');
  return p;
}

function filed(p: DdProject, title: string, type: string | undefined, facts: DocumentFact[]) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  attachEvidenceFile(p, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k-${row.id}.pdf`, capture: {} }, 'tester');
  if (type) row.documentType = type;
  row.facts = proposeFacts([], facts);
  return row;
}

const checkValue = (p: DdProject, key: string): unknown => {
  for (const a of p.assessments) for (const s of a.scopes) for (const c of s.checks) if (c.fields?.[key]?.value !== undefined && c.fields[key]!.value !== '') return c.fields[key]!.value;
  return undefined;
};
const cardsFor = (p: DdProject, key: string) => p.chatProposals.filter((c) => c.kind === 'record_check_fields' && key in ((c.payload.values ?? {}) as Record<string, unknown>));
const lender = (p: DdProject, key: string) => {
  const working = runValuationApproaches(p);
  return valueChecks(p, working, valueSummary(p, working)).find((c) => c.key === key)!;
};

describe('what stands', () => {
  it('is what a person accepted, and what the rules read that no other reader read differently', () => {
    const rules = fact('extent_title', 'Extent per title', 2450, '2,450 sqm');
    const model = fact('ec_nil', 'Nil result', true, 'yes', byModel('page_text'));
    const row = { facts: proposeFacts([], [rules, model, contested()]) };
    assert.deepEqual(standingFacts(row).map((f) => f.key), ['extent_title']);
    assert.deepEqual(waitingReadings(row).map((f) => f.key), ['ec_nil', 'survey_numbers'], 'a model’s value and a value two readers differ on wait');
    assert.deepEqual(liveFacts(row).map((f) => f.key), ['extent_title', 'ec_nil', 'survey_numbers'], 'and a screen that shows what waits still sees all three');

    const accepted = { facts: row.facts.map((f) => ({ ...f, review: 'accepted' as const })) };
    assert.equal(standingFacts(accepted).length, 3, 'accepted, each stands whoever read it');
    assert.equal(standingFacts({ facts: row.facts.map((f) => ({ ...f, review: 'rejected' as const })) }).length, 0);
  });

  it('counts a value filed before values were decided one by one as accepted, and a reading not yet on a row as undecided', () => {
    const old = fact('ec_nil', 'Nil result', true, 'yes', { source: 'model' });
    assert.equal(stands(old), true, 'no decision on a value on file means it came with its approved card');
    // The same value in a reading that is not on a row yet is one nobody has decided.
    assert.deepEqual(standingAsRead({ facts: [old] }), []);
    assert.deepEqual(waitingAsRead({ facts: [old] }), [old]);
    assert.deepEqual(standingAsRead({ facts: [contested(), fact('extent_title', 'Extent per title', 2450, '2,450 sqm')] }).map((f) => f.key), ['extent_title']);
    assert.equal(stands(contested()), false, 'a value with another reader’s beside it and no decision was never accepted by anybody');
    assert.deepEqual(standingAsRead(undefined), []);
  });

  it('names the values a person accepts one at a time', () => {
    assert.equal(acceptedOneAtATime(contested()), true, 'two readers differ');
    assert.equal(acceptedOneAtATime(fact('ec_nil', 'Nil result', true, 'yes', byModel('page_text'))), true, 'a model’s yes or no, whatever its quote was found in');
    assert.equal(acceptedOneAtATime(fact('ec_to', 'EC searched to', '2024-03-31', '31 Mar 2024', byModel('second_reader'))), true, 'an exact value with only a second model behind it');
    assert.equal(acceptedOneAtATime(fact('ec_to', 'EC searched to', '2024-03-31', '31 Mar 2024', byModel('page_text'))), false, 'an exact value whose words are in the page’s text');
    assert.equal(acceptedOneAtATime(fact('owner', 'Owner on record', 'Rathnamma', 'Rathnamma', byModel('second_reader'))), false, 'a name two models read the same');
    assert.equal(acceptedOneAtATime(fact('ec_to', 'EC searched to', '2024-03-31', '31 Mar 2024', { source: 'model', pageCheck: 'page' })), true, 'and one confirmed before the proof was kept, by a model shown the words');
    assert.equal(acceptedOneAtATime(fact('ec_to', 'EC searched to', '2024-03-31', '31 Mar 2024')), false, 'what the rules read is accepted with the rest');
  });
});

/* ==================================================================== */
/* Each thing that acts, shown a value that waits                        */
/* ==================================================================== */

describe('a value that waits', () => {
  const ec = (): ChatIngestFile => ({
    fileName: 'ec.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    storageKey: 'k-ec.pdf',
    modelRead: true,
    read: {
      type: 'encumbrance_certificate',
      label: 'Encumbrance certificate',
      confidence: 0.9,
      method: 'ocr',
      flags: [],
      summary: 'An encumbrance certificate',
      rowHints: ['encumbrance certificate'],
      scopes: [],
      evidenceKind: 'certificate',
      facts: [
        fact('ec_from', 'EC searched from', '1994-04-01', '1 Apr 1994', { quote: 'Period of search: from 01-04-1994' }),
        fact('ec_to', 'EC searched to', '2024-03-31', '31 Mar 2024', { quote: 'to 31-03-2024', ...byModel('second_reader') }),
        fact('ec_nil', 'Nil result', true, 'yes', { quote: 'no other encumbrance was found', ...byModel('page_text') }),
        fact('ec_transactions', 'Transactions in the period', 4, '4', { quote: 'Number of transactions: 4', ...byModel('page_text') }),
      ],
    },
  } as ChatIngestFile);
  const deed = (): ChatIngestFile => ({
    fileName: 'deed.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1,
    storageKey: 'k-deed.pdf',
    read: {
      type: 'sale_deed',
      label: 'Sale deed',
      confidence: 0.9,
      method: 'ocr',
      flags: [],
      summary: 'A sale deed',
      rowHints: ['sale deed'],
      scopes: [],
      evidenceKind: 'document',
      facts: [contested(), fact('extent_title', 'Extent per title', 2450, '2,450 sqm', { unit: 'sqm', quote: 'measuring 2,450 square metres' })],
    },
  } as ChatIngestFile);

  it('is on no check card when a paper is dropped in the chat, and is said on its card as waiting', () => {
    const p = withDiligence();
    const cards = proposalsFromIngest(p, [ec(), deed()], 'tester');
    const offered = cards.filter((c) => c.kind === 'record_check_fields').flatMap((c) => Object.entries((c.payload.values ?? {}) as Record<string, unknown>));
    assert.deepEqual(offered, [['ec_from', '1994-04-01'], ['extent_title', 2450]], 'only what the rules read, where no other reader read it differently');
    const file = cards.find((c) => c.kind === 'file_evidence' && c.payload.fileName === 'ec.pdf')!;
    assert.match(file.rationale, /EC searched from 1 Apr 1994 \(p\.1\)\. Waiting to be accepted: EC searched to 31 Mar 2024 \(p\.1\); Nil result yes \(p\.1\); Transactions in the period 4 \(p\.1\)\./);
    assert.equal((file.payload.facts as DocumentFact[]).length, 4, 'and the whole reading still goes onto the row, to wait there');
    // The second lock: handed a waiting value all the same, the card builder offers it to no check.
    const row = filed(p, 'Deed', 'Sale deed', [contested()]);
    assert.deepEqual(factFillProposals(p, row.facts!, { fileName: 'deed.pdf', evidenceId: row.id }, 'tester'), []);
    assert.deepEqual(factFillProposals(p, [contested()], { fileName: 'deed.pdf' }, 'tester'), [], 'nor one that is not on a row yet');
  });

  it('is left by “approve all”, where a person accepts it by itself, and the reply says which and why', () => {
    const p = withDiligence();
    applyProjectChat(p, '', { actor: 'tester', ingest: [ec(), deed()] });
    const reply = applyProjectChat(p, 'approve all', { actor: 'tester' }).assistantTurn.text;
    const stand = (type: string) => Object.fromEntries(p.evidence.find((e) => e.documentType === type)!.facts!.map((f) => [f.key, [f.value, f.review]]));
    assert.deepEqual(stand('Encumbrance certificate'), {
      ec_from: ['1994-04-01', 'accepted'],
      ec_to: ['2024-03-31', 'proposed'],
      ec_nil: [true, 'proposed'],
      ec_transactions: [4, 'accepted'],
    }, 'the rules’ value and the model’s whose words are in the page’s text are accepted; the date only a second model stands behind, and the yes or no, wait');
    assert.deepEqual(stand('Sale deed'), { survey_numbers: ['73/4', 'proposed'], extent_title: [2450, 'accepted'] }, 'and nobody has chosen between 73/4 and 73/1');
    assert.equal(checkValue(p, 'ec_to'), undefined);
    assert.equal(checkValue(p, 'ec_nil'), undefined);
    assert.equal(checkValue(p, 'survey_numbers'), undefined, 'so none of the three is on a check');
    assert.equal(checkValue(p, 'ec_from'), '1994-04-01');
    assert.match(
      reply,
      /^Accepted 3 values on 2 documents\. 3 values are left to accept one at a time on the document: Survey number \(two readings\), EC searched to \(only a second model’s reading behind it\) and Nil result \(a model’s yes or no\)\./,
    );
  });

  it('reaches its checks when a person accepts it, as the value that was kept', () => {
    const p = withDiligence();
    const row = filed(p, 'Sale deed', 'Sale deed', [contested()]);
    assert.deepEqual(cardsFor(p, 'survey_numbers'), [], 'nothing was offered while two readings stood');
    assert.equal(reviewFacts(p, row.id, 'all', 'accept', 'tester').changed.length, 0, 'accept-all on the row does not choose');

    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester', undefined, { take: 'other' });
    const kept = row.facts!.find((f) => f.key === 'survey_numbers')!;
    assert.deepEqual([kept.value, kept.review, kept.otherReading?.value], ['73/1', 'accepted', '73/4']);
    assert.equal(checkValue(p, 'survey_numbers'), '73/1', 'the document states 73/1, and so does the check');
    const card = cardsFor(p, 'survey_numbers')[0]!;
    assert.deepEqual([(card.payload.citations as Record<string, { page: number; quote: string }>).survey_numbers!.page, (card.payload.citations as Record<string, { quote: string }>).survey_numbers!.quote], [2, 'Survey No. 73/1, situated at Navilugudda Village'], 'with the kept reading’s own page and words');
  });

  it('sets aside a card raised earlier for the other reading, and never records it', () => {
    // A card from before the second reading arrived, or from before this rule: the rules' 73/4, waiting on its check.
    const p = withDiligence();
    const row = filed(p, 'Sale deed', 'Sale deed', [fact('survey_numbers', 'Survey number', '73/4', '73/4', { quote: 'Survey No. 73/4, situated at Navilugudda Village' })]);
    p.chatProposals.push(...factFillProposals(p, row.facts!, { fileName: 'Sale deed.pdf', evidenceId: row.id, documentLabel: 'Sale deed' }, 'tester'));
    const old = cardsFor(p, 'survey_numbers')[0]!;
    assert.equal((old.payload.values as Record<string, unknown>).survey_numbers, '73/4');
    // Read again, with a model this time: the two differ.
    row.facts = proposeFacts(row.facts!, [contested()]);

    // "All" is not looking at this one: nothing is accepted, and the old card's value is recorded nowhere.
    const all = reviewFacts(p, row.id, 'all', 'accept', 'tester');
    assert.equal(all.changed.length, 0);
    assert.equal(acceptWaiting(p, old.id, 'tester').proposal.status, 'proposed', 'nor does accepting the whole card: its value is decided on the paper, where both readings are');
    assert.equal(checkValue(p, 'survey_numbers'), undefined);

    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester', undefined, { take: 'other' });
    assert.equal(checkValue(p, 'survey_numbers'), '73/1', 'not the 73/4 its old card carried');
    assert.equal((old.payload.decided as Record<string, string>).survey_numbers, 'rejected', 'that card’s value was set aside where it waited');
  });

  it('keeps the rules’ reading on the check when that is the one a person keeps', () => {
    const p = withDiligence();
    const row = filed(p, 'Sale deed', 'Sale deed', [contested()]);
    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester');
    assert.equal(row.facts!.find((f) => f.key === 'survey_numbers')!.value, '73/4');
    assert.equal(checkValue(p, 'survey_numbers'), '73/4');
  });

  it('is on no lender’s line, which says a reading is waiting', () => {
    const p = project();
    filed(p, 'Sale deed', 'Sale deed', [fact('extent_title', 'Extent per title', 2450, '2,450 sqm', { unit: 'sqm' })]);
    const alone = lender(p, 'extents_agree');
    filed(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 'Extent per khata', 1115, '1,115 sqm', { unit: 'sqm', ...byModel('second_reader') })]);
    const beside = lender(p, 'extents_agree');
    assert.deepEqual([beside.verdict, beside.headline], [alone.verdict, alone.headline], 'a model’s 1,115 beside a deed’s 2,450 is not two papers 54% apart');
    assert.equal(beside.detail, `${alone.detail} A reading of the extent per khata on the khata certificate and extract is waiting to be accepted and is not counted.`);

    // A value two readers differ on answers a check no more than a model's does.
    const q = project();
    filed(q, 'EC', 'Encumbrance certificate', [fact('ec_nil', 'Nil result', true, 'yes', { otherReading: fact('ec_nil', 'Nil result', false, 'no', byModel('page_text')) })]);
    const charges = lender(q, 'charges');
    assert.deepEqual([charges.verdict, charges.headline], ['unknown', 'A reading is waiting']);
    assert.match(charges.detail, /^Two readers read “Nil result” differently on Encumbrance certificate, p\. 1 \(yes and no\), and nobody has kept one\. Keep one on the document/);
  });

  it('is offered to no valuation input, and the page is told that it waits', () => {
    const p = project();
    const row = filed(p, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 'Extent per khata', 1115, '1,115 sqm', { unit: 'sqm', ...byModel('page_text') })]);
    assert.deepEqual(valueOffers(p).filter((o) => o.source.kind === 'document'), []);
    assert.deepEqual(valueReadingsWaiting(p).map(({ evidence, fact: f }) => [evidence.id, f.key]), [[row.id, 'extent_khata']]);
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'tester');
    assert.deepEqual(valueOffers(p).filter((o) => o.source.kind === 'document').map((o) => [o.input, o.value]), [['land_area', 1115], ['area_valued', 1115]]);
    assert.deepEqual(valueReadingsWaiting(p), []);
  });

  it('dates no approval, and the register says a reading of it waits', () => {
    const p = project();
    const now = new Date('2026-10-06T00:00:00.000Z');
    const row = filed(p, 'Conversion order', 'DC conversion order', [
      fact('conversion_date', 'Date of the conversion order', '2019-03-12', '12 Mar 2019', byModel('second_reader')),
      fact('valid_until', 'Valid until', '2020-03-12', '12 Mar 2020', byModel('second_reader')),
    ]);
    const line = () => approvalsRegister(p, now).find((l) => l.kind.key === 'conversion')!;
    assert.deepEqual([line().status, line().held[0]!.issuedOn, line().held[0]!.validUntil], ['in_force', undefined, undefined], 'on file, and not lapsed on a model’s word');
    assert.equal(line().say, 'On file; no dates read yet. A reading of its details is waiting to be accepted on the document.');
    reviewFacts(p, row.id, ['valid_until'], 'accept', 'tester');
    assert.deepEqual([line().status, line().held[0]!.validUntil], ['expired', '2020-03-12'], 'accepted by a person, the date is the approval’s');
  });

  it('is not said in the chat as on file, only as waiting', () => {
    const p = project();
    const row = filed(p, 'Encumbrance certificate', 'Encumbrance certificate', [fact('survey_numbers', 'Survey number', '143/2', '143/2', { quote: 'ಸರ್ವೆ ನಂಬರ್ 143/2', ...byModel('second_reader') })]);
    assert.deepEqual(factsOnFile(p), []);
    assert.deepEqual(readingsWaitingOnFile(p).map(({ fact: f }) => f.value), ['143/2']);
    const answer = answerFromFile(p, 'What is the survey number?')!;
    assert.equal(answer.text, 'A model read survey number 143/2 on the encumbrance certificate (p.1). Nobody has accepted it, so it is not on file.');
    assert.equal(answer.summary, 'A reading is waiting');
    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester');
    assert.equal(answerFromFile(p, 'What is the survey number?')!.text, 'Survey No. 143/2 (encumbrance certificate, p.1).');

    // Beside an answer that stands, what waits for the same question is said after it.
    const q = project();
    filed(q, 'Sale deed', 'Sale deed', [fact('extent_title', 'Extent per title', 2450, '2,450 sqm', { unit: 'sqm' })]);
    filed(q, 'Khata', 'Khata certificate and extract', [fact('extent_khata', 'Extent per khata', 1115, '1,115 sqm', { unit: 'sqm', ...byModel('second_reader') })]);
    assert.equal(
      answerFromFile(q, 'What is the extent?')!.text,
      'Title 2,450 sqm (sale deed, p.1).\nA model read extent per khata 1,115 sqm on the khata certificate and extract (p.1). Nobody has accepted it, so it is not on file.',
      'the model’s 1,115 is not set against the deed’s 2,450 as if both were on file',
    );
    const r = project();
    filed(r, 'Sale deed', 'Sale deed', [contested()]);
    assert.equal(answerFromFile(r, 'What is the survey number?')!.text, 'Two readers read the survey number differently on the sale deed (p.1): 73/4 and 73/1. Nobody has kept one, so it is not on file.');
  });

  it('differs from nothing on file, fills no certified report, and names no parcel', () => {
    const p = project();
    p.parcelId = 'Sy. No. 9/3';
    const row = filed(p, 'Papers', 'Sale deed', [fact('survey_numbers', 'Survey number', '9/8', '9/8', byModel('second_reader'))]);
    assert.deepEqual(documentDisagreements(p, row), [], 'a model’s 9/8 is not set against the project’s 9/3 until somebody accepts it');
    reviewFacts(p, row.id, ['survey_numbers'], 'accept', 'tester');
    assert.equal(documentDisagreements(p, row).length, 1);

    const q = project();
    const opinion = filed(q, 'Legal opinion', 'Legal opinion on title', [fact('advocate', 'Advocate', 'S. Example', 'S. Example', byModel('page_text')), fact('title_conclusion', 'Conclusion', 'clear', 'clear')]);
    assert.deepEqual([certifiedReadout(q, opinion.id).signer.name, certifiedReadout(q, opinion.id).verdict], [undefined, 'clear'], 'the form is filled from what stands');

    const contestedDrop = { fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k', excerpt: 'Sale deed for Survey No. 73/4, bounded on the west by Survey No. 118/1', read: deed().read } as ChatIngestFile;
    assert.deepEqual(placeProposalsFromIngest(project(), [contestedDrop], 'tester').filter((c) => 'parcelId' in c.payload), [], 'no parcel is proposed from a paper two readers read differently');
  });
});

/* ==================================================================== */
/* What a model took a paper for                                         */
/* ==================================================================== */

describe('what a model took a paper for', () => {
  it('stops being an offer once a card types the row', () => {
    // Filed on the register, where a model took it for an encumbrance certificate and nobody confirmed that.
    const p = project();
    const row = filed(p, 'Papers from the owner', undefined, []);
    row.proposedDocumentType = 'Encumbrance certificate';
    // Read again through the chat, where the rules know it for a sale deed. The card that files that reading types the row.
    const again = {
      fileName: 'Papers from the owner.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      storageKey: row.attachments[0]!.storageKey,
      read: { type: 'sale_deed', label: 'Sale deed', confidence: 0.9, method: 'text', flags: [], summary: 'A sale deed', rowHints: ['sale deed'], scopes: [], evidenceKind: 'document', facts: [fact('extent_title', 'Extent per title', 2450, '2,450 sqm')] },
    } as ChatIngestFile;
    applyProjectChat(p, '', { actor: 'tester', ingest: [again] });
    assert.deepEqual([row.documentType, row.proposedDocumentType], ['Sale deed', undefined], 'there is no offer left for “Confirm it is” to write over the type the row now has');
  });
});

/* ==================================================================== */
/* What a request may not write                                          */
/* ==================================================================== */

describe('a card’s reading', () => {
  it('is this server’s record, and is not taken from a request', () => {
    for (const key of ['reading', 'facts', 'modelRead']) assert.ok(PROPOSAL_IDENTITY.has(key), `${key} is the card's, not the request's`);
    const reading: ReadingCoverage = { pagesInFile: 10, pagesRead: 8, readers: { text: 0, ocr: 8, model: 0 }, modelReasons: ['8 of 10 pages read here; pages 9 and 10 were not.'], modelPages: [9, 10] };
    const model = fact('ec_nil', 'Nil result', true, 'yes', byModel('second_reader'));
    const stored: Record<string, unknown> = { title: 'Scan', storageKey: 'k', reading, facts: [model], modelRead: true };
    applyReviewedPayload(stored, {
      title: 'Scan of the deed',
      // "Read whole", and the model's value passed off as one the rules read.
      reading: { pagesInFile: 10, pagesRead: 10 },
      facts: [{ ...model, source: undefined, proof: undefined, pageCheck: undefined }],
      modelRead: false,
    });
    assert.deepEqual(stored, { title: 'Scan of the deed', storageKey: 'k', reading, facts: [model], modelRead: true }, 'a person corrects the title; how the file was read is not theirs to send');
  });
});

/* ==================================================================== */
/* Asked to read, with nothing left that can be read                     */
/* ==================================================================== */

describe('“read the filed documents”, with nothing it can read', () => {
  const partly: ReadingCoverage = {
    pagesInFile: 10,
    pagesRead: 8,
    readers: { text: 0, ocr: 8, model: 0 },
    ocrPages: [1, 2, 3, 4, 5, 6, 7, 8],
    modelReasons: ['8 of 10 pages read here; pages 9 and 10 were not.'],
    modelPages: [9, 10],
    unreadWhy: 'only the first 8 scanned pages of a file are read here',
  };
  const scanned = (reading: ReadingCoverage | undefined) => {
    const p = project();
    const row = addEvidence(p, { title: 'Scan', kind: 'document', status: 'received' }, 'tester');
    const file = attachEvidenceFile(p, row.id, { fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k-scan.pdf', capture: {} }, 'tester');
    if (reading) file.reading = reading;
    return p;
  };
  const reply = (p: DdProject, modelReader: boolean) => applyProjectChat(p, 'Read the filed documents', { actor: 'tester', nothingLeftToRead: true, modelReader }).assistantTurn.text;

  it('says which pages are unread and why, where no model is set up to read them', () => {
    assert.equal(
      reply(scanned(partly), false),
      'Nothing more can be read here: no model reader is set up. Pages are still unread or unsure:\n' +
        'scan.pdf: 8 of 10 pages read: only the first 8 scanned pages of a file are read here. No model has read the rest.',
    );
  });

  it('says so too where a model answered and pages are still unread', () => {
    const answered = { ...partly, pagesRead: 9, modelPagesSent: [9, 10], modelPagesRead: [9] };
    assert.equal(
      reply(scanned(answered), true),
      'Nothing on file is left to read. Pages are still unread or unsure:\n' +
        'scan.pdf: 9 of 10 pages read: only the first 8 scanned pages of a file are read here. A model was sent pages 9 and 10; nothing it gave for page 10 was found there.',
    );
  });

  it('says only that nothing is left where every paper was read whole', () => {
    assert.equal(reply(scanned({ pagesInFile: 2, pagesRead: 2, readers: { text: 2, ocr: 0, model: 0 }, modelReasons: [], modelPages: [] }), false), 'Nothing on file is left to read.');
    assert.equal(reply(scanned(undefined), true), 'Nothing on file is left to read.');
  });

  it('does not tell somebody with no model reader to ask again when a file is dropped', () => {
    const drop: ChatIngestFile = { fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k-drop.pdf', reading: partly };
    const without = applyProjectChat(project(), '', { actor: 'tester', ingest: [drop], modelReader: false }).assistantTurn.text;
    assert.match(without, /scan\.pdf: 8 of 10 pages read: only the first 8 scanned pages of a file are read here\. No model has read the rest\. No model reader is set up here to read them\.$/);
    const withOne = applyProjectChat(project(), '', { actor: 'tester', ingest: [drop] }).assistantTurn.text;
    assert.match(withOne, /No model has read the rest\. Ask to read the filed documents to carry on\.$/);
  });
});
