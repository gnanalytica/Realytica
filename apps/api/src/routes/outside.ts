/**
 * Requests that leave the firm, and what comes back.
 *
 * For the firm's own people (`/api/outside`, behind sign-in):
 *
 * GET    /status                                                    which channels this deployment has set up, and what is missing
 * POST   /projects/:projectId/requests/:requestId/send              send a request by email or WhatsApp
 * POST   /projects/:projectId/requests/:requestId/replies/:replyId/confirm    a person confirms a reply answers the request
 * POST   /projects/:projectId/requests/:requestId/replies/:replyId/set-aside  a person says it does not
 * GET    /tray                                                      what waits to be sorted
 * GET    /tray/:itemId/papers/:attachmentId                        one of its papers, as a download
 * POST   /tray/:itemId/file                                         file it to a project, for a request where one is named
 * POST   /tray/:itemId/discard                                      discard it and its papers
 *
 * Somebody working from a grant is answered as if nothing were here.
 * Reading is any of the firm's people's. Sending, confirming, filing and
 * discarding are for those who may change a record, and a request raised
 * from a checklist takes somebody who may edit in that checklist's
 * department, as the checklist itself does.
 *
 * For the providers (`/api/outside/hooks`, ahead of sign-in, each behind its
 * own signature):
 *
 * POST   /hooks/resend      Resend's `email.received`, signed as Svix signs
 * GET    /hooks/whatsapp    Meta's handshake when the webhook is registered
 * POST   /hooks/whatsapp    Meta's messages, signed with the app secret
 *
 * These read the body as bytes, since a signature is over what arrived and
 * not over what it parses to. A channel that is not set up answers 503 and
 * does nothing. What a message becomes is `outside/inbound.ts`'s to say.
 */

import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  OUTSIDE_LIMITS,
  actorOf,
  addressOf,
  confirmReply,
  departmentRole,
  foldPhone,
  nameOf,
  reachesEveryProject,
  recordDispatch,
  requestEmail,
  requestTemplateValues,
  roleCanEdit,
  setAsideReply,
  type DdProject,
  type ProjectRequest,
} from '@realytica/shared';
import { accessTo } from '../auth/access';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { forgetReference, mintReference, outsideStatus, referencesIn, rememberQuoted, rememberReference, replyAddress } from '../outside/config';
import { discardTrayItem, fileTrayItem, readTray, takeIn, trayPaper, type InboundMessage, type InboundOutcome } from '../outside/inbound';
import { ProviderRefused, receivedAttachments, receivedEmail, resendWebhookHolds, sendRequestEmail, sendRequestWhatsApp, whatsappHandshakeHolds, whatsappMedia, whatsappWebhookHolds } from '../outside/providers';
import { store } from '../store';
import { documentDisposition, resolveServedType } from './document-file';

/* ==================================================================== */
/* The firm's own routes                                                 */
/* ==================================================================== */

type Params = { projectId?: string; requestId?: string; replyId?: string; itemId?: string; attachmentId?: string };

export const outsideRouter = Router();

/** The firm's own people only: who else the firm is writing to, and what strangers sent it, is not for somebody working from a grant. */
function firmOnly(req: Request, res: Response, next: NextFunction): void {
  if (!reachesEveryProject(principalOf(req).role)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}

outsideRouter.use(firmOnly);
outsideRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

// The project as storage has it now, then the same guard the project's other firm-only pages have.
outsideRouter.use('/projects/:projectId', (req, _res, next) => {
  void store.syncProject(req.params.projectId ?? '').then(() => next(), () => next());
});
outsideRouter.use('/projects/:projectId', workspaceOnly);

outsideRouter.get('/status', (_req, res) => {
  res.json(outsideStatus());
});

/** A project of the caller's own workspace, or a 404 answered. */
function ownProject(req: Request, res: Response, projectId: string): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === projectId);
  if (!project || !accessTo(req, project).ok) {
    res.status(404).json({ error: 'Project not found' });
    return undefined;
  }
  return project;
}

function requestOf(res: Response, project: DdProject, requestId: string | undefined): ProjectRequest | undefined {
  const request = (project.requests ?? []).find((held) => held.id === requestId);
  if (!request) res.status(404).json({ error: 'No request by that id.' });
  return request;
}

/** A request raised from a checklist is that checklist's department's: sending it out, or saying it is answered, takes somebody who may edit there. */
function mayActOn(req: Request, res: Response, project: DdProject, request: ProjectRequest): boolean {
  const me = principalOf(req);
  const departments = new Set((project.checklist ?? []).filter((item) => request.checklistItemIds?.includes(item.id)).map((item) => item.department));
  for (const department of departments) {
    if (roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department))) continue;
    res.status(403).json({ error: `That needs a lead, contributor or signer in ${department}.` });
    return false;
  }
  return true;
}

const sendSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), to: z.string().trim().email().max(254) }),
  z.object({ channel: z.literal('whatsapp'), to: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,22}$/) }),
]);

outsideRouter.post('/projects/:projectId/requests/:requestId/send', async (req, res) => {
  const params = req.params as Params;
  const project = ownProject(req, res, params.projectId ?? '');
  if (!project) return;
  const request = requestOf(res, project, params.requestId);
  if (!request || !mayActOn(req, res, project, request)) return;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say how to send it, email or WhatsApp, and the address or number to send it to.' });
    return;
  }
  if (request.status === 'answered' || request.status === 'cancelled') {
    res.status(409).json({ error: 'This request is closed.' });
    return;
  }
  const { channel } = parsed.data;
  const status = outsideStatus()[channel];
  const reference = status.send ? mintReference() : undefined;
  const to = channel === 'email' ? parsed.data.to.toLowerCase() : foldPhone(parsed.data.to);
  if (!reference || !to) {
    res.status(!to ? 400 : 409).json({ error: !to ? 'That is not a phone number with its country code.' : `${channel === 'email' ? 'Email' : 'WhatsApp'} is not set up on this deployment. Missing: ${status.missing.join(', ')}.` });
    return;
  }
  const me = principalOf(req);
  const tenantId = project.tenantId ?? me.tenantId;
  try {
    // Kept before anything is sent: a reply can come back before this request has finished.
    await rememberReference(reference, { tenantId, projectId: project.id, requestId: request.id });
    let providerId: string | undefined;
    if (channel === 'email') {
      const firm = store.data.tenants?.find((held) => held.id === tenantId)?.name;
      providerId = await sendRequestEmail({ to, replyTo: replyAddress(reference)!, ...requestEmail(project, request, reference, firm) });
    } else {
      providerId = await sendRequestWhatsApp(to, requestTemplateValues(project, request, reference));
      if (providerId) await rememberQuoted(providerId, reference);
    }
    const at = new Date();
    recordDispatch(project, request.id, { channel, to, at: at.toISOString(), by: actorOf(me), reference, expiresAt: new Date(at.getTime() + OUTSIDE_LIMITS.referenceDays * 86_400_000).toISOString(), ...(providerId ? { providerId } : {}) });
    await store.save();
    res.status(201).json({ project });
  } catch (err) {
    await forgetReference(reference).catch(() => undefined);
    if (err instanceof ProviderRefused || (err as Error).name === 'AbortError' || err instanceof TypeError) {
      console.warn(`[outside] sending a request by ${channel} failed: ${(err as Error).message}`);
      res.status(502).json({ error: `It was not sent: the ${channel === 'email' ? 'email' : 'WhatsApp'} service did not take it. Nothing was recorded.` });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not send that request' });
  }
});

function decideReply(decide: typeof confirmReply) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = req.params as Params;
    const project = ownProject(req, res, params.projectId ?? '');
    if (!project) return;
    const request = requestOf(res, project, params.requestId);
    if (!request || !mayActOn(req, res, project, request)) return;
    try {
      decide(project, request.id, params.replyId ?? '', actorOf(principalOf(req)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not do that';
      res.status(/^No reply by that id/.test(message) ? 404 : 409).json({ error: message });
      return;
    }
    await store.save();
    res.json({ project });
  };
}

outsideRouter.post('/projects/:projectId/requests/:requestId/replies/:replyId/confirm', decideReply(confirmReply));
outsideRouter.post('/projects/:projectId/requests/:requestId/replies/:replyId/set-aside', decideReply(setAsideReply));

outsideRouter.get('/tray', async (req, res) => {
  res.json({ items: await readTray(principalOf(req).tenantId) });
});

outsideRouter.get('/tray/:itemId/papers/:attachmentId', async (req, res) => {
  const params = req.params as Params;
  const held = await trayPaper(principalOf(req).tenantId, params.itemId ?? '', params.attachmentId ?? '');
  if (!held) {
    res.status(404).json({ error: 'No paper by that id.' });
    return;
  }
  // A stranger sent this: it is handed over as a file to save, never shown in the page.
  const { contentType } = resolveServedType(held.bytes, held.attachment.fileName, true);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', documentDisposition(false, held.attachment.fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(held.bytes.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(held.bytes);
});

const fileSchema = z.object({ projectId: z.string().min(1).max(120), requestId: z.string().min(1).max(120).optional() });

