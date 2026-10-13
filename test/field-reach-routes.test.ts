/**
 * What a function's fields hold, with sign-in on, over real HTTP: none of it
 * reaches somebody whose grant does not reach the function.
 *
 * One project carries a marked value in every field set of every department,
 * in a check of every scope, and on a buyer. Nine outside people hold nine
 * narrow grants. Each reads every route the API registers that answers a
 * GET, asks the chat, and walks the stored graph, and no answer may carry a
 * marked value, or the id of a set, of a function out of their reach. The
 * routes are read off the running app, so one added later is walked too.
 *
 * Which functions a grant reaches is written out by hand below, from
 * `docs/auth.md`, and not asked of the code under test. Every name and
 * figure here is made up.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  addFieldRecord,
  addressKey,
  fieldCatalog,
  generateReport,
  insertReportBlock,
  issueReport,
  projectView,
  recordCheckFields,
  seedDemoProject,
  setFieldValues,
  standingFieldLines,
  withheldAnswer,
  FIELD_SETS,
  type CheckFieldDef,
  type DdProject,
  type GeneratedReport,
  type GrantArea,
  type ProjectGrant,
  type ProjectGraphNode,
  type ScopeKey,
} from '@realytica/shared';

const JWKS_URL = 'https://example.test/jwks-field-reach';
const ISSUER = 'https://securetoken.google.com/realytica-field-reach';
const AUDIENCE = 'realytica-field-reach';
const OWNER = 'dev@builders.example';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: `sub-${email}`, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

const jwkOf = (key: KeyObject) => ({ ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' });

/* ---- the nine grants, and what each reaches, by hand ------------------- */

interface Held {
  name: string;
  email: string;
  role: ProjectGrant['role'];
  allScopes: boolean;
  scopeKeys: ScopeKey[];
  areas: GrantArea[];
  /** The functions whose sheets this grant is handed. */
  reach: string[];
}

/** Every function whose checks sit in a scope, by `docs/departments.md`: what a grant of every scope names. Procurement's are left out, since `allScopes` does not name Procurement. */
const EVERY_SCOPED = ['legal.title', 'legal.contracts', 'legal.approvals', 'finance.valuation', 'finance.feasibility', 'finance.budget', 'design.drawings', 'construction.progress', 'construction.quality', 'construction.safety', 'commercial.market', 'commercial.handover'];

const HELD: Held[] = [
  { name: 'an advocate on Legal', email: 'advocate@chambers.example', role: 'contributor', allScopes: false, scopeKeys: ['legal'], areas: [], reach: ['legal.title', 'legal.contracts'] },
  { name: 'a quantity surveyor on Cost with no area', email: 'qs@measure.example', role: 'contributor', allScopes: false, scopeKeys: ['cost_quantity'], areas: [], reach: [] },
  { name: 'a quantity surveyor with the budget and the reports', email: 'qs-budget@measure.example', role: 'contributor', allScopes: false, scopeKeys: ['cost_quantity'], areas: ['commercials', 'reports'], reach: ['finance.budget'] },
  { name: 'a buyer’s agent whose grant names Procurement', email: 'agent@tenders.example', role: 'contributor', allScopes: false, scopeKeys: ['cost_quantity', 'procurement'], areas: [], reach: ['procurement.boq', 'procurement.orders', 'procurement.vendors'] },
  { name: 'a valuer without the valuation area', email: 'valuer@values.example', role: 'contributor', allScopes: false, scopeKeys: ['indicative_valuation'], areas: [], reach: [] },
  { name: 'a valuer with the valuation and the reports', email: 'valuer-area@values.example', role: 'contributor', allScopes: false, scopeKeys: ['indicative_valuation'], areas: ['valuation', 'reports'], reach: ['finance.valuation'] },
  { name: 'a surveyor on Handover with the reports and the site record', email: 'surveyor@snags.example', role: 'contributor', allScopes: false, scopeKeys: ['condition_operations'], areas: ['reports', 'site_record'], reach: ['commercial.handover'] },
  { name: 'a reviewer of every scope and every area', email: 'reviewer@audit.example', role: 'reviewer', allScopes: true, scopeKeys: [], areas: ['valuation', 'decisions', 'reports', 'commercials', 'site_record'], reach: EVERY_SCOPED },
  { name: 'a liaison consultant on Approvals', email: 'liaison@permits.example', role: 'contributor', allScopes: false, scopeKeys: ['regulatory'], areas: [], reach: ['legal.approvals'] },
];

/* ---- the marked values -------------------------------------------------- */

interface Marked {
  /** The function it belongs to: for an addition to a shared record, the function that adds it. */
  fn: string;
  set: string;
  /** What is searched for in an answer: the value as stored and as printed. */
  forms: string[];
  /** A shared record's own field: handed wherever a function in reach links to it. */
  shared?: boolean;
  /** A check's field: handed with its scope. */
  scope?: string;
  /** A buyer: handed to nobody outside the firm. */
  buyer?: boolean;
  /** The field's node in the graph. */
  node?: string;
}

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let marked: Marked[] = [];
let routes: string[] = [];
let checkIds: string[] = [];
let ownerReports: { budget: GeneratedReport; lenders: GeneratedReport; frozen: GeneratedReport };
let unitId = '';
const realFetch = globalThis.fetch;

