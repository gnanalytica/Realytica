import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import type { PromptDescriptor } from '@valytica/shared';
import { promptStore } from '../prompts';

/**
 * The prompt registry as an editable resource.
 *
 * Every response is the whole `PromptDescriptor` for the affected key rather
 * than the version that was touched. The client's job on this page is to draw
 * "which text is in force and what does it give up", and that is a property of
 * the descriptor: a create can change the active selection, a delete can fall
 * the prompt back to its built-in. Returning the version alone would leave the
 * caller to re-derive state it cannot see, or refetch — and a UI that refetches
 * after every edit will eventually show a stale answer for one frame.
 */
export const promptsRouter = Router();

const draftSchema = z.object({
  label: z.string().max(200).default(''),
  content: z.string().min(1, 'A prompt version needs content.').max(200_000),
  notes: z.string().max(4_000).optional(),
  activate: z.boolean().optional(),
  /*
   * The editor's own live evaluation. Accepted so an older client is not
   * rejected for sending it, and deliberately ignored: the registry recomputes
   * every guardrail from the content it is about to store. A client-supplied
   * "all satisfied" is exactly the claim this system must never take on trust.
   */
  invariants: z.array(z.unknown()).optional(),
});

/** Every prompt, its versions, and which one is in force. */
promptsRouter.get('/', async (_req, res) => {
  res.json(await promptStore.descriptors());
});

async function descriptorOr404(key: string, res: Response): Promise<PromptDescriptor | undefined> {
  const descriptor = await promptStore.descriptor(key);
  if (!descriptor) {
    res.status(404).json({ error: `No prompt named "${key}" in this build.` });
    return undefined;
  }
  return descriptor;
}

promptsRouter.get<{ key: string }>('/:key', async (req, res) => {
  const descriptor = await descriptorOr404(req.params.key, res);
  if (descriptor) res.json(descriptor);
});

/**
 * Save a new version.
 *
 * A version that drops a guardrail is accepted — an operator may genuinely
 * need to rewrite a preamble, and a registry that refuses will be worked
 * around outside the tool, where nothing is recorded at all. What is not
 * negotiable is that the drop is visible: the stored version carries the
 * failed checks, and every run that used it carries them too.
 */
promptsRouter.post<{ key: string }>('/:key/versions', async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (!(await descriptorOr404(req.params.key, res))) return;
  try {
    await promptStore.createVersion({
      key: req.params.key,
      label: parsed.data.label,
      content: parsed.data.content,
      notes: parsed.data.notes,
      activate: parsed.data.activate,
    });
    res.status(201).json(await promptStore.descriptor(req.params.key));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Edit a custom version in place.
 *
 * Rewrites history, and the store says so plainly: the content hash is
 * recomputed, so a run already recorded against this version id now points at
 * text that is not what it saw. Offered anyway because the alternative is an
 * operator leaving eight near-identical versions behind while iterating on
 * wording. The built-in is refused — the store throws and that becomes a 400.
 */
promptsRouter.patch<{ key: string; versionId: string }>('/:key/versions/:versionId', async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (!(await descriptorOr404(req.params.key, res))) return;
  try {
    await promptStore.updateVersion({
      key: req.params.key,
      versionId: req.params.versionId,
      label: parsed.data.label,
      content: parsed.data.content,
      notes: parsed.data.notes,
      activate: parsed.data.activate,
    });
    res.json(await promptStore.descriptor(req.params.key));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Put a version in force. Selecting the built-in clears the selection, which is the same thing. */
promptsRouter.post<{ key: string; versionId: string }>('/:key/versions/:versionId/activate', async (req, res) => {
  if (!(await descriptorOr404(req.params.key, res))) return;
  try {
    await promptStore.setActive(req.params.key, req.params.versionId);
    res.json(await promptStore.descriptor(req.params.key));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Delete a custom version.
 *
 * Deleting the one in force falls the prompt back to its built-in rather than
 * to the next-newest edit — reverting to shipped text is the one outcome an
 * operator can reason about. The response is the descriptor, so the client
 * sees that fallback rather than inferring it.
 */
promptsRouter.delete<{ key: string; versionId: string }>('/:key/versions/:versionId', async (req, res) => {
  if (!(await descriptorOr404(req.params.key, res))) return;
  try {
    await promptStore.deleteVersion(req.params.key, req.params.versionId);
    res.json(await promptStore.descriptor(req.params.key));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
