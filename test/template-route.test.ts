/**
 * Filling an empty form, over real HTTP, with sign-in on and a stand-in for
 * the model.
 *
 * `template-fill.test.ts` holds the rules. This holds the wiring and who may
 * do what. Three people sign in: the firm's owner, one of the firm's staff
 * who is only a viewer in Legal on this project, and a consultant working
 * from a grant. The owner takes a form in, reviews it and takes the filled
 * file out; the other two ask every route that changes anything and are
 * refused, and the templates are read back to see that nothing was done.
 *
 * The model is a server here. It is checked for what it was sent (the
 * labels, never the record) and it answers with more than it may: a key, a
 * key that is not on the list, and a value. Only the key is kept, and the
 * value written into the file is the record's own.
 *
 * The firm, the people, the project and the papers are invented.
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { addEvidence, createProject, proposeFacts, setTeamMember, type DdProject, type ProjectGrant } from '@realytica/shared';
import { docxOutline } from '../apps/api/src/documents/docx-outline';
import { zipOf } from '../apps/api/src/documents/zip';

const JWKS_URL = 'https://example.test/jwks-templates';
const ISSUER = 'https://securetoken.google.com/realytica-templates';
const AUDIENCE = 'realytica-templates';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function tokenFor(subject: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ iss: ISSUER, aud: AUDIENCE, sub: subject, email, email_verified: true, iat: now - 5, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(`${header}.${body}`).sign(signer.privateKey);
  return `${header}.${body}.${sig.toString('base64url')}`;
}

function jwkOf(key: KeyObject) {
  return { ...key.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const line = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A form of four blanks: two the rules can read, one only a model can, one nothing answers. */
