/**
 * Law and policy watch: looking at a firm's listed pages, and keeping what
 * was found.
 *
 * The rules are in the shared package (`law-watch.ts`). This is the part
 * that reaches outside: it fetches a page, turns it into words, keeps the
 * words, and where they differ from the last look keeps both and the
 * difference as a change waiting on a person.
 *
 * A look is polite. It asks the site's robots.txt first and keeps off a path
 * the site disallows; it makes one request for the page, under a name that
 * says what it is; it gives up after twenty seconds; and it reads at most
 * three megabytes. Where a page answers with a redirect, each address on the
 * way is checked like the first (`assertReachable`), and no more than three
 * are followed. A PDF is read by the same reader the reference shelf uses.
 *
 * A look that reads nothing says why on the source and changes nothing else:
 * the words last read stay as they were, so a site that was down for a day
 * is not a change the day it comes back.
 *
 * What is kept sits beside the firm's other documents, under the firm's own
 * id, and not in the store's core document: a page's words run to hundreds
 * of kilobytes, and that document is read on every request. A firm that has
 * kept nothing is shown the list every firm starts with, and nothing is
 * written for it until a look or a person changes something.
 *
 * Two looks at once, on two instances, each write the whole list, and the
 * later write stands. The timer runs once a day and a second run finds
 * nothing due, so the window is a person pressing "Look now" while the timer
 * is mid-run.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  LAW_TEXT_AT_MOST,
  STAGES,
  keepLawChange,
  lawBearsOn,
  lawDepartmentsOn,
  lawPageText,
  lawProposalHeld,
  lawSourceDue,
  lawTextDiff,
  lawWatchHeld,
  robotsDisallows,
  seededLawWatch,
  stageOf,
  type DdProject,
  type LawChange,
  type LawSource,
  type LawWatchState,
} from '@realytica/shared';
import { lawWatchModelSetUp, proposeLawChangeByModel, readEnv } from '@realytica/agents';
import { assertReachable } from './flows/outbound';
import { storageAdapter } from './storage';
import { store } from './store';
import { withPrincipal } from './auth/current';

/** What the reader calls itself to a site, and the name a robots.txt would address it by. */
export const LAW_WATCH_AGENT = 'RealyticaLawWatch';
const FETCH_MS = 20_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_HOPS = 3;
/** Fewer words than this is a page that gave nothing to read: a shell that draws itself in the browser, or a block page. */
const WORDS_AT_LEAST = 80;

function userAgent(): string {
  const home = readEnv('APP_URL');
  return `${LAW_WATCH_AGENT}/1.0 (${home ? `+${home}; ` : ''}reads listed official pages, one request a look)`;
}

/** What a look reaches the outside through: the network and the PDF reader, or stand-ins under test. */
export interface LawLookDeps {
  fetch: typeof fetch;
  /** Refuses an address inside the deployment's own network. Throws with the reason. */
  reachable: (url: string) => Promise<unknown>;
  pdfText: (bytes: Uint8Array) => Promise<string>;
  /** A model's reading of a change, or null. Absent: no model is asked. */
  propose?: typeof proposeLawChangeByModel;
}

const real: LawLookDeps = {
  fetch: (input, init) => fetch(input, init),
  reachable: (url) => assertReachable(url),
  pdfText: async (bytes) => (await import('./reference/shelf-cache')).extractPdfText(bytes),
};

/* ==================================================================== */
/* What is kept                                                          */
/* ==================================================================== */

