/**
 * The firm's setting for reports (`/api/report-settings`).
 *
 * GET  /   whether a model may reword a status report's lines, and whether the person asking may change that
 * PUT  /   turn it on or off: `{ "modelWording": true }`
 *
 * A report is written by code from the record and the fields. The one thing
 * a model may do to one is put the lines of a status report in plainer
 * words, held to each line (`statusWordingHeld`), and only where the firm
 * has turned this on. It is off until somebody who runs the workspace turns
 * it on. Turning it off takes the wording off every status report of the
 * firm's that has not been issued; an issued report stays as it was read.
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
    res.status(400).json({ error: 'Say whether a model may reword status reports: modelWording, true or false.' });
    return;
  }
  const tenant = (store.data.tenants ?? []).find((held) => held.id === me.tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  if (parsed.data.modelWording) tenant.reportWording = true;
  else {
    delete tenant.reportWording;
    const first = store.data.tenants?.[0]?.id;
    for (const project of store.data.projects ?? []) {
      if ((project.tenantId ?? first) !== tenant.id) continue;
      for (const report of project.reports) {
        if (reportIsFrozen(report.status)) continue;
        for (const block of report.body.blocks ?? []) if (isStatusSource(block.source?.kind)) delete block.wording;
      }
    }
  }
  await store.save();
  res.json({ modelWording: tenant.reportWording === true, maySet: true });
});
