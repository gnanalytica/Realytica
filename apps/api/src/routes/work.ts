import { Router } from 'express';
import {
  myWorkOn,
  reachesEveryProject,
  sortWork,
  type WorkItem,
} from '@realytica/shared';
import { store } from '../store';
import { needs, principalOf } from '../auth/middleware';
import { liveGrant, projectFor } from '../auth/access';

/**
 * What is mine, across every file I can reach.
 *
 * The one question the product could not answer. Sixteen fields name a person
 * and every one of them is free text, so "what am I supposed to be doing" meant
 * opening each project in turn and reading its registers — which is the same as
 * not being able to ask.
 *
 * Built from the projection rather than from the file, deliberately, so it
 * needs no access rule of its own. A collaborator's work is found inside a copy
 * of the project that contains only what their grant reaches; a row they own
 * outside it does not exist as far as this route is concerned, which is exactly
 * what every other read on this deployment already means.
 */
export const workRouter = Router();

workRouter.get('/', needs('read'), (req, res) => {
  const me = principalOf(req);
  const bootstrap = store.data.tenants?.[0]?.id;
  const mine = (store.data.projects ?? []).filter((p) => (p.tenantId ?? bootstrap) === me.tenantId);

  // A collaborator's list is the projects they hold a live grant on. Same rule
  // as the project list, and for the same reason: a project they cannot open
  // must not appear here as a row they cannot click.
  const reachable = reachesEveryProject(me.role)
    ? mine
    : mine.filter((p) => liveGrant(me.tenantId, p.id, me.email));

  const now = new Date().toISOString();
  const items: WorkItem[] = reachable.flatMap((project) =>
    myWorkOn(projectFor(req, project), { email: me.email, name: me.name }, now),
  );

  res.json({ items: sortWork(items), asOf: now });
});