const folder = (tenantId: string): string => `law-watch-${tenantId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
const STATE_KEY = 'state.json';
const pageKey = (sourceId: string): string => `page-${sourceId}.txt`;
const beforeKey = (changeId: string): string => `change-${changeId}-before.txt`;
const afterKey = (changeId: string): string => `change-${changeId}-after.txt`;

/** The firm's list as it is kept, or the list every firm starts with. */
export async function loadLawWatch(tenantId: string): Promise<LawWatchState> {
  const bytes = await storageAdapter.getDocument(folder(tenantId), STATE_KEY);
  let kept: unknown;
  try {
    kept = bytes ? JSON.parse(bytes.toString('utf-8')) : undefined;
  } catch {
    kept = undefined;
  }
  return lawWatchHeld(kept) ?? seededLawWatch(new Date().toISOString());
}

export async function saveLawWatch(tenantId: string, state: LawWatchState): Promise<void> {
  await storageAdapter.putDocument(folder(tenantId), STATE_KEY, Buffer.from(JSON.stringify(state)), 'application/json');
}

/** The page as it read before a change and after it. */
export async function lawChangePages(tenantId: string, changeId: string): Promise<{ before: string; after: string }> {
  const [before, after] = await Promise.all([storageAdapter.getDocument(folder(tenantId), beforeKey(changeId)), storageAdapter.getDocument(folder(tenantId), afterKey(changeId))]);
  return { before: before?.toString('utf-8') ?? '', after: after?.toString('utf-8') ?? '' };
}

/** Let go of what was kept for a source that is off the list. */
export async function forgetLawSource(tenantId: string, sourceId: string): Promise<void> {
  await storageAdapter.deleteDocument(folder(tenantId), pageKey(sourceId));
}

/* ==================================================================== */
/* One look                                                              */
/* ==================================================================== */

/** A look that read nothing, with the reason as a person is shown it. */
export class LawLookFailed extends Error {}

async function bodyWithin(res: Response, most: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > most) throw new LawLookFailed(`The page is larger than ${Math.round(most / 1024 / 1024)} MB, so it was not read.`);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > most) {
      await reader.cancel();
      throw new LawLookFailed(`The page is larger than ${Math.round(most / 1024 / 1024)} MB, so it was not read.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** The site's robots.txt, or nothing where it has none that answers. Asked once a site in a run. */
async function robotsOf(origin: string, deps: LawLookDeps, seen: Map<string, string>): Promise<string> {
  const held = seen.get(origin);
  if (held !== undefined) return held;
  let text = '';
  try {
    await deps.reachable(`${origin}/robots.txt`);
    const res = await deps.fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': userAgent(), Accept: 'text/plain' }, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
    if (res.status === 200 && /text\/plain/i.test(res.headers.get('content-type') ?? 'text/plain')) text = new TextDecoder().decode(await bodyWithin(res, 512 * 1024));
    else await res.body?.cancel();
  } catch {
    // A site with no robots.txt that answers has asked nothing of its readers.
    text = '';
  }
  seen.set(origin, text);
  return text;
}

/**
 * Read one page as plain words. Throws `LawLookFailed` with the reason where
 * it could not: the site disallows it, did not answer, answered with an
 * error, sent too much, or sent nothing to read.
 */
