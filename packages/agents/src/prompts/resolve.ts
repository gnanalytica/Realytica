/**
 * Turning a prompt key into the exact bytes sent to a model, and a record of
 * which text that was.
 *
 * ## Why the record matters more than the text
 *
 * "The extraction got worse last Tuesday" is unanswerable the moment anyone
 * can edit a prompt, unless every run says which version it used. So
 * resolution never returns a string on its own: it returns the rendered
 * content *and* a `PromptUsage` carrying the version id, the version number,
 * the content digest and — the part that exists because of this feature's one
 * real hazard — the ids of any guardrails the version in force did not
 * satisfy. A run produced under a preamble that dropped the never-invent rule
 * must not look identical to one produced under the shipped rules.
 *
 * Composition is recorded too. An agent prompt that composes `{{grounding}}`
 * yields two usages, the grounding one first, so a run whose agent prompt is
 * untouched but whose *shared preamble* was edited still says so.
 *
 * ## Cache stability
 *
 * `providers/anthropic.ts` places a cache breakpoint on the system block, and
 * `retrieval/segments.ts` is built around a byte-stable prefix. Both are worth
 * real money and neither degrades loudly — a prefix that differs by one byte
 * just quietly stops hitting the cache and gets re-billed.
 *
 * Resolution is therefore deterministic by construction: for a given (version,
 * variables) it emits the same bytes every time. The rendering is a single
 * left-to-right scan of the content, substituting each `{{name}}` from the
 * supplied map. Nothing in the path reads a clock, a random source, an
 * environment variable *during rendering*, or iterates an object's keys in a
 * way that could reorder output. The only inputs are the version's content and
 * the variable values, and the only way the bytes change is if one of those
 * does — which is exactly when they should. The accompanying harness proves
 * this by resolving the whole catalogue repeatedly and comparing digests.
 *
 * ## Selection
 *
 * Which version is in force follows the same discipline as `../routing.ts`:
 *
 *   1. `REALYTICA_PROMPT_<KEY>`  — this one prompt, anywhere
 *   2. the store's active selection
 *   3. the built-in
 *
 * and, as there, a bad value is ignored with a one-time warning naming exactly
 * what was dropped rather than thrown. A typo in a deployment variable must
 * not take the agent layer down, and the fallback direction is the safe one:
 * an unrecognised override lands on the shipped text.
 */

import type { AgentKind, PromptDescriptor, PromptUsage, PromptVersion } from '@realytica/shared';
import { warnOnce } from '../client';
import { brokenInvariantIds, SHARED_GROUNDING_KEY } from './invariants';
import { promptKeyFor } from './registry';
import { InMemoryPromptStore, type PromptStore } from './store';

/* ==================================================================== */
/* The ambient store                                                     */
/* ==================================================================== */

let ambientStore: PromptStore | null = null;

/**
 * Install the store the agents resolve against.
 *
 * Called once by the app during start-up with a `PersistedPromptStore` over its
 * `StorageAdapter`. Left uncalled — a script, a test, a deployment that has not
 * wired prompt persistence — the agents fall back to an in-memory store, which
 * means every prompt resolves to its built-in. That is the right default: the
 * built-in is the text the evaluation gate was run against.
 */
export function setPromptStore(store: PromptStore | null): void {
  ambientStore = store;
}

export function getPromptStore(): PromptStore {
  if (!ambientStore) ambientStore = new InMemoryPromptStore();
  return ambientStore;
}

/* ==================================================================== */
/* Rendering                                                             */
/* ==================================================================== */

/** `{{name}}`. Deliberately narrow: no expressions, no nesting, no defaults. */
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

/**
 * A prompt could not be rendered.
 *
 * Thrown rather than papered over. A declared variable with no value is a
 * call site out of step with the catalogue — a code bug, not an operator
 * mistake — and rendering a blank where a case fact belongs produces an answer
 * that is vague for no visible reason. That failure looks like a model
 * problem, and people spend a day on the wrong layer before finding it.
 */