const call = (method: string, route: string, email: string, body?: unknown) =>
  realFetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor(email)}` }, body: body === undefined ? undefined : JSON.stringify(body) });

const at = (rest = '') => `/api/projects/${project.id}${rest}`;

/** Whether a grant is handed a marked value, by the rules written out in `docs/auth.md`. */
function handed(who: Held, mark: Marked): boolean {
  if (mark.buyer) return false;
  if (mark.scope) return who.allScopes || (who.scopeKeys as string[]).includes(mark.scope);
  // A shared record's own fields go where a function in reach links to the record: not judged here, but for a grant that reaches no function.
  if (mark.shared) return who.reach.length > 0;
  return who.reach.includes(mark.fn);
}

/** The marked values of functions out of a grant's reach that an answer carries. */
function leaked(who: Held, text: string): string[] {
  return marked.filter((mark) => !handed(who, mark) && mark.forms.some((form) => text.includes(form))).map((mark) => `${mark.set} (${mark.forms.find((form) => text.includes(form))})`);
}

/** Puts a marked value in every field set that has a field a line, a figure or a day can go in. */
function markEverySet(): void {
  const catalog = fieldCatalog();
  let n = 0;
  const day = () => new Date(Date.UTC(2090, 0, 1) + ++n * 86_400_000).toISOString().slice(0, 10);
  const seedable = (def: CheckFieldDef) => !def.sameAs && !def.retired && ((def.kind === 'text' && !def.suggest) || def.kind === 'money' || def.kind === 'date');
  const valueFor = (def: CheckFieldDef): string | number => (def.kind === 'text' ? `Zq7x${++n}w` : def.kind === 'date' ? day() : 31_415_926 + ++n * 271_828);
  const holders: Record<string, string> = {};
  for (const set of FIELD_SETS) {
    const full = catalog.sets.get(set.extends ?? set.id)!;
    const pick = [...set.fields].sort((a, b) => Number(b.kind === 'text') - Number(a.kind === 'text')).find(seedable);
    if (!pick) continue;
    const value = valueFor(pick);
    let recordId: string | undefined;
    let rejected: unknown[];
    if (set.extends && full.records) {
      if (!holders[full.id]) {
        const title = `Zq7x${++n}w`;
        const made = addFieldRecord(project, full.id, { [full.records.titleField]: title }, OWNER);
        if (!made.record) continue;
        holders[full.id] = made.record.id;
        marked.push({ fn: full.fn, set: full.id, forms: [title], shared: true });
      }
      recordId = holders[full.id];
      rejected = setFieldValues(project, { set: full.id, record: recordId }, { [pick.key]: value }, OWNER).rejected;
    } else if (set.records) {
      const made = addFieldRecord(project, set.id, { [pick.key]: value }, OWNER);
      recordId = made.record?.id;
      rejected = made.rejected;
    } else {
      rejected = setFieldValues(project, { set: full.id }, { [pick.key]: value }, OWNER).rejected;
    }
    if (rejected.length) continue;
    marked.push({ fn: set.fn, set: full.id, forms: [String(value)], node: `${project.id}::field::${addressKey({ fn: full.fn, set: full.id, field: pick.key, ...(recordId ? { record: recordId } : {}) })}`, ...(set.fn === 'shared' ? { shared: true } : {}) });
  }
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-field-reach-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;
  // The walk asks a few thousand questions in a minute.
  process.env.REALYTICA_RATE_LIMIT_API = '1000000';
  process.env.REALYTICA_RATE_LIMIT_MODEL = '1000000';

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(input as string, init);
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Every GET the app answers, read off its own router.
  type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle: { stack?: Layer[] }; regexp: RegExp; keys?: Array<{ name: string }> };
  const prefixOf = (layer: Layer): string => {
    let n = 0;
    return layer.regexp.source
      .replace(/^\^\\\//, '/')
      .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
      .replace(/\(\?:(\\?\/)?\(\[\^\\?\/\]\+\?\)\)/g,(_all, slash?: string) => `${slash ? '/' : ''}:${layer.keys?.[n++]?.name ?? 'p'}`)
      .replace(/\\\//g, '/')
      .replace(/^\^/, '');
  };
  const found = new Set<string>();
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        if (layer.route.methods.get) found.add(`${prefix}${layer.route.path}`.replace(/\/$/, ''));
      } else if (layer.handle?.stack) walk(layer.handle.stack, prefix + prefixOf(layer));
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '');
  routes = [...found].filter((route) => route.startsWith('/api/'));

  assert.equal((await call('GET', '/api/members', OWNER)).status, 200);
  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;

  project = seedDemoProject();
  project.tenantId = tenantId;
  markEverySet();

  const add = (set: string, values: Record<string, unknown>) => {
    const out = addFieldRecord(project, set, values, OWNER);
    assert.deepEqual(out.rejected, [], set);
    return out.record!.id;
  };
  // Four people who are buyers, each by a different road, and a vendor who is not.
  // The unit is handed over with no occupancy certificate on file: Approvals counts such units, off records only Handover's readers are handed.
  unitId = add('shared.units', { number: 'Zq7-Unit-501', tower: 'A', floor: 5, sale_agreed_value: 81_234_567, handover_taken_on: '2026-09-01' });
  const occupancy = project.assessments.flatMap((assessment) => assessment.scopes.flatMap((scope) => scope.checks)).find((check) => check.definitionId === 'regulatory.occupancy')!;
  assert.deepEqual(recordCheckFields(project, occupancy.id, { oc_issued: false }, OWNER).rejected, []);
  const buyer = add('shared.parties', { name: 'Zq7 Buyer Marked', kind: 'individual', roles: ['customer'] });
  const coBuyer = add('shared.parties', { name: 'Zq7 Cobuyer Named', kind: 'individual' });
  const taxBuyer = add('shared.parties', { name: 'Zq7 Deductee Only', kind: 'individual' });
  const ledgerBuyer = add('shared.parties', { name: 'Zq7 Ledger Only', kind: 'individual' });
  add('shared.parties', { name: 'Zq7 Vendor Works', kind: 'company', roles: ['vendor'] });
  add('commercial.inventory.buyers', { party: buyer, unit: unitId, papers_on_file: ['PAN'], co_applicants: [{ party: coBuyer, share_pct: 50 }] });
  add('finance.tax.buyer_tds', { buyer: taxBuyer });
  add('finance.ledgers.customer_ledgers', { buyer: ledgerBuyer });
  for (const name of ['Zq7 Buyer Marked', 'Zq7 Cobuyer Named', 'Zq7 Deductee Only', 'Zq7 Ledger Only']) marked.push({ fn: 'commercial.inventory', set: 'shared.parties', forms: [name], buyer: true });
  marked.push({ fn: 'commercial.inventory', set: 'shared.units', forms: ['81234567'] });

  // The figures the review read off the wrong copies.
  const bidder = add('shared.parties', { name: 'Zq7 Bidder Build', kind: 'company', roles: ['vendor'] });
  add('procurement.boq.earnest_money', { bidder, amount: 5_432_101 });
  add('procurement.boq.evaluations', { approver: bidder });
  assert.deepEqual(setFieldValues(project, { set: 'finance.budget.contingency' }, { contingency_original: 12_345_678 }, OWNER).rejected, []);
  assert.deepEqual(setFieldValues(project, { set: 'finance.valuation.conclusion' }, { book_value: 987_654_321, liquidation_value: 555_444_333 }, OWNER).rejected, []);
  assert.deepEqual(setFieldValues(project, { set: 'finance.lenders.position' }, { outstanding_per_statement: 777_123_456 }, OWNER).rejected, []);
  marked.push({ fn: 'procurement.boq', set: 'procurement.boq.earnest_money', forms: ['5432101'] });
  marked.push({ fn: 'finance.budget', set: 'finance.budget.contingency', forms: ['12345678'] });
  marked.push({ fn: 'finance.valuation', set: 'finance.valuation.conclusion', forms: ['987654321', '555444333'] });
  marked.push({ fn: 'finance.lenders', set: 'finance.lenders.position', forms: ['777123456'] });

  // A marked value on one check of every scope the project has.
  const catalog = fieldCatalog();
  let figure = 610_000_007;
  for (const scope of project.assessments.flatMap((assessment) => assessment.scopes)) {
    if (marked.some((mark) => mark.scope === scope.scopeKey)) continue;
    for (const check of scope.checks) {
      const def = catalog.sets.get(check.definitionId)?.fields.find((field) => (field.kind === 'money' || (field.kind === 'number' && field.max === undefined)) && !field.sameAs && !field.showWhen);
      if (!def) continue;
      figure += 1_000_003;
      if (recordCheckFields(project, check.id, { [def.key]: figure }, OWNER).rejected.length) continue;
      marked.push({ fn: '', set: check.definitionId, forms: [String(figure)], scope: scope.scopeKey });
      checkIds.push(check.id);
      break;
    }
  }

  // Lines put off, by their keys: one on the lender's sheet and one on Title's.
  project.fieldSnoozes = {
    'finance.lenders.position::::outstanding_per_statement::runs_out': { until: '2090-01-01', by: OWNER, at: new Date().toISOString() },
    'legal.title.holding::::extent::runs_out': { until: '2090-01-01', by: OWNER, at: new Date().toISOString() },
  };

  // The firm's own reports: Budget's and the lenders', live, and one issued with every field block frozen.
  const budget = generateReport(project, { kind: 'function', template: 'finance.budget.report', generatedBy: OWNER }, OWNER);
  insertReportBlock(project, budget.id, { heading: 'Buyers', source: { kind: 'field_table', records: 'commercial.inventory.buyers' } }, OWNER);
  insertReportBlock(project, budget.id, { heading: 'Lenders', source: { kind: 'fields', addresses: [{ fn: 'finance.lenders', set: 'finance.lenders.position', field: 'outstanding_per_statement' }] } }, OWNER);
  const frozen = generateReport(project, { kind: 'executive_dd', generatedBy: OWNER }, OWNER);
  insertReportBlock(project, frozen.id, { heading: 'Every party', source: { kind: 'field_table', records: 'shared.parties', columns: ['name'] } }, OWNER);
  insertReportBlock(project, frozen.id, { heading: 'Lenders', source: { kind: 'fields', addresses: [{ fn: 'finance.lenders', set: 'finance.lenders.position', field: 'outstanding_per_statement' }] } }, OWNER);
  insertReportBlock(project, frozen.id, { heading: 'Bids', source: { kind: 'field_table', records: 'procurement.boq.evaluations' } }, OWNER);
  insertReportBlock(project, frozen.id, { heading: 'Contingency', source: { kind: 'fields', addresses: [{ fn: 'finance.budget', set: 'finance.budget.contingency', field: 'contingency_original' }] } }, OWNER);
  // A handover request names who it is for: frozen, the row keeps the name it read that day.
  add('commercial.handover.requests', { request_no: 'Zq7-SR-1', unit: unitId, contractor: buyer });
  insertReportBlock(project, frozen.id, { heading: 'Requests', source: { kind: 'field_table', records: 'commercial.handover.requests', columns: ['request_no', 'contractor'] } }, OWNER);
  issueReport(project, frozen.id, OWNER, { name: 'A. Signer' });
  const lenders = generateReport(project, { kind: 'executive_dd', generatedBy: OWNER }, OWNER);
  ownerReports = { budget, lenders, frozen };

  // A marked value typed over by a figure set by hand above is no longer on the project to be found.
  const stored = JSON.stringify(project);
  marked = marked.filter((mark) => stored.includes(mark.forms[0]!));

  // A value is also searched for as it prints: on a report's row, a graph node's label, a chat card.
  const printed = new Map(standingFieldLines(project).map((line) => [`${project.id}::field::${addressKey(line.address)}`, line.text]));
  const seen = new Map<string, number>();
  for (const text of printed.values()) seen.set(text, (seen.get(text) ?? 0) + 1);
  for (const mark of marked) {
    const text = mark.node ? printed.get(mark.node) : undefined;
    // Only a printed form no other value shares, and long enough not to be met by chance.
    if (text && text.length >= 8 && seen.get(text) === 1 && !mark.forms.includes(text)) mark.forms.push(text);
  }

  store.data.projects!.push(project);
  for (const who of HELD) {
    assert.equal((await call('POST', '/api/members', OWNER, { email: who.email, role: 'collaborator' })).status, 201);
    assert.equal((await call('GET', '/api/members', who.email)).status, 200);
  }
  store.data.grants = HELD.map((who, index): ProjectGrant => ({ id: `grant-${index}`, tenantId, projectId: project.id, email: who.email, role: who.role, allAssessments: true, assessmentIds: [], allScopes: who.allScopes, scopeKeys: who.scopeKeys, areas: who.areas, createdAt: new Date().toISOString(), createdBy: OWNER }));
  await store.save();
  // The firm's own save writes the whole file's graph to the store.
  assert.equal((await call('PATCH', at(), OWNER, {})).status, 200);
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

/** Every address a route pattern stands for on this project: each named part filled with the ids it could be asked with. */
function addresses(route: string): string[] {
  const fill: Record<string, string[]> = {
    projectId: [project.id],
    checkId: checkIds,
    reportId: project.reports.map((report) => report.id),
    ddId: project.assessments.map((assessment) => assessment.id),
    evidenceId: project.evidence.slice(0, 2).map((row) => row.id),
    nodeId: [...new Set(marked.flatMap((mark) => (mark.node ? [mark.node] : [])))].filter((_, index) => index % 4 === 0),
    runId: project.valuationRuns.slice(0, 1).map((run) => run.id),
  };
  let out = [route];
  for (const part of route.match(/:[A-Za-z]+/g) ?? []) {
    const ids = fill[part.slice(1)]?.length ? fill[part.slice(1)]! : ['none'];
    out = out.flatMap((path) => ids.map((id) => path.replace(part, encodeURIComponent(id))));
  }
  return out;
}

/** The questions a route is asked with, where it answers to one. */
const asked = (): Record<string, string[]> => ({
  '/graph/neighbourhood': ['finance', 'legal', 'lenders', 'procurement', 'budget', 'valuation', 'sales', 'unit', 'Zq7'].map((query) => `?query=${query}&hops=3`),
  '/graph/impact': [project.id, ...marked.flatMap((mark) => (mark.node ? [mark.node] : [])).filter((_, index) => index % 9 === 0)].map((node) => `?node=${encodeURIComponent(node)}`),
});

describe('the firm’s own person', () => {
  it('reads every marked value, so the walk below is searching for things that are there', async () => {
    const body = await (await call('GET', at(), OWNER)).text();
    const missing = marked.filter((mark) => !mark.forms.some((form) => body.includes(form)));
    assert.deepEqual(missing.map((mark) => mark.set), []);
    assert.ok(new Set(marked.map((mark) => mark.fn)).size >= 45, 'a marked value in nearly every function');
    assert.ok(marked.filter((mark) => mark.scope).length >= 5, 'a marked value on a check of several scopes');
    assert.ok(routes.length >= 70, `the app's routes were read: ${routes.length}`);
    assert.deepEqual(routes.filter((route) => /[(?\\]/.test(route)), [], 'every route was read as a path');
    assert.ok(routes.filter((route) => route.startsWith('/api/projects/:projectId/')).length >= 40, 'the project’s own routes are among them');
  });

  it('is given the stored graph with a field node of every department', async () => {
    const res = await call('GET', at('/graph/neighbourhood?query=finance&hops=3'), OWNER);
    const body = (await res.json()) as { source: string; nodes: ProjectGraphNode[] };
    assert.equal(body.source, 'journal');
    assert.ok(body.nodes.some((node) => node.kind === 'field_value' && node.id.includes('finance.lenders.position')));
  });
});