const FORM = zipOf([
  {
    name: '[Content_Types].xml',
    content:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  },
  {
    name: '_rels/.rels',
    content:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  },
  {
    name: 'word/document.xml',
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${line('Survey number: ______')}${line('Name of the project: ______')}${line('First party to the deed: ______')}${line('Signature of the applicant: ______')}</w:body></w:document>`,
  },
]);

let server: Server;
let model: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;
const asked: string[] = [];

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'stand-in', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function call(method: string, route: string, opts: { token?: string; body?: unknown; file?: { name: string; bytes: Buffer; department?: string } } = {}): Promise<{ status: number; body: any; bytes: Buffer; type: string }> {
  const headers: Record<string, string> = { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) };
  let body: FormData | string | undefined;
  if (opts.file) {
    const form = new FormData();
    form.set('department', opts.file.department ?? 'legal');
    form.set('file', new Blob([new Uint8Array(opts.file.bytes)]), opts.file.name);
    body = form;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await realFetch(`${base}${route}`, { method, headers, body });
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  let parsed: unknown = null;
  if (type.includes('application/json')) parsed = JSON.parse(bytes.toString('utf8') || 'null');
  return { status: res.status, body: parsed, bytes, type };
}

const owner = () => tokenFor('sub-dev', 'dev@builders.example');
const viewer = () => tokenFor('sub-vera', 'vera@builders.example');
const consultant = () => tokenFor('sub-sam', 'sam@site.example');

let project: DdProject;
let at = '';
let templateId = '';

async function kept(): Promise<string> {
  const { loadTemplates } = await import('../apps/api/src/routes/templates');
  return JSON.stringify(await loadTemplates(project.id));
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-templates-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'oidc';
  process.env.REALYTICA_AUTH_ISSUER = ISSUER;
  process.env.REALYTICA_AUTH_AUDIENCE = AUDIENCE;
  process.env.REALYTICA_AUTH_JWKS_URL = JWKS_URL;

  model = createServer(async (req, res) => {
    const sent = await bodyOf(req);
    asked.push(JSON.stringify(sent));
    const content = (sent.messages?.[0]?.content ?? '') as Array<{ text?: string }> | string;
    const text = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('\n');
    const n = Number(/^(\d+)\. First party to the deed/m.exec(text)?.[1] ?? 0);
    const other = Number(/^(\d+)\. Signature of the applicant/m.exec(text)?.[1] ?? 0);
    // A key for the one it can place, with a value it was not asked for; and for the other a key that is on no list.
    streamMessage(res, { blanks: [{ n, key: 'vendor', value: 'Somebody the model made up' }, { n: other, key: 'Somebody the model made up' }] }, String(sent.tools?.[0]?.name ?? ''));
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  process.env.REALYTICA_API_KEY = 'a-key-for-nobody';

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input) === JWKS_URL) return new Response(JSON.stringify({ keys: [jwkOf(signer.publicKey)] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.startsWith('http://127.0.0.1')) return realFetch(input as Parameters<typeof fetch>[0], init);
    throw new Error('this test has no network');
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The owner signs in first and claims the workspace, then brings in the other two.
  assert.equal((await call('GET', '/api/members', { token: owner() })).body.me.role, 'owner');
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'vera@builders.example', role: 'staff' } })).status, 201);
  assert.equal((await call('POST', '/api/members', { token: owner(), body: { email: 'sam@site.example', role: 'collaborator' } })).status, 201);
  assert.equal((await call('GET', '/api/members', { token: viewer() })).status, 200);
  assert.equal((await call('GET', '/api/members', { token: consultant() })).status, 200);

  const { store } = await import('../apps/api/src/store');
  const tenantId = store.data.tenants![0]!.id;
  project = createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba' }, 'RYT-TF1');
  project.tenantId = tenantId;
  // One of the firm's staff edits by default; the team list holds this one to reading in Legal.
  setTeamMember(project, { email: 'vera@builders.example', departments: { legal: 'viewer' } }, 'dev@builders.example');
  const deed = addEvidence(project, { title: 'Sale deed of 2019', kind: 'document', status: 'received' }, 'dev@builders.example');
  deed.documentType = 'Sale deed';
  deed.facts = proposeFacts(
    [],
    [
      { key: 'survey_numbers', label: 'Survey number', value: '73/4', display: '73/4', page: 1, quote: 'land bearing Survey No. 73/4' },
      { key: 'vendor', label: 'Vendor', value: 'Meenakshi Rao', display: 'Meenakshi Rao', page: 1, quote: 'Meenakshi Rao, hereinafter called the Vendor' },
    ],
  );
  store.data.projects!.push(project);
  const grant: ProjectGrant = {
    id: 'grant-sam',
    tenantId,
    projectId: project.id,
    email: 'sam@site.example',
    role: 'contributor',
    allAssessments: true,
    assessmentIds: [],
    allScopes: true,
    scopeKeys: [],
    areas: [],
    createdAt: new Date().toISOString(),
    createdBy: 'dev@builders.example',
  };
  store.data.grants = [grant];
  await store.save();
  at = `/api/projects/${project.id}/templates`;
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const name of ['REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE', 'REALYTICA_AUTH_ISSUER', 'REALYTICA_AUTH_AUDIENCE', 'REALYTICA_AUTH_JWKS_URL', 'REALYTICA_BASE_URL', 'REALYTICA_API_KEY']) delete process.env[name];
  model?.closeAllConnections();
  model?.close();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe('an empty form', () => {
  it('is taken in by somebody who may edit: its blanks found, each offered what the record holds, with its source', async () => {
    const made = await call('POST', at, { token: owner(), file: { name: 'Bank particulars.docx', bytes: FORM } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const { template } = made.body;
    templateId = template.id;
    assert.equal(template.title, 'Bank particulars');
    assert.equal(template.department, 'legal');
    assert.deepEqual(template.summary, { total: 4, written: 0, accepted: 0, typed: 0, blank: 0, offered: 3, noSource: 1 });
    const rows = template.rows as Array<{ field: { label: string; asks?: unknown }; status: string; offers: Array<{ value: string; source: { title: string; page?: number; standing: { state: string } } }> }>;
    assert.deepEqual(
      rows.map((row) => [row.field.label, row.status, row.offers[0]?.value, row.offers[0]?.source.title]),
      [
        ['Survey number', 'offered', '73/4', 'Sale deed'],
        ['Name of the project', 'offered', 'Lake Road offices', 'Project record: project name'],
        ['First party to the deed', 'offered', 'Meenakshi Rao', 'Sale deed'],
        ['Signature of the applicant', 'no_source', undefined, undefined],
      ],
    );
    assert.equal(rows[0]!.offers[0]!.source.page, 1);
  });

  it('has a model say what a blank asks for and nothing more: it is sent the labels and no word of the record, and its value is not kept', async () => {
    assert.equal(asked.length, 1);
    // Only the blanks the rules could not read, and the list of keys.
    assert.ok(asked[0]!.includes('First party to the deed') && asked[0]!.includes('Signature of the applicant'));
    assert.ok(!asked[0]!.includes('1. Survey number') && !asked[0]!.includes('Name of the project'));
    for (const word of ['Meenakshi', '73/4', 'Lake Road', 'RYT-TF1']) assert.ok(!asked[0]!.includes(word), `${word} was sent to the model`);
    const { loadTemplates } = await import('../apps/api/src/routes/templates');
    const [held] = await loadTemplates(project.id);
    assert.deepEqual(held!.fields.map((field) => field.asks), [undefined, undefined, { key: 'vendor', by: 'model' }, undefined]);
    assert.ok(!(await kept()).includes('made up'));
  });

  it('is listed and read by anybody with a place in its department, a viewer among them', async () => {
    for (const token of [owner, viewer]) {
      const list = await call('GET', `${at}?department=legal`, { token: token() });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.templates.map((t: { id: string; rows?: unknown }) => [t.id, t.rows]), [[templateId, undefined]]);
      assert.equal(list.body.model, true);
      assert.equal((await call('GET', `${at}/${templateId}`, { token: token() })).body.template.rows.length, 4);
    }
    assert.deepEqual((await call('GET', `${at}?department=finance`, { token: owner() })).body.templates, []);
    const seen = await call('GET', `${at}/${templateId}`, { token: viewer() });
    assert.deepEqual([seen.body.mayEdit, seen.body.mayDecide], [false, false]);
  });

  /** Every way a template is changed, each as a request that would change this one. */
  const changes = (): Array<{ name: string; method: string; route: string; body?: unknown; file?: { name: string; bytes: Buffer } }> => [
    { name: 'take one in', method: 'POST', route: at, file: { name: 'Another form.docx', bytes: FORM } },
    { name: 'decide its blanks', method: 'PUT', route: `${at}/${templateId}/fields`, body: { decisions: [{ fieldId: 'any', decision: 'blank' }] } },
    { name: 'remove it', method: 'DELETE', route: `${at}/${templateId}` },
  ];

  it('is not changed by a viewer in the department: refused on every route, and nothing is done', async () => {
    const was = await kept();
    for (const { name, method, route, body, file } of changes()) {
      const answer = await call(method, route, { token: viewer(), body, file });
      assert.equal(answer.status, 403, `${name}: ${JSON.stringify(answer.body)}`);
      assert.match(answer.body.error, /in legal/);
      assert.equal(await kept(), was, `${name} left the templates as they were`);
    }
  });

  it('is not there at all for somebody working from a grant: reading and changing alike', async () => {
    const was = await kept();
    const reads = [
      { name: 'list', method: 'GET', route: at },
      { name: 'read one', method: 'GET', route: `${at}/${templateId}` },
      { name: 'the filled file', method: 'GET', route: `${at}/${templateId}/file?kind=filled` },
      { name: 'the sources', method: 'GET', route: `${at}/${templateId}/file?kind=sources` },
      { name: 'the original', method: 'GET', route: `${at}/${templateId}/file?kind=original` },
    ];
    for (const { name, method, route, body, file } of [...reads, ...changes()] as Array<{ name: string; method: string; route: string; body?: unknown; file?: { name: string; bytes: Buffer } }>) {
      const answer = await call(method, route, { token: consultant(), body, file });
      assert.ok(answer.status === 403 || answer.status === 404, `${name}: ${answer.status}`);
      assert.ok(!answer.bytes.toString('utf8').includes('Meenakshi') && !answer.bytes.includes(Buffer.from('word/document.xml')), `${name} handed nothing over`);
      assert.equal(await kept(), was, `${name} left the templates as they were`);
    }
  });

  it('is not there for nobody signed in', async () => {
    for (const { name, method, route, body, file } of changes()) assert.equal((await call(method, route, { body, file })).status, 401, name);
    assert.equal((await call('GET', at)).status, 401);
  });

  it('refuses what is not a template, what is too large once unpacked, and a decision it cannot read', async () => {
    assert.equal((await call('POST', at, { token: owner(), file: { name: 'form.pdf', bytes: Buffer.from('%PDF-1.4') } })).status, 400);
    assert.equal((await call('POST', at, { token: owner(), file: { name: 'form.docx', bytes: FORM, department: 'nowhere' } })).status, 400);
    const bomb = zipOf([{ name: 'word/document.xml', content: Buffer.alloc(9 * 1024 * 1024, 0x20) }]);
    const refused = await call('POST', at, { token: owner(), file: { name: 'form.docx', bytes: bomb } });
    assert.equal(refused.status, 413);
    assert.match(refused.body.error, /too large to open as a template/);
    const empty = zipOf([{ name: 'word/document.xml', content: `<w:document ${W}><w:body>${line('Nothing to fill in here.')}</w:body></w:document>` }]);
    assert.match((await call('POST', at, { token: owner(), file: { name: 'letter.docx', bytes: empty } })).body.error, /No blanks were found/);
    for (const body of [{}, { decisions: [] }, { decisions: [{ fieldId: 'x', decision: 'invent' }] }, { decisions: [{ fieldId: 'x', decision: 'type', value: '   ' }] }, { decisions: Array.from({ length: 201 }, () => ({ fieldId: 'x', decision: 'blank' })) }]) {
      assert.equal((await call('PUT', `${at}/${templateId}/fields`, { token: owner(), body })).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await call('PUT', `${at}/${templateId}/fields`, { token: owner(), body: { decisions: [{ fieldId: 'f_nobody', decision: 'blank' }] } })).status, 400);
    assert.equal((await call('GET', `${at}/tpl_nobody`, { token: owner() })).status, 404);
    assert.equal((await call('GET', `${at}/${templateId}/file?kind=everything`, { token: owner() })).status, 400);
    assert.equal(JSON.parse(await kept()).length, 1);
  });

  it('goes back as the same file with only what a person accepted or typed, and a list of its sources', async () => {
    const read = await call('GET', `${at}/${templateId}`, { token: owner() });
    const [survey, name, party, signature] = (read.body.template.rows as Array<{ field: { id: string } }>).map((row) => row.field.id);
    // Before anybody decides, the filled file is the form as it was sent.
    const untouched = await call('GET', `${at}/${templateId}/file?kind=filled`, { token: owner() });
    assert.deepEqual(docxOutline(untouched.bytes).map((l) => l.text), ['Survey number: ______', 'Name of the project: ______', 'First party to the deed: ______', 'Signature of the applicant: ______']);

    const decided = await call('PUT', `${at}/${templateId}/fields`, {
      token: owner(),
      body: { decisions: [{ fieldId: survey, decision: 'accept' }, { fieldId: party, decision: 'accept' }, { fieldId: signature, decision: 'type', value: 'D. Example, for the owner' }] },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.deepEqual(decided.body.template.summary, { total: 4, written: 3, accepted: 2, typed: 1, blank: 0, offered: 1, noSource: 0 });
    const accepted = decided.body.template.rows[0].field;
    assert.deepEqual([accepted.decision, accepted.value, accepted.decidedBy, accepted.source.title, accepted.source.page], ['accepted', '73/4', 'dev@builders.example', 'Sale deed', 1]);
    // Nothing on the record answers the signature: it cannot be accepted, only typed or left.
    const cannot = await call('PUT', `${at}/${templateId}/fields`, { token: owner(), body: { decisions: [{ fieldId: signature, decision: 'accept' }] } });
    assert.equal(cannot.status, 400);

    const filled = await call('GET', `${at}/${templateId}/file?kind=filled`, { token: owner() });
    assert.equal(filled.status, 200);
    assert.match(filled.type, /wordprocessingml/);
    // The project's name was offered and nobody accepted it: its blank goes back empty.
    assert.deepEqual(docxOutline(filled.bytes).map((l) => l.text), ['Survey number: 73/4', 'Name of the project: ______', 'First party to the deed: Meenakshi Rao', 'Signature of the applicant: D. Example, for the owner']);
    void name;

    const sources = await call('GET', `${at}/${templateId}/file?kind=sources`, { token: owner() });
    assert.equal(sources.status, 200);
    assert.match(sources.type, /application\/pdf/);
    assert.equal(sources.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    const original = await call('GET', `${at}/${templateId}/file?kind=original`, { token: owner() });
    assert.ok(original.bytes.equals(FORM), 'the file as it was sent is kept unchanged');
    // A viewer in the department may take the files out, as they may a questionnaire's.
    assert.equal((await call('GET', `${at}/${templateId}/file?kind=sources`, { token: viewer() })).status, 200);

    const { store } = await import('../apps/api/src/store');
    const trail = store.data.projects!.find((p) => p.id === project.id)!.audit.filter((event) => event.entityType === 'template').map((event) => [event.action, event.actor]);
    for (const action of ['template_added', 'template_decided', 'template_filled']) assert.ok(trail.some(([did, who]) => did === action && who === 'dev@builders.example'), action);
  });

  it('is removed by a lead or signer, and its file with it', async () => {
    assert.equal((await call('DELETE', `${at}/${templateId}`, { token: owner() })).status, 200);
    assert.equal((await call('GET', `${at}/${templateId}`, { token: owner() })).status, 404);
    assert.deepEqual((await call('GET', at, { token: owner() })).body.templates, []);
    const { storageAdapter } = await import('../apps/api/src/storage');
    assert.equal(await storageAdapter.getDocument(project.id, `fill-template-${templateId}.docx`), null);
  });
});

describe('with no model set up', () => {
  it('a form is taken in all the same, its blanks read by rule alone', async () => {
    const keptEnv = { url: process.env.REALYTICA_BASE_URL, key: process.env.REALYTICA_API_KEY };
    delete process.env.REALYTICA_BASE_URL;
    delete process.env.REALYTICA_API_KEY;
    try {
      const before = asked.length;
      const made = await call('POST', at, { token: owner(), file: { name: 'Bank particulars.docx', bytes: FORM } });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      assert.equal(made.body.model, false);
      assert.equal(asked.length, before);
      assert.deepEqual(made.body.template.summary, { total: 4, written: 0, accepted: 0, typed: 0, blank: 0, offered: 2, noSource: 2 });
    } finally {
      process.env.REALYTICA_BASE_URL = keptEnv.url;
      process.env.REALYTICA_API_KEY = keptEnv.key;
    }
  });
});