export class PromptRenderError extends Error {
  constructor(
    readonly promptKey: string,
    readonly variable: string,
  ) {
    super(
      `prompts: "${promptKey}" declares {{${variable}}} but no value was supplied. ` +
        'Rendering it blank would put a hole where a case fact belongs, so the call is refused instead.',
    );
    this.name = 'PromptRenderError';
  }
}

/**
 * Substitute `{{name}}` placeholders.
 *
 * Two different kinds of unknown, handled two different ways on purpose:
 *
 * - A placeholder the descriptor **declares** and the caller did not supply
 *   throws. Only code fills these, so it can only be a code bug.
 * - A placeholder the descriptor does **not** declare — one an operator
 *   invented while editing — is left in the text verbatim and warned about
 *   once. Throwing would let a typo in an edited prompt take an agent down,
 *   which is precisely the failure mode `../routing.ts` refuses to allow; and
 *   leaving the literal `{{whatever}}` in place is visible to anyone reading
 *   the prompt, rather than a silent blank.
 */
export function renderPromptTemplate(
  promptKey: string,
  content: string,
  declared: readonly string[],
  variables: Record<string, string>,
): string {
  const declaredSet = new Set(declared);
  return content.replace(PLACEHOLDER, (match, name: string) => {
    const supplied = variables[name];
    if (supplied !== undefined) return supplied;
    if (declaredSet.has(name)) throw new PromptRenderError(promptKey, name);
    warnOnce(
      `prompt-placeholder:${promptKey}:${name}`,
      `Prompt "${promptKey}" contains {{${name}}}, which it does not declare as a variable — leaving it in the text as written. Remove it from the prompt, or the model will read it literally.`,
    );
    return match;
  });
}

/* ==================================================================== */
/* Selection                                                             */
/* ==================================================================== */

/** `document_intelligence.system` -> `REALYTICA_PROMPT_DOCUMENT_INTELLIGENCE_SYSTEM`. */
export function promptEnvVar(key: string): string {
  return `REALYTICA_PROMPT_${key.replace(/\./g, '_').toUpperCase()}`;
}

export type PromptSelectionSource = 'prompt_env' | 'store' | 'built_in';

export interface PromptSelection {
  version: PromptVersion;
  source: PromptSelectionSource;
}

/**
 * Which version is in force for a descriptor.
 *
 * The environment variable names either a version id (`pv-critic-system-3`) or
 * a bare version number (`3`). Both spellings exist because both are what
 * somebody will actually type: the id is what the UI shows, the number is what
 * a person remembers.
 *
 * An unrecognised value is dropped with a one-time warning that names the
 * variable, the value and what was used instead — the same treatment
 * `readRoute` gives a malformed route, and for the same reason: the one time a
 * deployment typo matters is during an incident, and a process that refused to
 * start would have made that incident worse.
 */
export function selectPromptVersion(descriptor: PromptDescriptor): PromptSelection {
  const builtIn = descriptor.versions.find(v => v.builtIn) ?? descriptor.versions[0];

  const envName = promptEnvVar(descriptor.key);
  const raw = process.env[envName];
  if (raw && raw.trim().length > 0) {
    const wanted = raw.trim();
    const byId = descriptor.versions.find(v => v.id === wanted);
    if (byId) return { version: byId, source: 'prompt_env' };
    const byNumber = /^\d+$/.test(wanted)
      ? descriptor.versions.find(v => v.version === Number(wanted))
      : undefined;
    if (byNumber) return { version: byNumber, source: 'prompt_env' };
    warnOnce(
      `prompt-env:${envName}:${wanted}`,
      `Ignoring ${envName}="${wanted}" — no version of "${descriptor.key}" has that id or number. ` +
        `Known: ${descriptor.versions.map(v => `${v.version} (${v.id})`).join(', ')}. Using the stored selection instead.`,
    );
  }

  const active = descriptor.versions.find(v => v.id === descriptor.activeVersionId);
  if (active) return { version: active, source: active.builtIn ? 'built_in' : 'store' };
  return { version: builtIn, source: 'built_in' };
}