describe('somebody working from a grant, on every route that answers a GET', () => {
  for (const who of HELD) {
    it(`${who.name}: no answer carries a value of a function out of reach`, async () => {
      const outOfReach = [...new Set(marked.filter((mark) => !handed(who, mark) && !mark.scope && !mark.shared && !mark.buyer).map((mark) => mark.set))].filter((set) => !set.startsWith('shared.'));
      const faults: string[] = [];
      let answered = 0;
      const questions = asked();
      for (const route of routes) {
        const suffix = Object.keys(questions).find((end) => route.endsWith(end));
        for (const address of addresses(route)) {
          for (const query of suffix ? questions[suffix]! : ['']) {
            const res = await call('GET', `${address}${query}`, who.email);
            const text = await res.text();
            if (res.status === 200) answered += 1;
            const found = leaked(who, text);
            if (found.length) faults.push(`${address}${query} → ${found.slice(0, 3).join(', ')}${found.length > 3 ? ` and ${found.length - 3} more` : ''}`);
            // The id of a set that holds something says the function keeps it, whatever it holds.
            const named = res.status === 200 && address.startsWith(at()) ? outOfReach.filter((set) => text.includes(`"${set}"`) || text.includes(`${set}::`)) : [];
            if (named.length) faults.push(`${address}${query} names ${named.slice(0, 3).join(', ')}`);
          }
        }
      }
      assert.deepEqual(faults, []);
      assert.ok(answered >= 5, `routes answered: ${answered}`);
    });
  }
});

