/**
 * Where a project is, what surrounds it, and what the approach road looks like.
 *
 * GET  /                build-or-read
 * POST /refresh         rebuild unconditionally
 * GET  /street-view     image proxy (Maps key never reaches the browser)
 * GET  /map             static map tile
 */

import { Router } from 'express';
import { readGoogleMapsConfig, staticMapUrl, streetViewImageUrl } from '@realytica/agents';
import { projectToIdentity } from '@realytica/shared';
import { store } from '../store';
import { ensureIdentitySiteContext } from '../site-context';

function findProject(id: string | undefined) {
  if (!id) return undefined;
  return store.data.projects?.find((p) => p.id === id);
}

type ProjectParams = { projectId: string };

export const projectSiteContextRouter = Router({ mergeParams: true });

const MAX_IMAGE_EDGE = 1280;

function clampEdge(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(64, Math.min(MAX_IMAGE_EDGE, Math.round(n)));
}

projectSiteContextRouter.get<ProjectParams>('/', async (req, res) => {
  const found = findProject(req.params.projectId);
  if (!found) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const before = found.siteContext;
  const context = await ensureIdentitySiteContext(found, projectToIdentity(found), new Date().toISOString());
  if (context !== before) await store.save();
  if (!context) {
    res.json({
      caseId: found.id,
      location: null,
      amenities: [],
      streetView: null,
      gaps: [
        {
          code: 'no_provider_key',
          attempted: 'Locating the site and looking up what surrounds it.',
          consequence:
            'This project is not shown on a map, nothing is listed as nearby, and there is no street-level view — no mapping provider is configured for this deployment.',
        },
      ],
      provider: 'unconfigured',
      builtAt: new Date().toISOString(),
    });
    return;
  }
  res.json(context);
});

projectSiteContextRouter.post<ProjectParams>('/refresh', async (req, res) => {
  const found = findProject(req.params.projectId);
  if (!found) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  // A project whose file states its own coordinate can be rebuilt without a
  // key: the pin comes from the case, and what surrounds it comes back as the
  // named gaps it already had.
  if (!readGoogleMapsConfig() && !found.siteCoordinate) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const context = await ensureIdentitySiteContext(found, projectToIdentity(found), new Date().toISOString(), { force: true });
  await store.save();
  res.json(context);
});

projectSiteContextRouter.get<ProjectParams>('/street-view', async (req, res) => {
  const found = findProject(req.params.projectId);
  if (!found) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const config = readGoogleMapsConfig();
  if (!config) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const pano = typeof req.query.pano === 'string' ? req.query.pano : '';
  if (!pano || found.siteContext?.streetView?.panoramaId !== pano) {
    res.status(400).json({ error: 'Unknown panorama for this project' });
    return;
  }
  const heading = Number(req.query.heading);
  const upstream = streetViewImageUrl(config, pano, {
    heading: Number.isFinite(heading) ? heading : (found.siteContext?.streetView?.headingDegrees ?? 0),
    width: clampEdge(req.query.w, 640),
    height: clampEdge(req.query.h, 400),
  });
  await pipeImage(upstream, res);
});

projectSiteContextRouter.get<ProjectParams>('/map', async (req, res) => {
  const found = findProject(req.params.projectId);
  if (!found) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const config = readGoogleMapsConfig();
  if (!config) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const location = found.siteContext?.location;
  if (!location) {
    res.status(404).json({ error: 'This project has no resolved location' });
    return;
  }
  const zoomRaw = Number(req.query.zoom);
  const upstream = staticMapUrl(config, location.point, {
    zoom: Number.isFinite(zoomRaw) ? Math.max(3, Math.min(20, Math.round(zoomRaw))) : 15,
    width: clampEdge(req.query.w, 640),
    height: clampEdge(req.query.h, 360),
    scale: 2,
    markers: [
      { point: location.point, label: 'P', colour: '0x2563eb' },
      ...(found.siteContext?.amenities ?? []).slice(0, 8).map((a, i) => ({
        point: a.point,
        label: String(i + 1),
        colour: '0x64748b',
      })),
    ],
  });
  await pipeImage(upstream, res);
});

async function pipeImage(url: string, res: import('express').Response): Promise<void> {
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Image provider returned ${upstream.status}` });
      return;
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Image fetch failed' });
  }
}
