/**
 * GIS context overlay for a project: pin + optional survey sketch + OSM.
 *
 * GET  /gis-overlay           live read — not persisted as evidence
 * PUT  /survey-boundary       supplied GeoJSON/KML (surveyor's sketch)
 * DELETE /survey-boundary     drop the sketch from the project, not from evidence
 */

import { Router } from 'express';
import { actorOf } from '@realytica/shared';
import { principalOf } from '../auth/middleware';
import {
  applyRevenueMap,
  applySurveyBoundary,
  fileRevenueMapAsEvidence,
  clearRevenueMap,
  clearSurveyBoundary,
  compareProjectGis,
  noteProjectEdit,
  projectToIdentity,
  rememberAskedSurveyNo,
  removeRevenueMapRead,
  revenueReads,
} from '@realytica/shared';
import { store } from '../store';
import { ensureIdentitySiteContext } from '../site-context';
import { pullPinForProject } from '../project-chat-sides';
import { fetchOsmContext } from '../gis/overpass';
import { loadCivicLayers, loadWithdrawnRmpSheets } from '../gis/civic-cache';
import { isStateKey, readRevenueMap, rereadRevenueMap, revenueLevelLabels, revenueLevels, roomForRead, suggestRevenuePlace } from '../gis/revenue-map';

function findProject(id: string | undefined) {
  if (!id) return undefined;
  return store.data.projects?.find((p) => p.id === id);
}

type ProjectParams = { projectId: string };
type ParcelParams = ProjectParams & { parcelRef: string };

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
    revenue: revenueReads(project),
  });
  res.json(read);
});

/*
 * The revenue map — Kshetra's engine, on this file.
 *
 * GET    /revenue/levels?state=&district=&mandal=   the picker, one level at a time
 * POST   /revenue  { state, district, mandal, village, surveyNo, asWritten?, unlessKept?, several? }
 *                  { parcelRef, several? }          a kept parcel, read afresh
 * DELETE /revenue/:parcelRef                        one parcel's read
 * DELETE /revenue                                   every read
 *
 * One survey number to a request. A site on many is read by asking for each
 * in turn: the state's servers are slow, and a request that read twelve
 * would outlive the function that serves it and say nothing until it ended.
 *
 * Every read is kept on the project, one per parcel, and the first parcel's
 * ring becomes the boundary when no person has supplied one. Each is a
 * government record read by machine, not evidence — see `revenue-map.ts` in
 * shared.
 */

function str(v: unknown, max = 80): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * The file as storage holds it at this moment, before a read is filed,
 * removed or cleared.
 *
 * The sync every request gets is held to once a second for a project. That
 * second is long enough for the code in production to clear the reads and
 * for a removal here, made from the copy this instance still holds, to write
 * them back over the clear. These three change or rely on the reads, so they
 * look again first.
 */
function asStoredNow(projectId: string): Promise<void> {
  return store.syncProject(projectId, { force: true });
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

/** Where the revenue-map picker starts: the last read, or the village the address names. */
projectGisOverlayRouter.get<ProjectParams>('/revenue/suggest', (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(suggestRevenuePlace(project));
});

projectGisOverlayRouter.post<ProjectParams>('/revenue', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const kept = revenueReads(project).map((r) => r.parcelRef);
  const again = str(body.parcelRef, 120);
  const state = isStateKey(body.state) ? body.state : null;
  const district = str(body.district);
  const mandal = str(body.mandal);
  const village = str(body.village);
  const surveyNo = str(body.surveyNo, 24).replace(/\s+/g, '');
  // How the papers spell the number, where that is not how it is asked for first. Taken only as other spellings of it.
  const asWritten = (Array.isArray(body.asWritten) ? body.asWritten : []).map((spelling) => str(spelling, 24).replace(/\s+/g, '')).filter(Boolean);
  if (again && !kept.includes(again)) {
    res.status(404).json({ error: 'That parcel is not kept on this project, so there is nothing to read again.' });
    return;
  }
  if (!again && (!state || !district || !mandal || !village || !surveyNo)) {
    res.status(400).json({ error: 'Pick the state, district, mandal or taluk, and village, and give the survey number.' });
    return;
  }
  // Without a parcel to read again the place was required just above, so `state` is set on the other branch.
  const outcome =
    again || !state
      ? await rereadRevenueMap({ parcelRef: again, landAreaSqm: project.landAreaSqm, kept })
      : await readRevenueMap({
          state,
          district,
          mandal,
          village,
          surveyNo,
          landAreaSqm: project.landAreaSqm,
          kept,
          unlessKept: body.unlessKept === true,
          several: body.several === true,
          asWritten,
        });
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error, ...(outcome.near ? { near: outcome.near } : {}), ...(outcome.alsoAsked ? { alsoAsked: outcome.alsoAsked } : {}) });
    return;
  }
  /*
   * A read can take the better part of a minute and a run of numbers takes
   * several, long enough for the file to move on another instance. The read
   * lands on the file as it stands now, not as it stood when it was asked for.
   */
  await store.syncProject(project.id, { force: true });
  // Whoever is signed in reads the map; the body never names them.
  const actor = actorOf(principalOf(req));
  if ('already' in outcome) {
    const answered = rememberAskedSurveyNo(project, outcome.already, surveyNo);
    if (!answered) {
      res.status(409).json({ error: `The parcel for Sy. ${surveyNo} was taken off this project while it was being looked up. Read it again.` });
      return;
    }
    await store.save();
    res.json({
      read: answered,
      boundary: null,
      already: true,
      notEvidence: true,
      note:
        surveyNo.toUpperCase() === answered.surveyNo.toUpperCase()
          ? `Sy. ${answered.surveyNo} is already read.`
          : `Sy. ${surveyNo} is the parcel already read as Sy. ${answered.surveyNo}: the state’s map holds it under that number.`,
    });
    return;
  }
  // A parcel taken off the file while it was being read again stays off: the
  // person who removed it did so after this was asked for.
  if (again && !revenueReads(project).some((r) => r.parcelRef === again)) {
    res.status(409).json({ error: 'That parcel was taken off this project while it was being read again. It has not been put back.' });
    return;
  }
  // A record too heavy to send is a project nobody can open, so a read that would make it one is not kept. `full` tells
  // the picker that the numbers after this one would be turned away the same way, and need not be asked for.
  const room = roomForRead(project, outcome.read, again ? undefined : surveyNo);
  if (!room.fits) {
    res.status(507).json({ error: room.error, full: true });
    return;
  }
  const boundary = applyRevenueMap(project, outcome.read, actor, again ? undefined : surveyNo);
  const reads = revenueReads(project);
  const read = reads.find((r) => r.parcelRef === outcome.read.parcelRef) ?? outcome.read;
  // A read a person asked for on its own is one line in the thread the
  // copilot reads, as any edit made in a pane is. A run of numbers from one
  // press would be a dozen pairs of them, burying what was said there; the
  // audit entry each read leaves is the record of it.
  if (body.several !== true) {
    noteProjectEdit(project, `Read the revenue map for Sy. ${read.surveyNo}, ${[read.village, read.mandal].filter(Boolean).join(', ')}.`, { actor });
  }
  await store.save();
  const supplied = project.surveyBoundary && project.surveyBoundary.source !== 'revenue_map';
  res.json({
    read,
    boundary,
    notEvidence: true,
    note: boundary
      ? reads.length === 1
        ? 'Parcel from the revenue map is now the project boundary. A machine-read record, not a survey; attach the extract to file it as evidence.'
        : `Sy. ${reads[0].surveyNo} from the revenue map is the project boundary, and the other parcels are drawn beside it. A machine-read record, not a survey; attach the extract to file it as evidence.`
      : supplied
        ? `Revenue map read. Your uploaded outline stays as the boundary; the register’s parcel${reads.length === 1 ? ' is' : 's are'} compared against it below.`
        : `Sy. ${read.surveyNo} is kept with the other parcels. A machine-read record, not a survey; attach the extract to file it as evidence.`,
  });
});