outsideRouter.post('/tray/:itemId/file', async (req, res) => {
  const parsed = fileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Say which project to file it to.' });
    return;
  }
  await store.syncProject(parsed.data.projectId);
  const project = ownProject(req, res, parsed.data.projectId);
  if (!project) return;
  const request = parsed.data.requestId ? requestOf(res, project, parsed.data.requestId) : undefined;
  if (parsed.data.requestId && !request) return;
  if (request && !mayActOn(req, res, project, request)) return;
  if (request && request.status !== 'sent' && request.status !== 'draft') {
    res.status(409).json({ error: 'This request is closed.' });
    return;
  }
  try {
    await fileTrayItem(principalOf(req).tenantId, (req.params as Params).itemId ?? '', project, request?.id, actorOf(principalOf(req)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not file that';
    res.status(/^No item by that id/.test(message) ? 404 : 400).json({ error: message });
    return;
  }
  res.json({ items: await readTray(principalOf(req).tenantId), project });
});

outsideRouter.post('/tray/:itemId/discard', async (req, res) => {
  const tenantId = principalOf(req).tenantId;
  if (!(await discardTrayItem(tenantId, (req.params as Params).itemId ?? ''))) {
    res.status(404).json({ error: 'No item by that id.' });
    return;
  }
  res.json({ items: await readTray(tenantId) });
});

/* ==================================================================== */
/* The providers' webhooks                                               */
/* ==================================================================== */

export const outsideHooksRouter = Router();

/** A webhook's body, in bytes. A megabyte is a hundred times what either provider posts for one message. */
outsideHooksRouter.use(express.raw({ type: () => true, limit: '1mb' }));

const rawOf = (req: Request): Buffer => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function parsed(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    return undefined;
  }
}

const receivedSchema = z.object({
  type: z.string(),
  data: z
    .object({
      email_id: z.string().regex(/^[0-9a-zA-Z_-]{1,80}$/),
      from: z.string().max(400),
      to: z.array(z.string().max(400)).max(50).optional(),
      cc: z.array(z.string().max(400)).max(50).optional(),
      received_for: z.array(z.string().max(400)).max(50).optional(),
      subject: z.string().max(2000).optional().nullable(),
    })
    .passthrough(),
});

/** The answer to Resend, apart from the wire. */
export async function resendHook(headers: { id?: string; timestamp?: string; signature?: string }, raw: Buffer): Promise<{ status: number; body: InboundOutcome | { outcome: 'ignored' } | { error: string } }> {
  if (!outsideStatus().email.receive) return { status: 503, body: { error: 'Inbound email is not set up.' } };
  if (!resendWebhookHolds(headers, raw)) return { status: 401, body: { error: 'Unauthorized' } };
  const event = receivedSchema.safeParse(parsed(raw));
  if (!event.success) return { status: 200, body: { outcome: 'ignored' } };
  if (event.data.type !== 'email.received') return { status: 200, body: { outcome: 'ignored' } };
  const { data } = event.data;
  const from = addressOf(data.from);
  if (!from) return { status: 200, body: { outcome: 'ignored' } };
  const mail = await receivedEmail(data.email_id);
  const addressed = [...(data.to ?? []), ...(data.cc ?? []), ...(data.received_for ?? [])];
  const message: InboundMessage = {
    channel: 'email',
    deliveryId: `resend:${data.email_id}`,
    from,
    ...(nameOf(data.from) ? { fromName: nameOf(data.from) } : {}),
    receivedAt: new Date().toISOString(),
    ...(data.subject ? { subject: data.subject } : {}),
    ...(mail.text ? { text: mail.text } : {}),
    // The address it was sent to first, then its subject, then its words, where a quoted request carries one.
    references: [...addressed.flatMap(referencesIn), ...referencesIn(data.subject ?? ''), ...referencesIn(mail.text)],
    verified: mail.verified,
    files: await receivedAttachments(data.email_id),
  };
  return { status: 200, body: await takeIn(message) };
}

outsideHooksRouter.post('/resend', async (req, res) => {
  try {
    const { status, body } = await resendHook({ id: header(req, 'svix-id'), timestamp: header(req, 'svix-timestamp'), signature: header(req, 'svix-signature') }, rawOf(req));
    if (status === 200) console.log(`[outside] email ${JSON.stringify(body)}`);
    res.status(status).json(body);
  } catch (err) {
    // Not kept: answered as a failure, so Resend sends it again.
    console.warn(`[outside] an inbound email could not be taken in: ${(err as Error).message}`);
    res.status(500).json({ error: 'Could not take that in.' });
  }
});