describe('a grant’s copy of the sheets', () => {
  for (const who of HELD) {
    it(`${who.name}: holds the sets of the functions in reach and of no other`, async () => {
      const body = (await (await call('GET', at(), who.email)).json()) as DdProject;
      const catalog = fieldCatalog();
      const fns = new Set(Object.keys(body.fieldSheets ?? {}).map((id) => catalog.sets.get(id)!.fn).filter((fn) => fn !== 'shared'));
      assert.deepEqual([...fns].filter((fn) => !who.reach.includes(fn)), []);
      for (const fn of who.reach) assert.ok(fns.has(fn), `${fn} is handed over`);
      assert.equal(body.fieldSheets?.['commercial.inventory.buyers'], undefined);
      const parties = (body.fieldSheets?.['shared.parties']?.records ?? []).map((record) => String(record.values.name?.value));
      assert.deepEqual(parties.filter((name) => /Buyer|Cobuyer|Deductee|Ledger/.test(name)), []);
      // A line put off is kept under its line's key, which names the set.
      assert.deepEqual(Object.keys(body.fieldSnoozes ?? {}), who.reach.includes('legal.title') ? ['legal.title.holding::::extent::runs_out'] : []);
    });
  }

  it('keeps a party a tax deduction or a ledger names from a reader the buyers’ own set would not, and hands over the vendor', () => {
    const who = HELD[0]!;
    const grant: ProjectGrant = { id: 'g', tenantId: 't', projectId: project.id, email: who.email, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: who.scopeKeys, areas: [], createdAt: '', createdBy: OWNER };
    const copy = projectView(project, { kind: 'granted', grant, email: who.email }).project;
    const names = (copy.fieldSheets?.['shared.parties']?.records ?? []).map((record) => String(record.values.name?.value));
    assert.ok(names.includes('Zq7 Vendor Works'));
    for (const name of ['Zq7 Buyer Marked', 'Zq7 Cobuyer Named', 'Zq7 Deductee Only', 'Zq7 Ledger Only']) assert.ok(!names.includes(name), name);
  });
});

