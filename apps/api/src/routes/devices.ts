/**
 * Pairing phones for the site app.
 *
 * POST   /api/devices/pair-code   a signed-in person asks for a code to type or scan
 * POST   /api/devices/claim       the phone trades the code for its own token (no sign-in)
 * GET    /api/devices/me          the phone asks who it is
 * DELETE /api/devices/me          the phone signs itself out
 * POST   /api/devices/push-token  the phone says where to send notifications
 * GET    /api/devices             the person's paired phones (every phone, for an admin)
 * DELETE /api/devices/:id         revoke one
 */

import { Router } from 'express';
import { z } from 'zod';
import { can } from '@realytica/shared';
import { principalOf } from '../auth/middleware';
import { store } from '../store';
import { claimPairCode, devicesOf, issuePairCode, publicDevice, revokeDevice, PAIR_CODE_TTL_MS } from '../devices';

const claimSchema = z.object({
  code: z.string().trim().min(4).max(20),
  name: z.string().trim().max(80).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

const pushSchema = z.object({ token: z.string().trim().min(10).max(300).nullable() });

/** Mounted before sign-in: the phone has no session yet, only the code. */
export const deviceClaimRouter = Router();

deviceClaimRouter.post('/', async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Type the code the web app showed.' });
    return;
  }
  const result = claimPairCode(parsed.data.code, { name: parsed.data.name, platform: parsed.data.platform });
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  await store.save();
  const member = (store.data.memberships ?? []).find((m) => m.tenantId === result.device.tenantId && m.email.toLowerCase() === result.device.email.toLowerCase());
  const tenant = (store.data.tenants ?? []).find((t) => t.id === result.device.tenantId);
  res.status(201).json({
    token: result.token,
    device: publicDevice(result.device),
    person: { email: result.device.email, name: member?.name ?? null },
    workspace: { id: tenant?.id ?? result.device.tenantId, name: tenant?.name ?? 'Workspace' },
  });
});

export const devicesRouter = Router();

devicesRouter.post('/pair-code', async (req, res) => {
  if (req.device) {
    res.status(403).json({ error: 'Pair a phone from the web app.' });
    return;
  }
  const code = issuePairCode(principalOf(req));
  await store.save();
  res.status(201).json({ code: code.code, expiresAt: code.expiresAt, ttlSeconds: Math.round(PAIR_CODE_TTL_MS / 1000) });
});

devicesRouter.get('/me', (req, res) => {
  const device = req.device;
  if (!device) {
    res.status(400).json({ error: 'Only a paired phone has a pairing.' });
    return;
  }
  const me = principalOf(req);
  const tenant = (store.data.tenants ?? []).find((t) => t.id === me.tenantId);
  res.json({ device: publicDevice(device), person: { email: me.email, name: me.name ?? null, role: me.role }, workspace: { id: me.tenantId, name: tenant?.name ?? 'Workspace' } });
});

devicesRouter.delete('/me', async (req, res) => {
  const device = req.device;
  if (!device) {
    res.status(400).json({ error: 'Only a paired phone can sign itself out.' });
    return;
  }
  revokeDevice(device.tenantId, device.id);
  await store.save();
  res.status(204).end();
});

devicesRouter.post('/push-token', async (req, res) => {
  const device = req.device;
  const parsed = pushSchema.safeParse(req.body);
  if (!device || !parsed.success) {
    res.status(400).json({ error: 'A paired phone sends its own push token.' });
    return;
  }
  if (parsed.data.token) device.pushToken = parsed.data.token;
  else delete device.pushToken;
  await store.save();
  res.json({ device: publicDevice(device) });
});

devicesRouter.get('/', (req, res) => {
  const me = principalOf(req);
  const all = (store.data.devices ?? []).filter((d) => d.tenantId === me.tenantId && !d.revokedAt);
  const visible = can(me.role, 'admin') ? all : devicesOf(me.tenantId, me.email);
  res.json({ devices: visible.map(publicDevice) });
});

devicesRouter.delete('/:id', async (req, res) => {
  const me = principalOf(req);
  const device = (store.data.devices ?? []).find((d) => d.tenantId === me.tenantId && d.id === req.params.id && !d.revokedAt);
  if (!device || (!can(me.role, 'admin') && device.email.toLowerCase() !== me.email.toLowerCase())) {
    res.status(404).json({ error: 'No such phone.' });
    return;
  }
  revokeDevice(me.tenantId, device.id);
  await store.save();
  res.status(204).end();
});
