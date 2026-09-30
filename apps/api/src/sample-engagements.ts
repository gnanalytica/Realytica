/**
 * The labelled sample engagements, built ready to demo.
 *
 * Three files at three points in a firm's pipeline:
 *
 * - SAMPLE-1, Whitefield: the bundled demo documents are read onto it the way
 *   an upload is, with no model, so every fact, check value and document
 *   finding on it came off a page the reader read. Analysis stage.
 * - SAMPLE-2, Harohalli: a township under construction with several
 *   assessments and an issued red flag report. Review stage.
 * - SAMPLE-3, Koramangala: an acquisition screen waiting on documents.
 *   Documents stage.
 *
 * Everything on them is illustrative and each is flagged `sample`, so every
 * surface badges it. People who do not exist are named by role with
 * "(sample)" after them rather than given invented names.
 */

import { randomUUID } from 'node:crypto';
import {
  addEvidence,
  addRequest,
  applyProjectChat,
  createValuationRun,
  generateReport,
  issueReport,
  recordCheckFields,
  recordCheckResult,
  refreshProjectDerived,
  screenProject,
  seedBdaReferenceProject,
  seedDemoProject,
  seedWhitefieldSample,
  setReportBlockState,
  type ChatIngestFile,
  type CheckInstance,
  type CreateRequestInput,
  type DdProject,
  type GeneratedReport,
  type ReportSectionState,
} from '@realytica/shared';
import { readIngestLocally } from './documents/intake';
import { loadSampleDocuments } from './documents/samples';
import { storageAdapter } from './storage';
import { documentKey } from './storage/types';

const DAY = 86_400_000;

function dayOffset(days: number, now: number): string {
  return new Date(now + days * DAY).toISOString().slice(0, 10);
}

function instantOffset(days: number, now: number): string {
  return new Date(now + days * DAY).toISOString();
}

function checkByDefinition(project: DdProject, definitionId: string): CheckInstance | undefined {
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      const found = scope.checks.find((c) => c.definitionId === definitionId || c.definitionId.endsWith(`.${definitionId}`));
      if (found) return found;
    }
  }
  return undefined;
}

/** A request, sent some days ago and due some days from now. */
function sentRequest(
  project: DdProject,
  input: Omit<CreateRequestInput, 'send' | 'dueAt'> & { sentDaysAgo: number; dueInDays: number },
  actor: string,
  now: number,
): void {
  const request = addRequest(project, { ...input, dueAt: dayOffset(input.dueInDays, now), send: true }, actor);
  request.sentAt = instantOffset(-input.sentDaysAgo, now);
}

function markSections(report: GeneratedReport | undefined, states: ReportSectionState[], project: DdProject, actor: string): void {
  if (!report) return;
  report.body.blocks.slice(0, states.length).forEach((block, i) => {
    setReportBlockState(project, report.id, block.id, states[i]!, actor);
  });
}

/**
 * Read the bundled demo documents onto a project, as an upload would be read.
 *
 * Stored, read locally (text layer, OCR where needed), offered as cards by the
 * chat, and approved: the same path a person takes with "Use the sample
 * documents" and "Approve all", run on the server so the sample arrives ready.
 */
async function fileSampleDocuments(project: DdProject, actor: string): Promise<number> {
  const files = await loadSampleDocuments();
  const ingest: ChatIngestFile[] = [];
  for (const file of files) {
    const storageKey = documentKey({ id: randomUUID(), fileName: file.originalname });
    await storageAdapter.putDocument(project.id, storageKey, file.buffer, file.mimetype);
    ingest.push(
      await readIngestLocally(
        { fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey },
        file.buffer,
      ),
    );
  }
  if (!ingest.length) return 0;
  applyProjectChat(project, 'Read these documents', { actor, ingest });
  applyProjectChat(project, 'Approve all', { actor });
  return ingest.length;
}