/* ==================================================================== */
/* Resolution                                                            */
/* ==================================================================== */

export interface ResolvedPrompt {
  key: string;
  /** The exact bytes to send. */
  content: string;
  version: PromptVersion;
  /** Where the version came from. Not persisted on the run; useful in a step log. */
  source: PromptSelectionSource;
  /** This prompt's own usage record. */
  usage: PromptUsage;
  /**
   * Everything to put on `AgentRun.prompts`: composed dependencies first, then
   * this prompt. An agent that composes the shared preamble gets two entries,
   * so an edit to either one is attributable.
   */
  usages: PromptUsage[];
}

function usageOf(version: PromptVersion): PromptUsage {
  return {
    promptKey: version.promptKey,
    versionId: version.id,
    version: version.version,
    contentHash: version.contentHash,
    invariantsBroken: brokenInvariantIds(version.invariants),
  };
}

export interface ResolvePromptOptions {
  /** Resolve against a specific store rather than the ambient one. */
  store?: PromptStore;
}

/** The variable name an agent prompt composes the shared preamble through. */
export const GROUNDING_VARIABLE = 'grounding';

/**
 * Render a prompt and record what was used.
 *
 * Composition is automatic and one level deep: a descriptor that declares
 * `grounding` and is not given one resolves `shared.grounding` in its own
 * right and substitutes the result. That is exactly what the shipped code did
 * with the `GROUNDING_RULES` constant, kept as composition rather than
 * flattened into each prompt's text, so the preamble is stored once, versioned
 * once and edited once.
 */
export async function resolvePrompt(
  key: string,
  variables: Record<string, string> = {},
  options: ResolvePromptOptions = {},
): Promise<ResolvedPrompt> {
  const store = options.store ?? getPromptStore();
  const descriptor = await store.descriptor(key);
  if (!descriptor) {
    throw new Error(`prompts: unknown prompt key "${key}" — it is not in the built-in catalogue.`);
  }

  const { version, source } = selectPromptVersion(descriptor);

  const values: Record<string, string> = { ...variables };
  const composed: PromptUsage[] = [];

  // One level, and only for the shared preamble. Arbitrary prompt-composes-
  // prompt would need cycle detection and would let an operator build a graph
  // nobody can reason about; the product has exactly one shared fragment and
  // this is it.
  //
  // Gated on the placeholder actually being in the *content*, not merely on
  // the descriptor declaring it. An operator who deletes `{{grounding}}` from
  // an agent prompt has run that agent with no preamble, and the run must say
  // so: recording a grounding version that never reached the model would read
  // as though the rules were in force. The deletion is not silent either — it
  // fails that prompt's own `variable.grounding` check, and the break travels
  // on the usage below.
  const composesGrounding =
    descriptor.variables.includes(GROUNDING_VARIABLE) &&
    values[GROUNDING_VARIABLE] === undefined &&
    version.content.includes(`{{${GROUNDING_VARIABLE}}}`);
  if (composesGrounding) {
    const grounding = await resolvePrompt(SHARED_GROUNDING_KEY, {}, options);
    values[GROUNDING_VARIABLE] = grounding.content;
    composed.push(...grounding.usages);
  }

  const content = renderPromptTemplate(key, version.content, descriptor.variables, values);
  const usage = usageOf(version);
  return { key, content, version, source, usage, usages: [...composed, usage] };
}

/** `resolvePrompt` for an agent's own system prompt. The common call. */
export function resolveAgentSystemPrompt(
  agent: AgentKind,
  variables: Record<string, string> = {},
  options: ResolvePromptOptions = {},
): Promise<ResolvedPrompt> {
  return resolvePrompt(promptKeyFor(agent, 'system'), variables, options);
}