outsideHooksRouter.get('/whatsapp', (req, res) => {
  if (!whatsappHandshakeHolds(req.query['hub.mode'], req.query['hub.verify_token'])) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});

const mediaSchema = z.object({ id: z.string().regex(/^[0-9a-zA-Z_.:-]{1,200}$/), mime_type: z.string().max(200).optional(), filename: z.string().max(400).optional(), caption: z.string().max(4000).optional() });
const whatsappMessageSchema = z
  .object({
    from: z.string().max(40),
    id: z.string().min(1).max(400),
    timestamp: z.string().max(20).optional(),
    type: z.string().max(40),
    text: z.object({ body: z.string().max(8000) }).optional(),
    document: mediaSchema.optional(),
    image: mediaSchema.optional(),
    context: z.object({ id: z.string().max(400).optional() }).passthrough().optional(),
  })
  .passthrough();
const whatsappSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(z.object({ value: z.object({ contacts: z.array(z.object({ wa_id: z.string().optional(), profile: z.object({ name: z.string().optional() }).optional() }).passthrough()).optional(), messages: z.array(z.unknown()).optional() }).passthrough() }).passthrough())
          .optional(),
      }).passthrough(),
    )
    .max(100),
});

/** Messages taken from one post. Meta may batch; past this the rest are left for its next try. */
const MESSAGES_PER_POST = 50;

const extensionOf = (mimeType: string | undefined): string => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[mimeType ?? ''] ?? '';

/** The answer to Meta, apart from the wire. A post is answered 200 only when every message in it was kept or was a repeat. */
export async function whatsappHook(signature: string | undefined, raw: Buffer): Promise<{ status: number; body: { outcomes: InboundOutcome[] } | { error: string } }> {
  if (!outsideStatus().whatsapp.receive) return { status: 503, body: { error: 'Inbound WhatsApp is not set up.' } };
  if (!whatsappWebhookHolds(signature, raw)) return { status: 401, body: { error: 'Unauthorized' } };
  const post = whatsappSchema.safeParse(parsed(raw));
  if (!post.success || post.data.object !== 'whatsapp_business_account') return { status: 200, body: { outcomes: [] } };
  const outcomes: InboundOutcome[] = [];
  let failed = false;
  for (const entry of post.data.entry) {
    for (const change of entry.changes ?? []) {
      for (const sent of change.value.messages ?? []) {
        if (outcomes.length >= MESSAGES_PER_POST) break;
        const held = whatsappMessageSchema.safeParse(sent);
        // A reaction, a sticker, a voice note, a location: not words and not a paper.
        if (!held.success || !['text', 'document', 'image'].includes(held.data.type)) continue;
        const message = held.data;
        const from = foldPhone(message.from);
        if (!from) continue;
        const media = message.type === 'document' ? message.document : message.type === 'image' ? message.image : undefined;
        const text = message.text?.body ?? media?.caption;
        const at = Number(message.timestamp);
        const name = change.value.contacts?.find((contact) => foldPhone(contact.wa_id) === from)?.profile?.name;
        try {
          outcomes.push(
            await takeIn({
              channel: 'whatsapp',
              deliveryId: `whatsapp:${message.id}`,
              from,
              ...(name ? { fromName: name } : {}),
              receivedAt: (Number.isFinite(at) && at > 0 ? new Date(at * 1000) : new Date()).toISOString(),
              ...(text ? { text } : {}),
              references: referencesIn(text),
              ...(message.context?.id ? { quotedProviderId: message.context.id } : {}),
              // Meta delivers only what came from the number it names.
              verified: true,
              files: media ? [whatsappMedia(media.id, media.filename ?? `whatsapp-${message.type}-${message.timestamp ?? Date.now()}${extensionOf(media.mime_type)}`, media.mime_type ?? 'application/octet-stream')] : [],
            }),
          );
        } catch (err) {
          failed = true;
          console.warn(`[outside] a WhatsApp message could not be taken in: ${(err as Error).message}`);
        }
      }
    }
  }
  return failed ? { status: 500, body: { error: 'Could not take that in.' } } : { status: 200, body: { outcomes } };
}

outsideHooksRouter.post('/whatsapp', async (req, res) => {
  try {
    const { status, body } = await whatsappHook(header(req, 'x-hub-signature-256'), rawOf(req));
    if (status === 200) console.log(`[outside] whatsapp ${JSON.stringify(body)}`);
    res.status(status).json(body);
  } catch (err) {
    // Not kept: answered as a failure, so Meta sends it again.
    console.warn(`[outside] a WhatsApp post could not be taken in: ${(err as Error).message}`);
    res.status(500).json({ error: 'Could not take that in.' });
  }
});