/**
 * File the current revenue-map read on the evidence register. A person's
 * decision, made from the Site tab; the read itself stays a record.
 */
projectGisOverlayRouter.post<ProjectParams>('/revenue/file', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await asStoredNow(project.id);
  try {
    const before = project.evidence.length;
    const record = fileRevenueMapAsEvidence(project, actorOf(principalOf(req)));
    if (project.evidence.length > before) {
      noteProjectEdit(project, `Filed the revenue-map read for Sy. ${project.revenueMap?.surveyNo} as evidence.`, { citedEvidenceIds: [record.id], actor: actorOf(principalOf(req)) });
      await store.save();
    }
    res.status(201).json({ evidence: record, project });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not file the read' });
  }
});

/** Take one parcel's read off the project. The others, and what they add up to, stay. */
projectGisOverlayRouter.delete<ParcelParams>('/revenue/:parcelRef', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await asStoredNow(project.id);
  const read = revenueReads(project).find((r) => r.parcelRef === req.params.parcelRef);
  if (!read || !removeRevenueMapRead(project, read.parcelRef, actorOf(principalOf(req)))) {
    res.status(404).json({ error: 'No read of that parcel is kept on this project.' });
    return;
  }
  noteProjectEdit(project, `Removed the revenue-map read for Sy. ${read.surveyNo}.`, { actor: actorOf(principalOf(req)) });
  await store.save();
  res.status(204).end();
});

projectGisOverlayRouter.delete<ProjectParams>('/revenue', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await asStoredNow(project.id);
  const kept = revenueReads(project).length;
  clearRevenueMap(project, actorOf(principalOf(req)));
  // Cleared already, by another instance or by the code before this: there is nothing to say was done here.
  if (kept) noteProjectEdit(project, kept > 1 ? `Cleared the ${kept} revenue-map reads.` : 'Cleared the revenue-map read.', { actor: actorOf(principalOf(req)) });
  await store.save();
  res.status(204).end();
});

projectGisOverlayRouter.put<ProjectParams>('/survey', async (req, res) => {
  const project = findProject(req.params.projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const body = req.body as { fileText?: string; note?: string } | undefined;
  const fileText = typeof body?.fileText === 'string' ? body.fileText : '';
  if (!fileText.trim()) {
    res.status(400).json({ error: 'Upload a surveyor\'s GeoJSON or KML. A mouse-drawn shape is not a survey.' });
    return;
  }
  try {
    const boundary = applySurveyBoundary(project, fileText, body?.note, actorOf(principalOf(req)));
    noteProjectEdit(project, 'Supplied a survey outline for the GIS overlay.', { actor: actorOf(principalOf(req)) });
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
  clearSurveyBoundary(project, actorOf(principalOf(req)));
  noteProjectEdit(project, 'Cleared the supplied survey outline.', { actor: actorOf(principalOf(req)) });
  await store.save();
  res.status(204).end();
});