export async function readLawPage(address: string, deps: LawLookDeps = real, robots = new Map<string, string>()): Promise<string> {
  let url = address;
  for (let hop = 0; ; hop += 1) {
    let at: URL;
    try {
      at = new URL(url);
    } catch {
      throw new LawLookFailed('The address is not a web address.');
    }
    if (at.protocol !== 'https:') throw new LawLookFailed('The page moved to an address that is not https, which is not followed.');
    try {
      await deps.reachable(url);
    } catch (err) {
      throw new LawLookFailed(err instanceof Error ? err.message : 'The address cannot be reached from here.');
    }
    if (robotsDisallows(await robotsOf(at.origin, deps, robots), LAW_WATCH_AGENT, `${at.pathname}${at.search}`)) {
      throw new LawLookFailed(`${at.host} asks automated readers to keep off this page (robots.txt), so it was not read.`);
    }
    let res: Response;
    try {
      res = await deps.fetch(url, { headers: { 'User-Agent': userAgent(), Accept: 'text/html,application/pdf,text/plain;q=0.9' }, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      throw new LawLookFailed(name === 'TimeoutError' || name === 'AbortError' ? `${at.host} did not answer in ${FETCH_MS / 1000} seconds.` : `${at.host} could not be reached.`);
    }
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get('location');
      await res.body?.cancel();
      if (!to || hop >= MAX_HOPS) throw new LawLookFailed('The page keeps moving to another address, so it was not read.');
      url = new URL(to, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new LawLookFailed(`${at.host} answered ${res.status}.`);
    }
    const kind = (res.headers.get('content-type') ?? '').toLowerCase();
    const bytes = await bodyWithin(res, MAX_BYTES);
    const isPdf = kind.includes('pdf') || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
    let text: string;
    if (isPdf) {
      try {
        text = lawPageText(await deps.pdfText(bytes), 'text');
      } catch {
        throw new LawLookFailed('The PDF could not be read.');
      }
    } else if (!kind || /html|xml|text\/plain/.test(kind)) {
      text = lawPageText(new TextDecoder('utf-8').decode(bytes), /text\/plain/.test(kind) ? 'text' : 'html');
    } else {
      throw new LawLookFailed(`The page is ${kind.split(';')[0]}, which is not read.`);
    }
    if (text.length < WORDS_AT_LEAST) throw new LawLookFailed('The page gave no words to read. It may draw itself in a browser, or need a sign-in.');
    return text.slice(0, LAW_TEXT_AT_MOST);
  }
}

export interface LawLook {
  outcome: 'first' | 'same' | 'changed' | 'failed';
  change?: LawChange;
}

/** A project as a model is told of it. */
function told(project: DdProject, source: LawSource) {
  return {
    id: project.id,
    name: project.name,
    kind: project.type.replace(/_/g, ' '),
    stage: STAGES.find((stage) => stage.key === stageOf(project.currentStage))?.label ?? '',
    place: [project.city, project.jurisdiction].filter(Boolean).join(', '),
    departments: lawDepartmentsOn(source, project),
  };
}

/**
 * Look at one source now, and write on the list what was found: a first
 * reading, the same words, a change, or why nothing was read. The list is
 * changed in place; the caller saves it.
 */
export async function lookAtLawSource(tenantId: string, state: LawWatchState, source: LawSource, now: Date, deps: LawLookDeps = real, robots = new Map<string, string>()): Promise<LawLook> {
  const at = now.toISOString();
  source.lastLookAt = at;
  let text: string;
  try {
    text = await readLawPage(source.url, deps, robots);
  } catch (err) {
    source.lastError = err instanceof LawLookFailed ? err.message : 'The page could not be read.';
    if (!(err instanceof LawLookFailed)) console.warn(`[law-watch] ${source.id}: ${(err as Error).message}`);
    return { outcome: 'failed' };
  }
  delete source.lastError;
  source.lastReadAt = at;
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash === source.hash) return { outcome: 'same' };
  const before = source.hash ? ((await storageAdapter.getDocument(folder(tenantId), pageKey(source.id)))?.toString('utf-8') ?? null) : null;
  await storageAdapter.putDocument(folder(tenantId), pageKey(source.id), Buffer.from(text), 'text/plain');
  source.hash = hash;
  // The first reading, or one whose earlier words are gone, is where watching starts. There is nothing to compare it with.
  if (before === null) return { outcome: 'first' };
  const diff = lawTextDiff(before, text);
  if (!diff.addedCount && !diff.removedCount) return { outcome: 'same' };
  const change: LawChange = { id: randomUUID(), sourceId: source.id, sourceTitle: source.title, url: source.url, seenAt: at, diff, state: 'waiting' };
  await storageAdapter.putDocument(folder(tenantId), beforeKey(change.id), Buffer.from(before), 'text/plain');
  await storageAdapter.putDocument(folder(tenantId), afterKey(change.id), Buffer.from(text), 'text/plain');
  if (deps.propose) {
    const bootstrap = store.data.tenants?.[0]?.id;
    const projects = (store.data.projects ?? []).filter((project) => (project.tenantId ?? bootstrap) === tenantId && lawBearsOn(source, project));
    const said = await deps.propose({ title: source.title, governs: source.governs, jurisdiction: source.jurisdiction, added: diff.added, removed: diff.removed, projects: projects.map((project) => told(project, source)) });
    const proposal = lawProposalHeld(said, diff, source, projects, at);
    if (proposal) change.proposal = proposal;
  }
  source.lastChangeAt = at;
  keepLawChange(state, change);
  return { outcome: 'changed', change };
}

export interface LawRun {
  looked: number;
  changed: number;
  failed: number;
}

/**
 * Look at every source of one firm that is due (or the one named, due or
 * not), and save the list. A firm with nothing due is not written.
 */
export async function lookAtLawSources(tenantId: string, now: Date, opts: { only?: string; deps?: Partial<LawLookDeps> } = {}): Promise<LawRun & { state: LawWatchState }> {
  const deps: LawLookDeps = { ...real, ...(lawWatchModelSetUp() ? { propose: proposeLawChangeByModel } : {}), ...opts.deps };
  const state = await loadLawWatch(tenantId);
  const run: LawRun = { looked: 0, changed: 0, failed: 0 };
  const robots = new Map<string, string>();
  // A model call made here is the firm's, though nobody is signed in: it is put on the firm's bill and no other.
  await withPrincipal({ subject: 'law-watch', email: 'law-watch', tenantId, role: 'viewer' }, async () => {
    for (const source of state.sources) {
      if (opts.only ? source.id !== opts.only : !lawSourceDue(source, now)) continue;
      const look = await lookAtLawSource(tenantId, state, source, now, deps, robots);
      run.looked += 1;
      if (look.outcome === 'changed') run.changed += 1;
      if (look.outcome === 'failed') run.failed += 1;
    }
  });
  if (run.looked) await saveLawWatch(tenantId, state);
  return { ...run, state };
}
