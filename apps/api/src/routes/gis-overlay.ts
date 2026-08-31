/**
 * GIS context overlay for a project: pin + optional survey sketch + OSM.
 *
 * GET  /gis-overlay           live read — not persisted as evidence
 * PUT  /survey-boundary       supplied GeoJSON/KML (surveyor's sketch)
 * DELETE /survey-boundary     drop the sketch from the project, not from evidence
 */

import { Router } from 'express';
import {
  applySurveyBoundary,
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
  });
  res.json(read);
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
