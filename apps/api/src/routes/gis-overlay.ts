/**
 * GIS context overlay for a project: pin + optional survey sketch + OSM.
 *
 * GET  /gis-overlay           live read — not persisted as evidence
 * PUT  /survey-boundary       supplied GeoJSON/KML (surveyor's sketch)
 * DELETE /survey-boundary     drop the sketch from the project, not from evidence
 */

import { Router } from 'express';
import {
  applyRevenueMap,
  applySurveyBoundary,
  clearRevenueMap,
  clearSurveyBoundary,
  compareProjectGis,
  noteProjectEdit,
  projectToIdentity,
} from '@realytica/shared';
import { store } from '../store';
import { ensureIdentitySiteContext } from '../site-context';
import { pullPinForProject } from '../project-chat-sides';
import { fetchOsmContext } from '../gis/overpass';
import { loadCivicLayers, loadWithdrawnRmpSheets } from '../gis/civic-cache';
import { isStateKey, readRevenueMap, revenueLevelLabels, revenueLevels } from '../gis/revenue-map';

function findProject(id: string | undefined) {
  if (!id) return undefined;
  return store.data.projects?.find((p) => p.id === id);
}

type ProjectParams = { projectId: string };

export const projectGisOverlayRouter = Router({ mergeParams: true });

projectGisOverlayRouter.get<ProjectParams>('/', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const before = project.siteContext;
  const site = await ensureIdentitySiteContext(project, projectToIdentity(project), new Date().toISOString());
  if (site !== before) await store.save();

  const places = project.siteContext?.location?.point ? undefined : await pullPinForProject(project);
  const pin = project.siteContext?.location?.point ?? places?.point;
  const force = req.query.force === '1' || req.query.force === 'true';
  const [osm, civic, sheets] = await Promise.all([
    pin ? fetchOsmContext(pin, { force }) : Promise.resolve({ features: [] as const }),
    loadCivicLayers({ force }),
    loadWithdrawnRmpSheets({ force }),
  ]);

  const read = compareProjectGis(project, {
    places,
    osm: {
      features: [...osm.features],
      fetchedAt: 'fetchedAt' in osm ? osm.fetchedAt : undefined,
      error: 'error' in osm ? osm.error : undefined,
    },
    civic: {
      lakes: civic.lakes,
      wards: civic.wards,
      error: civic.errors.length ? civic.errors.join('; ') : undefined,
    },
    withdrawnSheets: sheets,
    revenue: project.revenueMap,
  });
  res.json(read);
});

/*
 * The revenue map — Kshetra's engine, on this file.
 *
 * GET    /revenue/levels?state=&district=&mandal=   the picker, one level at a time
 * POST   /revenue  { state, district, mandal, village, surveyNo }
 * DELETE /revenue
 *
 * The read is stored on the project and the parcel ring becomes the boundary
 * when no person has supplied one. It is a government record read by
 * machine, not evidence — see `revenue-map.ts` in shared.
 */

function str(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

projectGisOverlayRouter.get<ProjectParams>('/revenue/levels', async (req, res) => {
  const state = isStateKey(req.query.state) ? req.query.state : 'KA';
  const district = str(req.query.district);
  const mandal = str(req.query.mandal);
  const result = await revenueLevels(
    district && mandal
      ? { level: 'villages', state, district, mandal }
      : district
        ? { level: 'mandals', state, district }
        : { level: 'districts', state },
  );
  if ('error' in result) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ ...result, labels: revenueLevelLabels(state) });
});

projectGisOverlayRouter.post<ProjectParams>('/revenue', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const state = isStateKey(body.state) ? body.state : null;
  const district = str(body.district);
  const mandal = str(body.mandal);
  const village = str(body.village);
  const surveyNo = str(body.surveyNo, 24).replace(/\s+/g, '');
  if (!state || !district || !mandal || !village || !surveyNo) {
    res.status(400).json({ error: 'Pick the state, district, mandal or taluk, and village, and give the survey number.' });
    return;
  }
  const outcome = await readRevenueMap({ state, district, mandal, village, surveyNo, landAreaSqm: project.landAreaSqm });
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }
  const boundary = applyRevenueMap(project, outcome.read, str(body.actor) || 'operator');
  noteProjectEdit(
    project,
    `Read the revenue map for Sy. ${outcome.read.surveyNo}, ${[outcome.read.village, outcome.read.mandal].filter(Boolean).join(', ')}.`,
  );
  await store.save();
  res.json({
    read: outcome.read,
    boundary,
    notEvidence: true,
    note: boundary
      ? 'The parcel from the revenue map is on this project as its boundary. It is a government record read by machine, not a licensed survey, and not filed as evidence until a person attaches the extract.'
      : 'The revenue map was read. The survey outline a person supplied stays as the boundary; the register’s parcel is compared against it.',
  });
});

projectGisOverlayRouter.delete<ProjectParams>('/revenue', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  clearRevenueMap(project, 'operator');
  noteProjectEdit(project, 'Cleared the revenue-map read.');
  await store.save();
  res.status(204).end();
});

projectGisOverlayRouter.put<ProjectParams>('/survey', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const body = req.body as { fileText?: string; note?: string; actor?: string } | undefined;
  const fileText = typeof body?.fileText === 'string' ? body.fileText : '';
  if (!fileText.trim()) {
    res.status(400).json({ error: 'Upload a surveyor\'s GeoJSON or KML. A mouse-drawn shape is not a survey.' });
    return;
  }
  try {
    const boundary = applySurveyBoundary(project, fileText, body?.note, body?.actor?.trim() || 'operator');
    noteProjectEdit(project, 'Supplied a survey outline for the GIS overlay.');
    await store.save();
    res.json({
      boundary,
      notEvidence: true,
      note: 'The outline is on this project for the map. It is not filed as evidence until a person attaches the sketch on a check.',
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'That file could not be read as a parcel outline.' });
  }
});

projectGisOverlayRouter.delete<ProjectParams>('/survey', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  clearSurveyBoundary(project, 'operator');
  noteProjectEdit(project, 'Cleared the supplied survey outline.');
  await store.save();
  res.status(204).end();
});
