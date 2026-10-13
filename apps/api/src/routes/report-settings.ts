/**
 * The firm's setting for reports (`/api/report-settings`).
 *
 * GET  /   whether the firm once let a model reword a status report's lines, and whether the person asking may turn that off
 * PUT  /   turn it off: `{ "modelWording": false }`
 *
 * A report is written by code from the record and the fields, and no model
 * writes any line of one. A model once put the lines of a status report in
 * plainer words where a firm had turned that on. It can no longer be turned
 * on: `true` is refused. Turning it off takes the wording a model left off
 * every status report of the firm's that has not been issued; an issued
 * report stays as it was read.
 */

import { Router } from 'express';
import { z } from 'zod';
import { can, isStatusSource, reportIsFrozen } from '@realytica/shared';
import { needs, principalOf } from '../auth/middleware';
import { store } from '../store';

export const reportSettingsRouter = Router();

const bodySchema = z.object({ modelWording: z.boolean() });

reportSettingsRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const tenant = (store.data.tenants ?? []).find((held) => held.id === me.tenantId);
  res.json({ modelWording: tenant?.reportWording === true, maySet: can(me.role, 'admin') });
});

reportSettingsRouter.put('/', needs('admin'), async (req, res) => {
  const me = principalOf(req);
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say modelWording: false to take a model’s wording off status reports not yet issued.' });
    return;
  }
  if (parsed.data.modelWording) {
    res.status(400).json({ error: 'No model rewords a report: reports are written by code from the record and the fields.' });
    return;
  }
  const tenant = (store.data.tenants ?? []).find((held) => held.id === me.tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  delete tenant.reportWording;
  const first = store.data.tenants?.[0]?.id;
  for (const project of store.data.projects ?? []) {
    if ((project.tenantId ?? first) !== tenant.id) continue;
    for (const report of project.reports) {
      if (reportIsFrozen(report.status)) continue;
      for (const block of report.body.blocks ?? []) if (isStatusSource(block.source?.kind)) delete block.wording;
    }
  }
  await store.save();
  res.json({ modelWording: false, maySet: true });
});
