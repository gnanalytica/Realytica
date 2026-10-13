/**
 * A firm's own fields (`/api/firm-fields`).
 *
 * GET /   the firm's pack, the built-in sets it may add to, and whether this person may change it
 * PUT /   replace the pack
 *
 * Anybody who can read a project reads the pack: the web app draws a sheet
 * from the project in hand and needs the firm's fields to draw the firm's.
 * It holds labels and lists, and nothing of any project.
 *
 * A firm admin changes it. A pack is saved whole or not at all: one fault
 * (a key that takes a built-in field's, a field nobody fills, a choice with
 * no list) refuses the save, with every fault said. What a firm may not do is
 * not in the shape at all: there is no way to hide a built-in field or to
 * change what one holds.
 */

import { Router } from 'express';
import { z } from 'zod';
import { FIELD_SETS, FIRM_FIELD_KINDS, can, firmFieldFaults, firmFieldsHeld, firmSets, workstreamDefinition, type FirmFieldPack } from '@realytica/shared';
import { needs, principalOf } from '../auth/middleware';
import { loadFirmFields, saveFirmFields } from '../firm-fields';

export const firmFieldsRouter = Router();

const option = z.object({ key: z.string().min(1).max(40), label: z.string().trim().min(1).max(60), retired: z.literal(true).optional() });
const packBody = z.object({
  optionSets: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().max(60), options: z.array(option).max(40) })).max(40),
  add: z
    .array(
      z.object({
        set: z.string().min(1).max(120),
        field: z.object({
          key: z.string().min(1).max(40),
          label: z.string().trim().max(120),
          kind: z.enum(FIRM_FIELD_KINDS as unknown as [string, ...string[]]),
          tier: z.enum(['core', 'expert']).optional(),
          section: z.string().max(80).optional(),
          unit: z.string().max(12).optional(),
          optionSet: z.string().max(40).optional(),
          maxLength: z.number().int().min(1).max(600).optional(),
          retired: z.literal(true).optional(),
        }),
      }),
    )
    .max(200),
  demote: z.array(z.object({ set: z.string().min(1).max(120), field: z.string().min(1).max(80) })).max(200),
});

/** The built-in sets a firm may add to, as the page lists them: titles, sections and fields by label. */
function setsShown() {
  return firmSets(FIELD_SETS).map((set) => ({
    id: set.id,
    title: set.title,
    function: set.fn === 'shared' ? 'Shared records' : (workstreamDefinition(set.fn)?.label ?? set.fn),
    repeats: Boolean(set.records),
    titleField: set.records?.titleField,
    sections: (set.sections ?? []).map((section) => ({ key: section.key, label: section.label })),
    fields: set.fields.filter((def) => !def.retired).map((def) => ({ key: def.key, label: def.label, kind: def.kind, tier: def.tier ?? (set.sections ?? []).find((section) => section.key === def.section)?.tier ?? (def.showWhen ? 'situational' : 'core') })),
  }));
}

firmFieldsRouter.get('/', needs('read'), async (req, res, next) => {
  try {
    const me = principalOf(req);
    res.json({ pack: await loadFirmFields(me.tenantId), sets: setsShown(), mayManage: can(me.role, 'admin') });
  } catch (err) {
    next(err);
  }
});

firmFieldsRouter.put('/', needs('admin'), async (req, res, next) => {
  const parsed = packBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  try {
    const me = principalOf(req);
    const pack: FirmFieldPack = { ...firmFieldsHeld({ v: 1, ...parsed.data }), updatedAt: new Date().toISOString(), updatedBy: me.email };
    const faults = firmFieldFaults(pack);
    if (faults.length) {
      res.status(400).json({ error: faults.join(' '), faults });
      return;
    }
    await saveFirmFields(me.tenantId, pack);
    res.json({ pack, sets: setsShown(), mayManage: true });
  } catch (err) {
    next(err);
  }
});
