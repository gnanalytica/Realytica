/**
 * Where a case is, what surrounds it, and what the approach road looks like.
 *
 * Three routes, and the split between them is the point:
 *
 *   GET  /                build-or-read. Cheap when cached, four billed calls
 *                         when the address has changed.
 *   POST /refresh         rebuild unconditionally. The only way to retry an
 *                         address that failed to geocode.
 *   GET  /street-view     an image proxy. The Maps key never reaches the
 *                         browser, so the browser cannot fetch Google's URL
 *                         itself and this route fetches it instead.
 *   GET  /map             the same, for a static map tile.
 *
 * Nothing here returns an extent, a boundary or a setback. See `SiteContext`
 * in the shared types for the argument.
 */

import { Router } from 'express';
import { readGoogleMapsConfig, staticMapUrl, streetViewImageUrl } from '@realytica/agents';
import { store } from '../store';
import { ensureSiteContext } from '../site-context';
import { findCase } from './cases';

export const siteContextRouter = Router({ mergeParams: true });

/** Static-map and Street View frames are both capped well below Google's own limits. */
const MAX_IMAGE_EDGE = 1280;

function clampEdge(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(64, Math.min(MAX_IMAGE_EDGE, Math.round(n)));
}

siteContextRouter.get<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const before = found.siteContext;
  const context = await ensureSiteContext(found, new Date().toISOString());
  if (context !== before) await store.save();
  if (!context) {
    // No provider and nothing cached. A 200 with an empty context and a named
    // gap, not a 404: the case exists, the question was asked, and the answer
    // is "nobody has configured a mapping provider" — which the client needs
    // to be able to say out loud.
    res.json({
      caseId: found.id,
      location: null,
      amenities: [],
      streetView: null,
      gaps: [
        {
          code: 'no_provider_key',
          attempted: 'Locating the property and looking up what surrounds it.',
          consequence:
            'This property is not shown on a map, nothing is listed as nearby, and there is no street-level view — ' +
            'no mapping provider is configured for this deployment.',
        },
      ],
      provider: 'unconfigured',
      builtAt: new Date().toISOString(),
    });
    return;
  }
  res.json(context);
});

siteContextRouter.post<{ id: string }>('/refresh', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  if (!readGoogleMapsConfig()) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const context = await ensureSiteContext(found, new Date().toISOString(), { force: true });
  await store.save();
  res.json(context);
});

siteContextRouter.get<{ id: string }>('/street-view', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const config = readGoogleMapsConfig();
  if (!config) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const pano = typeof req.query.pano === 'string' ? req.query.pano : '';
  // Only the panorama this case's own context resolved may be fetched. Without
  // this the route is an open, billed proxy to any panorama on Earth.
  if (!pano || found.siteContext?.streetView?.panoramaId !== pano) {
    res.status(400).json({ error: 'Unknown panorama for this case' });
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

siteContextRouter.get<{ id: string }>('/map', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const config = readGoogleMapsConfig();
  if (!config) {
    res.status(503).json({ error: 'No mapping provider is configured for this deployment' });
    return;
  }
  const location = found.siteContext?.location;
  if (!location) {
    res.status(404).json({ error: 'This case has no resolved location' });
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
      // The amenities the case actually lists, so the tile and the list below
      // it can never disagree about what is nearby.
      ...(found.siteContext?.amenities ?? []).slice(0, 8).map((a, i) => ({
        point: a.point,
        label: String(i + 1),
        colour: '0x64748b',
      })),
    ],
  });
  await pipeImage(upstream, res);
});

/**
 * Fetches an image from Google and writes it through.
 *
 * Cached hard at the CDN and the browser: a panorama frame for a fixed
 * panorama id and heading is immutable, and a static map for a fixed centre
 * and zoom is close enough. Every cache hit is a billed call that does not
 * happen.
 */
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