describe('sheets kept back by a gate', () => {
  it('are said to be withheld, on a project that keeps the bids and the budget as sheets and nowhere else', () => {
    const bare: DdProject = { ...structuredClone(project), budget: undefined, cost: undefined, costReports: undefined, procurement: undefined };
    const who = HELD[1]!;
    const grant: ProjectGrant = { id: 'g', tenantId: 't', projectId: bare.id, email: who.email, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: who.scopeKeys, areas: [], createdAt: '', createdBy: OWNER };
    const view = projectView(bare, { kind: 'granted', grant, email: who.email });
    assert.ok(view.withheld.includes('commercials') && view.withheld.includes('procurement'), view.withheld.join(', '));
    assert.match(withheldAnswer(view, 'What did the bidders quote?')!, /do not have access to the tenders, bidders and bids/);
    const named = projectView(bare, { kind: 'granted', grant: { ...grant, scopeKeys: ['cost_quantity', 'procurement'], areas: ['commercials'] }, email: who.email });
    assert.ok(!named.withheld.includes('commercials') && !named.withheld.includes('procurement'), named.withheld.join(', '));
  });
});

describe('a function’s sheets, written to by somebody working from a grant', () => {
  const write = (email: string, set: string, values: Record<string, unknown>) => call('PUT', at('/fields/values'), email, { set, values });

  it('are refused where the grant’s scope names the function and its gate is shut', async () => {
    const qs = HELD[1]!.email;
    const valuer = HELD[4]!.email;
    assert.equal((await write(qs, 'finance.budget.contingency', { contingency_original: 1 })).status, 404);
    assert.equal((await call('POST', at('/fields/records'), qs, { set: 'procurement.boq.earnest_money', values: { amount: 1 } })).status, 404);
    assert.equal((await call('PUT', at('/fields/situation'), qs, { fn: 'procurement.boq', key: 'anything', on: true })).status, 404);
    assert.equal((await write(valuer, 'finance.valuation.conclusion', { book_value: 1 })).status, 404);
    assert.equal((await call('POST', at('/fields/accept-paper'), valuer, { fn: 'finance.valuation', evidenceId: project.evidence[0]!.id })).status, 404);
    assert.equal(project.fieldSheets!['finance.budget.contingency']!.values.contingency_original!.value, 12_345_678);
    assert.equal(project.fieldSheets!['finance.valuation.conclusion']!.values.book_value!.value, 987_654_321);
  });

  it('are reached once the grant passes the gate: the route gets as far as asking who edits in the department', async () => {
    // Nobody working from a grant is on this project's team list, so the answer is the department's refusal and not "not found".
    const budget = await write(HELD[2]!.email, 'finance.budget.contingency', { contingency_original: 2 });
    assert.notEqual(budget.status, 404);
    const valuation = await write(HELD[5]!.email, 'finance.valuation.conclusion', { book_value: 2 });
    assert.notEqual(valuation.status, 404);
    const bids = await call('POST', at('/fields/records'), HELD[3]!.email, { set: 'procurement.boq.earnest_money', values: { amount: 2 } });
    assert.notEqual(bids.status, 404);
  });
});

