/**
 * Prompt registry, versioning and resolution.
 *
 * The whole surface is re-exported through `../context`, which the package
 * index already re-exports, so the API layer reaches it as
 * `import { resolvePrompt, PersistedPromptStore } from '@valytica/agents'`
 * rather than by deep import path — the same rule the rest of the package
 * follows, and the reason its internal layout can move without breaking
 * callers.
 *
 * Read the files in this order:
 *
 * - `registry.ts`   — the built-in catalogue: what prompts exist and what
 *                     shipped as version 1 of each. Byte-identical to the
 *                     strings the agents used to hold inline.
 * - `invariants.ts` — the guardrails a version is checked against, and an
 *                     honest account of what that checking can and cannot see.
 * - `store.ts`      — versions and the active selection, over an injected
 *                     `{load, save}` port.
 * - `resolve.ts`    — key plus variables to exact bytes, plus the `PromptUsage`
 *                     that ties a run to the text that produced it.
 */

export * from './registry';
export * from './invariants';
export * from './store';
export * from './resolve';