async function whitefield(now: number): Promise<DdProject> {
  const actor = 'Sample engineer';
  const project = seedWhitefieldSample();
  await fileSampleDocuments(project, actor);
  // The screen, from what the documents state: completeness, the Karnataka
  // title checks and the document risks. It gives no value.
  screenProject(project, actor);

  // The engineer's calls on three checks, from what the documents state.
  const filed = (pattern: RegExp) => project.evidence.find((e) => e.attachments.some((a) => pattern.test(a.fileName)))?.id;
  const cite = (...patterns: RegExp[]) => patterns.map(filed).filter((id): id is string => Boolean(id));
  const ruling: Array<[string, Parameters<typeof recordCheckResult>[2]]> = [
    [
      'title_chain',
      {
        result: 'compliant',
        comments: 'Registered chain from the 1998 mother deed to the 2019 sale deed, with no gap in the lookback.',
        evidenceIds: cite(/mother_deed/i, /sale_deed/i),
        createFinding: false,
      },
    ],
    [
      'encumbrances',
      {
        result: 'non_compliant',
        comments: 'The EC shows a mortgage still subsisting. Release deed and no-dues letter requested from the vendor.',
        evidenceIds: cite(/encumbrance/i),
        createFinding: false,
      },
    ],
    [
      'parcel_identification',
      {
        result: 'partially_compliant',
        comments: 'Survey number agrees throughout. The khata records 11,850 sqm against 12,000 sqm on the title; explanation requested.',
        evidenceIds: cite(/sale_deed/i, /khata/i, /survey_sketch/i),
        createFinding: false,
      },
    ],
  ];
  for (const [definition, input] of ruling) {
    const check = checkByDefinition(project, definition);
    if (check) recordCheckResult(project, check.id, input, actor);
  }

  // A land rate a person recorded against a schedule, so the Value tab has a
  // figure to show. The schedule says it is illustrative.
  const schedule = addEvidence(
    project,
    {
      title: 'Land comparables, sample schedule',
      kind: 'market_comparable',
      status: 'received',
      source: 'Sample engagement',
      description: 'Illustrative land sales around Whitefield, adjusted to the subject, for the demo. Not market data.',
    },
    actor,
  );
  const costs = checkByDefinition(project, 'cost_inputs');
  if (costs) {
    recordCheckFields(project, costs.id, { land_rate_per_sqm: 45_000 }, actor, schedule.id);
    createValuationRun(project, actor);
  }

  sentRequest(
    project,
    {
      title: 'Release deed and no-dues letter for the subsisting mortgage',
      recipient: "Vendor's advocate (sample)",
      recipientRole: "Owner's advocate",
      sentDaysAgo: 6,
      dueInDays: 2,
    },
    actor,
    now,
  );
  sentRequest(
    project,
    {
      title: 'Why the khata records 11,850 sqm against 12,000 sqm on the title',
      recipient: 'BBMP revenue office (sample)',
      sentDaysAgo: 3,
      dueInDays: 9,
    },
    actor,
    now,
  );
  // One already answered, by the document that came back.
  const sketch = project.evidence.find((e) => e.attachments.some((a) => /survey_sketch/i.test(a.fileName)));
  if (sketch) {
    const answered = addRequest(
      project,
      { title: 'Survey sketch 11E for Sy. 118/2', recipient: 'Licensed surveyor (sample)', recipientRole: 'Surveyor', dueAt: dayOffset(-3, now), send: true },
      actor,
    );
    answered.sentAt = instantOffset(-11, now);
    answered.status = 'answered';
    answered.answeredByEvidenceId = sketch.id;
    answered.answeredAt = instantOffset(-5, now);
  }

  const report = generateReport(project, { kind: 'executive_dd', generatedBy: actor }, actor);
  markSections(report, ['approved', 'approved', 'checked'], project, actor);

  project.engagement = { ...project.engagement!, dueDate: dayOffset(12, now) };
  return project;
}

function harohalli(now: number): DdProject {
  const actor = 'Asha Menon';
  const project = seedDemoProject();
  project.reference = 'SAMPLE-2';
  sentRequest(
    project,
    {
      title: 'RA bill #8 with the measurement book',
      recipient: "Contractor's site team (sample)",
      recipientRole: 'Contractor',
      sentDaysAgo: 2,
      dueInDays: 3,
    },
    actor,
    now,
  );
  sentRequest(
    project,
    {
      title: 'Revised fire detail for Tower A, level 8',
      recipient: 'Project architect (sample)',
      recipientRole: 'Architect',
      sentDaysAgo: 9,
      dueInDays: -2,
    },
    actor,
    now,
  );
  // The red flag report went out; the executive report is being checked.
  const redFlag = project.reports.find((r) => r.kind === 'red_flag');
  if (redFlag) {
    markSections(redFlag, redFlag.body.blocks.map(() => 'approved' as const), project, actor);
    issueReport(project, redFlag.id, actor, { name: 'Asha Menon', role: 'Engagement lead (sample)' });
  }
  markSections(project.reports.find((r) => r.kind === 'executive_dd'), ['approved', 'checked'], project, actor);
  project.engagement = {
    stage: 'review',
    client: 'Sample developer',
    lead: actor,
    scope: 'Construction-stage technical DD and progress',
    dueDate: dayOffset(5, now),
  };
  return project;
}

function koramangala(now: number): DdProject {
  const actor = 'Asha Menon';
  const project = seedBdaReferenceProject();
  project.reference = 'SAMPLE-3';
  sentRequest(
    project,
    {
      title: 'Encumbrance certificate, 2001 to 2026',
      recipient: "Seller's advocate (sample)",
      recipientRole: "Owner's advocate",
      sentDaysAgo: 1,
      dueInDays: 7,
    },
    actor,
    now,
  );
  // Drafted, not yet sent: what a lead has lined up.
  addRequest(
    project,
    {
      title: 'RMP 2015 land-use extract for planning districts 207 and 208',
      recipient: 'BDA town planning office (sample)',
      dueAt: dayOffset(10, now),
    },
    actor,
  );
  project.engagement = {
    stage: 'documents',
    client: 'Sample purchaser',
    lead: actor,
    scope: 'Land acquisition screening',
    dueDate: dayOffset(20, now),
  };
  return project;
}

export const SAMPLE_REFERENCES = ['SAMPLE-1', 'SAMPLE-2', 'SAMPLE-3'] as const;

/**
 * Build the samples named, ready to demo. Reads the Whitefield documents, so
 * it takes a few seconds; nothing is stored until the caller saves.
 */
export async function buildSampleEngagements(
  only: readonly string[] = SAMPLE_REFERENCES,
  now = Date.now(),
): Promise<DdProject[]> {
  const out: DdProject[] = [];
  if (only.includes('SAMPLE-1')) out.push(await whitefield(now));
  if (only.includes('SAMPLE-2')) out.push(harohalli(now));
  if (only.includes('SAMPLE-3')) out.push(koramangala(now));
  for (const project of out) refreshProjectDerived(project);
  return out;
}