describe('the dashboard', () => {
  it('counts the caller’s copy: an advocate is told of the checks of their scope and of no other', async () => {
    const advocate = HELD[0]!;
    const total = (body: { ddProgress: Array<{ checkTotal: number }> }) => body.ddProgress.reduce((sum, row) => sum + row.checkTotal, 0);
    const whole = total((await (await call('GET', at('/dashboard'), OWNER)).json()) as never);
    const theirs = total((await (await call('GET', at('/dashboard'), advocate.email)).json()) as never);
    const copy = (await (await call('GET', at(), advocate.email)).json()) as DdProject;
    assert.equal(theirs, copy.assessments.flatMap((assessment) => assessment.scopes.flatMap((scope) => scope.checks)).length);
    assert.ok(theirs > 0 && theirs < whole, `${theirs} of ${whole}`);
  });
});

describe('a check’s fields', () => {
  it('are read off the caller’s copy: a check outside the grant is not found', async () => {
    const advocate = HELD[0]!;
    const seen = projectView(project, { kind: 'granted', email: advocate.email, grant: { id: 'g', tenantId: 't', projectId: project.id, email: advocate.email, role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: advocate.scopeKeys, areas: [], createdAt: '', createdBy: OWNER } });
    const inside = checkIds.filter((id) => seen.writableCheckIds.has(id));
    const outside = checkIds.filter((id) => !seen.writableCheckIds.has(id));
    assert.ok(inside.length > 0 && outside.length > 0);
    for (const id of inside) assert.equal((await call('GET', at(`/checks/${id}/fields`), advocate.email)).status, 200);
    for (const id of outside) {
      const res = await call('GET', at(`/checks/${id}/fields`), advocate.email);
      assert.equal(res.status, 404, id);
      assert.deepEqual(leaked(advocate, await res.text()), []);
    }
    for (const id of outside) assert.equal((await call('GET', at(`/checks/${id}/fields`), OWNER)).status, 200);
  });
});

