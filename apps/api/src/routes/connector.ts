/**
 * A project's connected folder (`/api/projects/:projectId/connector`).
 *
 * GET    /        how it stands: whether the deployment is set up, the address to share a folder with, and the connector
 * PUT    /        connect a folder by its link, in place of any connected before
 * POST   /sync    read the whole folder now, and take in what is new or changed
 * DELETE /        disconnect it; the papers taken from it stay on the record
 *
 * For the firm's own people: somebody working from a grant is answered as if
 * nothing were here (`workspaceOnly`), since which folder of the firm's a
 * project reads is the firm's. Reading how it stands is any of them's.
 * Connecting, reading now and disconnecting are for those who may add
 * documents: a firm role that may change a record, and a lead, signer or
 * contributor in at least one of the project's departments. A paper lands in
 * whichever department it turns out to be for, so no one department is asked.
 *
 * Without `GOOGLE_SERVICE_ACCOUNT_JSON` nothing here calls Google, and each
 * answer says the firm has not set this up.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  MAX_FOLDER_LINK,
  actorOf,
  can,
  connectFolder,
  departmentRole,
  disconnectFolder,
  folderIdOf,
  projectDepartments,
  roleCanEdit,
  type ConnectorKind,
  type DdProject,
  type ProjectConnector,
} from '@realytica/shared';
import { needs, principalOf } from '../auth/middleware';
import { workspaceOnly } from '../auth/project-guard';
import { providerFor } from '../connectors';
import { FolderGone } from '../connectors/provider';
import { NOT_SET_UP, forgetLedger, syncFolder, type SyncRun } from '../connectors/sync';
import { store } from '../store';

/** The one kind of folder there is. A second kind arrives as a field of the PUT body. */
const KIND: ConnectorKind = 'google_drive';

/** A person's press reads fewer files and for less long than the timer: they are waiting on it. What is left waits, counted. */
const NOW_MAX_FILES = 10;
const NOW_BUDGET_MS = 60_000;

type Params = { projectId: string };

export const connectorRouter = Router({ mergeParams: true });

// The firm's own people only, on a project of their own workspace.
connectorRouter.use(workspaceOnly);

// Reading how the folder stands is any of them's. Changing it is for those who may change a record.
connectorRouter.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  needs('write')(req, res, next);
});

function projectOf(req: Request, res: Response): DdProject | undefined {
  const project = store.data.projects?.find((held) => held.id === (req.params as Params).projectId);
  if (!project) res.status(404).json({ error: 'Project not found' });
  return project;
}

/** Whether this person may add documents to the project: an editor in at least one of its departments. */
function mayAdd(req: Request, project: DdProject): boolean {
  const me = principalOf(req);
  if (!can(me.role, 'write')) return false;
  return projectDepartments(project).some((department) => roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department)));
}

function refusedToAdd(req: Request, res: Response, project: DdProject): boolean {
  if (mayAdd(req, project)) return false;
  res.status(403).json({ error: 'That needs a lead, contributor or signer in one of the project’s departments.' });
  return true;
}

export interface ConnectorShown {
  /** Whether the deployment holds what it needs to read a folder. */
  configured: boolean;
  kind: ConnectorKind;
  /** The address a folder is shared with. Absent where the deployment is not set up. */
  address?: string;
  connector?: ProjectConnector;
  mayChange: boolean;
  /** What the read just asked for came to. */
  run?: SyncRun;
}

function shown(req: Request, project: DdProject, run?: SyncRun): ConnectorShown {
  const provider = providerFor(project.connector?.kind ?? KIND);
  const address = provider.address();
  return {
    configured: provider.configured(),
    kind: provider.kind,
    ...(address ? { address } : {}),
    ...(project.connector ? { connector: project.connector } : {}),
    mayChange: mayAdd(req, project),
    ...(run ? { run } : {}),
  };
}

connectorRouter.get('/', (req, res) => {
  const project = projectOf(req, res);
  if (!project) return;
  res.json(shown(req, project));
});

connectorRouter.put('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project || refusedToAdd(req, res, project)) return;
  const parsed = z.object({ link: z.string().trim().min(1).max(MAX_FOLDER_LINK) }).strict().safeParse(req.body);
  const folderId = parsed.success ? folderIdOf(KIND, parsed.data.link) : undefined;
  if (!folderId) {
    res.status(400).json({ error: 'Paste the link to a Google Drive folder.' });
    return;
  }
  const provider = providerFor(KIND);
  if (!provider.configured()) {
    res.status(503).json({ error: NOT_SET_UP });
    return;
  }
  let folder: Awaited<ReturnType<typeof provider.folder>>;
  try {
    folder = await provider.folder(folderId);
  } catch (err) {
    if (err instanceof FolderGone) {
      const notShared = err.message === new FolderGone().message;
      res.status(400).json({ error: notShared ? `Share the folder with ${provider.address()} first, as a viewer.` : err.message });
      return;
    }
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  // Another folder's ledger says nothing of this one; the same folder's is kept, so nothing is taken twice.
  if (project.connector && project.connector.folderId !== folder.id) await forgetLedger(project.id).catch(() => undefined);
  connectFolder(project, { kind: KIND, folderId: folder.id, folderName: folder.name, folderLink: folder.link }, actorOf(principalOf(req)));
  await store.save();
  res.json(shown(req, project));
});

connectorRouter.post('/sync', async (req, res) => {
  const project = projectOf(req, res);
  if (!project || refusedToAdd(req, res, project)) return;
  if (!project.connector) {
    res.status(409).json({ error: 'No folder is connected.' });
    return;
  }
  if (!providerFor(project.connector.kind).configured()) {
    res.status(503).json({ error: NOT_SET_UP });
    return;
  }
  const run = await syncFolder(project.id, { now: new Date(), full: true, maxFiles: NOW_MAX_FILES, budgetMs: NOW_BUDGET_MS });
  if (run.busy) {
    res.status(409).json({ error: 'The folder is being read just now. Try again in a minute.' });
    return;
  }
  const now = store.data.projects?.find((held) => held.id === project.id) ?? project;
  res.json(shown(req, now, run));
});

connectorRouter.delete('/', async (req, res) => {
  const project = projectOf(req, res);
  if (!project || refusedToAdd(req, res, project)) return;
  if (project.connector) {
    disconnectFolder(project, actorOf(principalOf(req)));
    await store.save();
    await forgetLedger(project.id).catch(() => undefined);
  }
  res.json(shown(req, project));
});
