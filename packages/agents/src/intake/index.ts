/**
 * Conversational intake — the front door.
 *
 * Read in this order:
 *
 *  - `fields.ts`   — the particulars the intake can hold, and the wall that
 *                    stops anything else entering a draft.
 *  - `readout.ts`  — everything derived from a draft: what to ask next, which
 *                    documents bear on it, and the live preview screen. No
 *                    model involved anywhere in this file, on purpose.
 *  - `script.ts`   — the same conversation without a model, which is what runs
 *                    on a deployment with no credentials.
 *  - `tools.ts`    — the two tools the agent gets. Neither commits anything.
 *  - `agent.ts`    — one turn: the model reads prose and writes the reply, and
 *                    decides nothing else.
 *  - `commit.ts`   — draft to case, on the user's press and not the model's.
 */

export { INTAKE_FIELDS, draftIdentity, fieldSpec, valueOf } from './fields';
export type { IntakeFieldSpec } from './fields';

export { documentRequests, particularGaps, previewScreen, readDraft, resolveLocality } from './readout';

export { commitDraft } from './commit';
export type { CommitReady, CommitRefusal } from './commit';