describe('the stored graph, for somebody working from a grant', () => {
  const fieldNodes = async (email: string, query: string) => {
    const res = await call('GET', at(`/graph/neighbourhood?query=${query}&hops=3`), email);
    const body = (await res.json()) as { source: string; nodes?: ProjectGraphNode[] };
    return { source: body.source, nodes: (body.nodes ?? []).filter((node) => node.kind === 'field_value') };
  };

  it('carries no field node for a grant that reaches no function, whether or not a record is out of reach', async () => {
    for (const who of [HELD[1]!, HELD[4]!]) {
      for (const query of ['finance', 'lenders', 'budget', 'unit']) assert.deepEqual((await fieldNodes(who.email, query)).nodes.map((node) => node.label), [], `${who.name}: ${query}`);
    }
  });

  it('carries the field nodes their own copy draws, and those only', async () => {
    const reviewer = HELD[7]!;
    const catalog = fieldCatalog();
    let drawn = 0;
    for (const query of ['finance', 'legal', 'budget', 'valuation']) {
      const { nodes } = await fieldNodes(reviewer.email, query);
      drawn += nodes.length;
      for (const node of nodes) {
        const set = catalog.sets.get(node.key!.split('::')[0]!)!;
        const field = set.fields.find((def) => def.key === node.key!.split('::')[2]);
        const owner = field?.addedBy ?? set.fn;
        assert.ok(owner === 'shared' || reviewer.reach.includes(owner), `${node.id} is a field of ${owner}`);
      }
    }
    assert.ok(drawn > 0, 'a reader of every scope is handed field nodes');
  });

  it('says of each field what their own copy says, where the whole file works out another figure', async () => {
    const whole = new Map(((await (await call('GET', at('/graph'), OWNER)).json()) as { nodes: ProjectGraphNode[] }).nodes.map((node) => [node.id, node]));
    let differing = 0;
    for (const who of [HELD[0]!, HELD[2]!, HELD[6]!, HELD[7]!, HELD[8]!]) {
      const own = new Map(((await (await call('GET', at('/graph'), who.email)).json()) as { nodes: ProjectGraphNode[] }).nodes.map((node) => [node.id, node]));
      differing += [...own.values()].filter((node) => node.kind === 'field_value' && whole.get(node.id)?.label !== node.label).length;
      for (const query of ['finance', 'legal', 'budget', 'unit', 'handover', 'title', 'approvals', 'occupancy']) {
        for (const node of (await fieldNodes(who.email, query)).nodes) assert.deepEqual(node, own.get(node.id), `${who.name}: ${node.id}`);
      }
    }
    // The count of units handed over before the certificate is one on the whole file and none on a copy that holds no unit.
    assert.ok(differing > 0, 'a figure in reach is worked out differently on a copy');
    const liaison = await fieldNodes(HELD[8]!.email, 'occupancy');
    const counted = liaison.nodes.find((node) => node.id.endsWith('legal.approvals.occupancy::::handed_before_certificate'));
    assert.equal(liaison.source, 'journal');
    assert.ok(counted, 'the stored neighbourhood reaches the count');
    assert.notEqual(counted.label, whole.get(counted.id)!.label);
  });

  it('is cut the same way for the chat of somebody working from a grant', async () => {
    const res = await call('POST', at('/chat'), HELD[4]!.email, { question: 'What is outstanding per the lender’s statement, and what are the bids and the contingency in the budget?' });
    assert.equal(res.status, 200);
    assert.deepEqual(leaked(HELD[4]!, await res.text()), []);
    const fields = await call('POST', at('/chat'), HELD[0]!.email, { question: 'Show the fields of Finance lenders and of Procurement bids' });
    assert.deepEqual(leaked(HELD[0]!, await fields.text()), []);
  });
});

describe('a report, for somebody working from a grant who holds the Reports area', () => {
  const surveyor = HELD[6]!;
  const budgetHolder = HELD[2]!;
  let own: { id: string };

  it('is made, and answers with their own copy of it', async () => {
    const res = await call('POST', at('/reports'), surveyor.email, { kind: 'executive_dd' });
    assert.equal(res.status, 201);
    own = (await res.json()) as { id: string };
    assert.ok(own.id);
  });

  it('is refused a function’s report whose fields are out of reach, and nothing is written', async () => {
    const before = project.reports.length;
    assert.equal((await call('POST', at('/reports'), surveyor.email, { kind: 'function', template: 'finance.budget.report' })).status, 404);
    assert.equal((await call('POST', at('/reports'), surveyor.email, { kind: 'function', template: 'finance.lenders.report' })).status, 404);
    assert.equal(project.reports.length, before);
    // The holder of the budget makes Budget's report.
    const made = await call('POST', at('/reports'), budgetHolder.email, { kind: 'function', template: 'finance.budget.report' });
    assert.equal(made.status, 201);
  });

  it('is refused a section that reads a field out of reach, a buyers’ set or another department’s addition, before anything is written', async () => {
    const sources = [
      { kind: 'field_table', records: 'commercial.inventory.buyers' },
      { kind: 'fields', addresses: [{ fn: 'finance.lenders', set: 'finance.lenders.position', field: 'outstanding_per_statement' }] },
      { kind: 'fields', addresses: [{ fn: 'shared', set: 'shared.units', field: 'sale_agreed_value' }] },
      { kind: 'field_table', records: 'procurement.boq.evaluations' },
      { kind: 'field_chart', records: 'procurement.boq.earnest_money', x: 'bidder', y: 'amount' },
    ];
    const stored = () => project.reports.find((report) => report.id === own.id)!.body.blocks.length;
    const before = stored();
    for (const source of sources) {
      const res = await call('POST', at(`/reports/${own.id}/blocks`), surveyor.email, { heading: 'x', source });
      assert.equal(res.status, 404, JSON.stringify(source));
      assert.deepEqual(leaked(surveyor, await res.text()), []);
    }
    assert.equal(stored(), before);
    // A section of their own function's fields is added, and one already there is not turned to read another's.
    const mine = await call('POST', at(`/reports/${own.id}/blocks`), surveyor.email, { heading: 'Requests', source: { kind: 'field_table', records: 'commercial.handover.requests' } });
    assert.equal(mine.status, 200);
    const block = ((await mine.json()) as GeneratedReport).body.blocks.at(-1)!;
    for (const source of sources) assert.equal((await call('PUT', at(`/reports/${own.id}/blocks/${block.id}/source`), surveyor.email, { source })).status, 404);
    assert.deepEqual(project.reports.find((report) => report.id === own.id)!.body.blocks.at(-1)!.source, { kind: 'field_table', records: 'commercial.handover.requests' });
  });

  it('is not frozen or issued by them: that is the firm’s, and the report stays as it was', async () => {
    const block = project.reports.find((report) => report.id === own.id)!.body.blocks.at(-1)!;
    assert.equal((await call('POST', at(`/reports/${own.id}/blocks/${block.id}/detach`), surveyor.email)).status, 403);
    const issue = await call('POST', at(`/reports/${own.id}/issue`), surveyor.email, {});
    assert.equal(issue.status, 403);
    assert.deepEqual(leaked(surveyor, await issue.text()), []);
    const stored = project.reports.find((report) => report.id === own.id)!;
    assert.equal(stored.status, 'generated');
    assert.equal(stored.body.blocks.at(-1)!.frozen, undefined);
    // Nor through the chat, which edits a report in the asker's name.
    const standing = () => project.reports.map((report) => `${report.id}:${report.status}:${report.body.blocks.filter((held) => held.detachedAt).length}`);
    const before = standing();
    for (const question of ['Issue the report', 'Detach the Requests section of the report']) {
      const said = await call('POST', at('/chat'), surveyor.email, { question });
      assert.equal(said.status, 200);
      assert.match(await said.text(), /for the firm’s own people/);
    }
    assert.deepEqual(standing(), before);
    // The firm's own person issues it.
    assert.equal((await call('POST', at(`/reports/${own.id}/issue`), OWNER, {})).status, 200);
  });

  it('answers every edit of the firm’s report with their copy of it, never the stored one', async () => {
    const { budget, frozen } = ownerReports;
    // The firm's Budget report holds a buyers' table and a lender's figure beside Budget's own sections.
    const edited = await call('POST', at(`/reports/${budget.id}/blocks`), budgetHolder.email, { heading: 'A note', text: 'Checked against the bills.' });
    assert.equal(edited.status, 200);
    const text = await edited.text();
    assert.deepEqual(leaked(budgetHolder, text), []);
    const seen = JSON.parse(text) as GeneratedReport;
    assert.ok(seen.body.blocks.some((held) => held.heading === 'A note'));
    assert.ok(!seen.body.blocks.some((held) => held.heading === 'Buyers' || held.heading === 'Lenders'));
    // A section cut from their copy is not theirs to edit, move or remove.
    const buyers = project.reports.find((report) => report.id === budget.id)!.body.blocks.find((held) => held.heading === 'Buyers')!;
    assert.equal((await call('PATCH', at(`/reports/${budget.id}/blocks/${buyers.id}`), budgetHolder.email, { heading: 'Mine now' })).status, 404);
    assert.equal((await call('DELETE', at(`/reports/${budget.id}/blocks/${buyers.id}`), budgetHolder.email)).status, 404);
    // What the registers have done since the issued report is told from their copy of both.
    const drift = await call('GET', at(`/reports/${frozen.id}/drift`), budgetHolder.email);
    assert.equal(drift.status, 200);
    assert.deepEqual(leaked(budgetHolder, await drift.text()), []);
  });

  it('holds, once issued, no frozen row of a function out of reach and no row that prints a buyer through a link', async () => {
    const stored = project.reports.find((report) => report.id === ownerReports.frozen.id)!;
    const frozenText = JSON.stringify(stored);
    assert.ok(frozenText.includes('Zq7 Buyer Marked'), 'the stored report froze the buyer’s name, read through a link');
    for (const who of HELD.filter((held) => held.areas.includes('reports'))) {
      const body = (await (await call('GET', at(), who.email)).json()) as DdProject;
      const seen = body.reports.find((report) => report.id === stored.id)!;
      const headings = seen.body.blocks.map((block) => block.heading);
      assert.ok(!headings.includes('Every party'), `${who.name}: a list of parties as it read one day`);
      assert.ok(!headings.includes('Lenders'), `${who.name}: the lender’s figure`);
      assert.ok(!headings.includes('Bids'), `${who.name}: the bids`);
      assert.equal(headings.includes('Contingency'), who.reach.includes('finance.budget'), `${who.name}: Budget’s contingency`);
      assert.ok(!headings.includes('Requests'), `${who.name}: a frozen row that names a buyer`);
      assert.ok(!JSON.stringify(seen).includes('Zq7 Buyer Marked'));
    }
  });
});
