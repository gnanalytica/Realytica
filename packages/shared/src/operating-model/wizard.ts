/**
 * Project chat wizard — the guided, manual-first path through a DD engagement.
 *
 * Proposals are the acting half: the person approves, then registers and the
 * graph update. A model may later paraphrase the same guide; it never commits.
 */

import { attachEvidenceFile, commitAiDraft, createValuationRun, patchProject, snapshotCapabilities } from './capabilities';
import { screenProject } from './project-screen';
import { DD_TYPE_DEFINITIONS } from './libraries';
import {
  addAction,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  addScopeToAssessment,
  assessmentProgress,
  changeStage,
  createAssessment,
  ensureProjectShape,
  generateReport,
  patchAsset,
  recommendedDdTypes,
  updateEvidenceStatus,
} from './operations';
import { LIFECYCLE_STAGE_LABEL, LIFECYCLE_STAGES, REPORT_KIND_LABEL, SCOPE_LABEL } from './catalogs';
import { mergeQuoteLists, proposalExtractionNotes, proposalQuotes, sittingCheckOf, type SittingRef } from './sitting';
import type {
  ChatIngestFile,
  ChatProposal,
  ChatProposalKind,
  CreateActionInput,
  CreateAssessmentInput,
  CreateAssetInput,
  CreateDecisionInput,
  CreateEvidenceInput,
  CreateFindingInput,
  CreateRiskInput,
  DdProject,
  DdTypeDefinition,
  DdTypeKey,
  EvidenceKind,
  EvidenceRecord,
  LifecycleStage,
  PatchAssetInput,
  PatchProjectInput,
  ProjectArchetype,
  ReportKind,
  ScopeKey,
} from './types';
import { connectorEvidenceInput } from './chat-sides';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

const ASSET_HINTS: Record<ProjectArchetype, Array<{ name: string; assetType: string }>> = {
  residential: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Tower A', assetType: 'Residential tower' },
    { name: 'Podium / amenities', assetType: 'Podium' },
    { name: 'Clubhouse', assetType: 'Amenity' },
    { name: 'Infrastructure', assetType: 'Infrastructure' },
  ],
  commercial: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Office tower', assetType: 'Office' },
    { name: 'Retail podium', assetType: 'Retail' },
    { name: 'Parking', assetType: 'Parking' },
  ],
  mixed_use: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Residential tower', assetType: 'Residential tower' },
    { name: 'Office / commercial', assetType: 'Office' },
    { name: 'Retail', assetType: 'Retail' },
    { name: 'Podium', assetType: 'Podium' },
  ],
  industrial: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Warehouse / shed', assetType: 'Industrial shed' },
    { name: 'Utility block', assetType: 'Utilities' },
  ],
  logistics: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Warehouse', assetType: 'Warehouse' },
    { name: 'Yard / circulation', assetType: 'Yard' },
  ],
  hospitality: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Hotel building', assetType: 'Hotel' },
    { name: 'F&B / banquet', assetType: 'Amenity' },
  ],
  healthcare: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Hospital block', assetType: 'Hospital' },
    { name: 'Diagnostics / OPD', assetType: 'Clinical' },
  ],
  institutional: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Main building', assetType: 'Institutional' },
    { name: 'Ancillary', assetType: 'Ancillary' },
  ],
  large_campus: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Phase 1 buildings', assetType: 'Campus buildings' },
    { name: 'Infrastructure', assetType: 'Infrastructure' },
  ],
  specialized: [
    { name: 'Land parcel', assetType: 'Land' },
    { name: 'Primary facility', assetType: 'Specialized' },
  ],
};

type FileHint = { keys: string[]; kind: EvidenceKind; scopes: ScopeKey[]; titles: string[] };

const FILE_HINTS: FileHint[] = [
  { keys: ['title', 'deed', 'khata', 'encumbrance', 'mother deed', 'sale deed', 'partition'], kind: 'document', scopes: ['legal'], titles: ['Title extract', 'Sale deeds', 'Title chain', 'Encumbrance certificates'] },
  { keys: ['survey', 'cadastral', 'boundary', 'topo', 'total station'], kind: 'gis', scopes: ['land_site'], titles: ['Survey plans', 'Cadastral maps', 'Boundary survey', 'Topo survey'] },
  { keys: ['master plan', 'rmp', 'zoning', 'land use map', 'town plan'], kind: 'gis', scopes: ['regulatory', 'land_site'], titles: ['Master plan extract', 'Zoning certificate'] },
  { keys: ['soil', 'geotech', 'borelog'], kind: 'test_report', scopes: ['land_site', 'technical'], titles: ['Soil report'] },
  { keys: ['sanction', 'layout plan', 'building plan', 'approved drawing', 'dr-'], kind: 'drawing', scopes: ['regulatory', 'technical'], titles: ['Sanction drawings', 'Sanctioned layout', 'Layout plan'] },
  { keys: ['fire noc', 'fire', 'life safety'], kind: 'approval', scopes: ['regulatory', 'hse'], titles: ['Fire NOC'] },
  { keys: ['ec ', 'environment', 'eia'], kind: 'approval', scopes: ['regulatory', 'esg'], titles: ['EC'] },
  { keys: ['commencement', 'cc ', 'occupancy', 'oc '], kind: 'approval', scopes: ['regulatory'], titles: ['Commencement certificate', 'CC / OC'] },
  { keys: ['boq', 'bill of quantity', 'cost plan', 'budget'], kind: 'boq', scopes: ['cost_quantity'], titles: ['BOQ', 'Cost plans'] },
  { keys: ['programme', 'gantt', 'schedule', 'progress report'], kind: 'schedule', scopes: ['schedule_progress'], titles: ['Contractor programme', 'Progress reports'] },
  { keys: ['photo', 'jpg', 'jpeg', 'png', 'site image'], kind: 'photograph', scopes: ['land_site', 'technical', 'quality'], titles: ['Site photographs', 'Site photos'] },
  { keys: ['invoice', 'payment certificate'], kind: 'invoice', scopes: ['cost_quantity', 'procurement'], titles: ['Invoices', 'Payment certificates'] },
  { keys: ['contract', 'agreement', 'jda', 'jv '], kind: 'contract', scopes: ['legal', 'procurement'], titles: ['Contracts', 'JV/JDA'] },
  { keys: ['inspection', 'ncr', 'itp'], kind: 'inspection', scopes: ['quality', 'hse'], titles: ['Inspection pack'] },
  { keys: ['test report', 'cube', 'ndt'], kind: 'test_report', scopes: ['quality', 'technical'], titles: ['Test reports'] },
];

export function createChatProposal(
  kind: ChatProposalKind,
  title: string,
  rationale: string,
  impact: string,
  payload: Record<string, unknown>,
  actor: string,
  extra: Partial<ChatProposal> = {},
): ChatProposal {
  return proposal(kind, title, rationale, impact, payload, actor, extra);
}

function proposal(
  kind: ChatProposalKind,
  title: string,
  rationale: string,
  impact: string,
  payload: Record<string, unknown>,
  actor: string,
  extra: Partial<ChatProposal> = {},
): ChatProposal {
  return {
    id: id('prp'),
    kind,
    title,
    rationale,
    impact,
    status: 'proposed',
    payload,
    createdAt: nowIso(),
    createdBy: actor,
    citedEvidenceIds: extra.citedEvidenceIds,
    citedNodeIds: extra.citedNodeIds,
  };
}

function alreadyPresent(project: DdProject, hint: { name: string; assetType: string }): boolean {
  const n = hint.name.toLowerCase();
  const t = hint.assetType.toLowerCase();
  return project.assets.some(
    (a) =>
      a.name.toLowerCase().includes(n.split(' ')[0] ?? n) ||
      a.assetType.toLowerCase().includes(t) ||
      n.includes(a.name.toLowerCase()),
  );
}

export function suggestedAssets(project: DdProject): Array<{ name: string; assetType: string }> {
  return (ASSET_HINTS[project.type] ?? ASSET_HINTS.specialized).filter((h) => !alreadyPresent(project, h));
}

/** Stage of the project plus any asset that has moved ahead (e.g. a tower already in construction). */
export function recommendedDdTypesForProject(project: DdProject): DdTypeDefinition[] {
  const stages = new Set<LifecycleStage>([project.currentStage, ...project.assets.map((a) => a.currentStage)]);
  const seen = new Set<DdTypeKey>();
  const out: DdTypeDefinition[] = [];
  for (const stage of stages) {
    for (const def of recommendedDdTypes(stage)) {
      if (seen.has(def.key)) continue;
      seen.add(def.key);
      out.push(def);
    }
  }
  return out;
}

export function missingProjectFields(project: DdProject): string[] {
  const missing: string[] = [];
  if (!project.owner) missing.push('owner / DD lead');
  if (!project.jurisdiction) missing.push('jurisdiction');
  if (!project.landAreaSqm) missing.push('land area (sqm)');
  if (!project.builtUpAreaSqm) missing.push('built-up area (sqm)');
  if (!project.budget) missing.push('budget');
  if (!project.siteAddress && !project.location) missing.push('site address');
  return missing;
}

function activeAssessments(project: DdProject) {
  return project.assessments.filter((a) => a.status !== 'archived');
}

function openGaps(project: DdProject): EvidenceRecord[] {
  return project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
}

export function proposeReportCard(project: DdProject, actor = 'operator'): ChatProposal | undefined {
  const owner = project.owner || actor;
  const material = project.findings.filter(
    (f) => (f.status === 'open' || f.status === 'under_review') && (f.severity === 'high' || f.severity === 'critical'),
  );
  if (!material.length) return undefined;
  const kind: ReportKind = material.some((f) => f.severity === 'critical') ? 'red_flag' : 'executive_dd';
  return proposal(
    'generate_report',
    `Generate ${REPORT_KIND_LABEL[kind]}`,
    `There are ${material.length} material open finding(s). A ${REPORT_KIND_LABEL[kind].toLowerCase()} pulls live registers and cites the evidence each finding rests on.`,
    'Creates a report from current findings, risks, actions and evidence. It does not freeze the registers.',
    { kind, generatedBy: owner, assessmentIds: activeAssessments(project).map((a) => a.id) },
    actor,
    { citedNodeIds: material.slice(0, 6).map((f) => f.id) },
  );
}

export function buildWizardProposals(project: DdProject, actor = 'operator'): ChatProposal[] {
  ensureProjectShape(project);
  const out: ChatProposal[] = [];
  const owner = project.owner || actor;

  const hint = suggestedAssets(project)[0];
  if (hint) {
    out.push(
      proposal(
        'add_asset',
        `Add asset: ${hint.name}`,
        `A ${project.type.replaceAll('_', ' ')} project at ${LIFECYCLE_STAGE_LABEL[project.currentStage]} usually records ${hint.assetType.toLowerCase()} as its own asset so DDs can target it.`,
        'Creates an asset node. Later DDs can target it instead of the whole project.',
        { name: hint.name, assetType: hint.assetType } satisfies CreateAssetInput,
        actor,
      ),
    );
  }

  const running = new Set(activeAssessments(project).map((a) => a.ddType));
  const recommended = recommendedDdTypesForProject(project).filter((d) => d.key !== 'custom' && d.key !== 'full_project_health' && !running.has(d.key));
  for (const dd of recommended.slice(0, 2)) {
    if (out.length >= 3) break;
    out.push(
      proposal(
        'start_dd',
        `Start ${dd.label}`,
        `${dd.purpose} Default scopes: ${dd.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ')}.`,
        `Instantiates ${dd.defaultScopes.length} scopes and their checks, and seeds expected evidence into the project register. Does not run a model.`,
        {
          ddType: dd.key,
          owner,
          targetType: 'project',
          name: dd.label,
        } satisfies CreateAssessmentInput,
        actor,
      ),
    );
  }

  const report = proposeReportCard(project, actor);
  if (out.length < 3 && report && !project.reports.some((r) => r.kind === 'red_flag' || r.kind === 'executive_dd')) {
    out.push(report);
  }

  return out.slice(0, 3);
}

function scoreHint(haystack: string, hint: FileHint): number {
  let score = 0;
  for (const key of hint.keys) {
    if (haystack.includes(key)) score += key.length > 6 ? 3 : 2;
  }
  return score;
}

export function classifyIngestFile(
  project: DdProject,
  file: ChatIngestFile,
  prefer?: SittingRef,
): { hint: FileHint; evidence?: EvidenceRecord; assessmentIds: string[]; scopeInstanceIds: string[]; checkIds: string[] } {
  const hay = `${file.fileName.replace(/[_-]+/g, ' ')} ${file.excerpt ?? ''} ${file.extractionNotes ?? ''} ${file.kindHint ?? ''}`.toLowerCase();
  let best: FileHint = { keys: [], kind: 'document', scopes: [], titles: ['Uploaded document'] };
  let bestScore = 0;
  for (const hint of FILE_HINTS) {
    const s = scoreHint(hay, hint);
    if (s > bestScore) {
      best = hint;
      bestScore = s;
    }
  }

  const gaps = openGaps(project);
  let byTitle = gaps.find((g) => hay.includes(g.title.toLowerCase()) || best.titles.some((t) => g.title.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(g.title.toLowerCase())));
  const assessmentIds = new Set<string>(byTitle?.assessmentIds ?? []);
  const scopeInstanceIds = new Set<string>(byTitle?.scopeInstanceIds ?? []);
  const checkIds = new Set<string>(byTitle?.checkIds ?? []);

  for (const assessment of activeAssessments(project)) {
    for (const scope of assessment.scopes) {
      if (best.scopes.includes(scope.scopeKey)) {
        assessmentIds.add(assessment.id);
        scopeInstanceIds.add(scope.id);
        for (const check of scope.checks) {
          if (check.expectedEvidence.some((t) => hay.includes(t.toLowerCase()) || best.titles.some((bt) => t.toLowerCase().includes(bt.toLowerCase())))) {
            checkIds.add(check.id);
          }
        }
      }
    }
  }

  const sitting = sittingCheckOf(project, prefer);
  if (sitting) {
    assessmentIds.add(sitting.assessment.id);
    scopeInstanceIds.add(sitting.scope.id);
    const ordered = [sitting.check.id, ...[...checkIds].filter((id) => id !== sitting.check.id)];
    checkIds.clear();
    for (const id of ordered.slice(0, 12)) checkIds.add(id);
    const expected = sitting.check.expectedEvidence.map((t) => t.toLowerCase());
    const sittingGap = gaps.find(
      (e) =>
        sitting.check.evidenceIds.includes(e.id)
        || e.checkIds.includes(sitting.check.id)
        || expected.some((t) => e.title.toLowerCase().includes(t) || t.includes(e.title.toLowerCase())),
    );
    if (sittingGap) byTitle = sittingGap;
  }

  return {
    hint: best,
    evidence: byTitle,
    assessmentIds: [...assessmentIds],
    scopeInstanceIds: [...scopeInstanceIds],
    checkIds: [...checkIds].slice(0, 12),
  };
}

function ingestRationale(file: ChatIngestFile, target: string, scopeNames: string[]): string {
  const quotes = (file.quotes ?? [])
    .slice(0, 3)
    .map((q) => (q.page ? `“${q.text}” (p.${q.page})` : `“${q.text}”`))
    .join('; ');
  const notes = file.extractionNotes?.trim();
  return [
    `${target} Matched scopes: ${scopeNames.join(', ') || 'none yet — will still land on the project register'}.`,
    quotes ? `From the file: ${quotes}.` : null,
    notes ? notes.slice(0, 400) : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function proposalsFromIngest(
  project: DdProject,
  files: ChatIngestFile[],
  actor = 'operator',
  prefer?: SittingRef,
): ChatProposal[] {
  ensureProjectShape(project);
  const out: ChatProposal[] = [];
  for (const file of files) {
    const classified = classifyIngestFile(project, file, prefer);
    const target = classified.evidence
      ? `File against existing expected item “${classified.evidence.title}” (${classified.evidence.status}).`
      : `Create a new evidence row (${classified.hint.kind}) and link it to matching DD scopes.`;
    const scopeNames = [...new Set(
      project.assessments.flatMap((a) =>
        a.scopes.filter((s) => classified.scopeInstanceIds.includes(s.id)).map((s) => SCOPE_LABEL[s.scopeKey]),
      ),
    )];
    out.push(
      proposal(
        'file_evidence',
        `File “${file.fileName}” → ${classified.evidence?.title ?? classified.hint.titles[0] ?? 'new evidence'}`,
        ingestRationale(file, target, scopeNames),
        classified.evidence
          ? 'Marks the expected item received, attaches the file, links checks that named this evidence, and the graph edge appears.'
          : 'Creates evidence, links to matching assessments/scopes, and expected-evidence completeness updates.',
        {
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: file.storageKey,
          excerpt: file.excerpt,
          kind: classified.hint.kind,
          title: classified.evidence?.title ?? file.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          evidenceId: classified.evidence?.id,
          assessmentIds: classified.assessmentIds,
          scopeInstanceIds: classified.scopeInstanceIds,
          checkIds: classified.checkIds,
          checkId: classified.checkIds[0],
          quotes: file.quotes,
          extractionNotes: file.extractionNotes,
        },
        actor,
        {
          citedEvidenceIds: classified.evidence ? [classified.evidence.id] : undefined,
          citedNodeIds: [...classified.checkIds.slice(0, 2), ...classified.assessmentIds.slice(0, 2)],
        },
      ),
    );
  }
  return out;
}

function bytesToLatin1(bytes: Uint8Array): string {
  const sample = bytes.length > 80_000 ? bytes.subarray(0, 80_000) : bytes;
  let out = '';
  for (let i = 0; i < sample.length; i += 1) out += String.fromCharCode(sample[i]!);
  return out;
}

export function extractReadableExcerpt(bytes: Uint8Array, mimeType: string, fileName: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith('text/') || lower.includes('json') || fileName.toLowerCase().endsWith('.csv')) {
    return bytesToLatin1(bytes).slice(0, 4000);
  }
  if (lower.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
    const raw = bytesToLatin1(bytes);
    const parts: string[] = [];
    const re = /\((?:\\.|[^\\)]){4,180}\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) && parts.length < 80) {
      const inner = m[0].slice(1, -1).replace(/\\[nrt]/g, ' ').replace(/\\(.)/g, '$1');
      if (/[A-Za-z]{3}/.test(inner)) parts.push(inner);
    }
    return parts.join(' ').slice(0, 4000);
  }
  return '';
}

export function commitChatProposal(project: DdProject, proposalId: string, actor = 'operator'): { proposal: ChatProposal; recordId?: string } {
  ensureProjectShape(project);
  const item = project.chatProposals.find((p) => p.id === proposalId);
  if (!item) throw new Error('Proposal not found');
  if (item.status === 'rejected') throw new Error('Rejected proposals cannot be committed');
  if (item.status === 'committed') return { proposal: item, recordId: item.committedRecordId };

  const payload = item.payload;
  let recordId: string | undefined;

  if (item.kind === 'add_asset') {
    const record = addAsset(project, payload as unknown as CreateAssetInput, actor);
    recordId = record.id;
  } else if (item.kind === 'start_dd') {
    const record = createAssessment(project, payload as unknown as CreateAssessmentInput, actor);
    recordId = record.id;
  } else if (item.kind === 'add_scope') {
    const record = addScopeToAssessment(project, String(payload.assessmentId), payload.scopeKey as ScopeKey, actor);
    recordId = record.id;
  } else if (item.kind === 'file_evidence') {
    const existingId = typeof payload.evidenceId === 'string' ? payload.evidenceId : undefined;
    let evidence = existingId ? project.evidence.find((e) => e.id === existingId) : undefined;
    if (!evidence) {
      evidence = addEvidence(
        project,
        {
          title: String(payload.title ?? payload.fileName ?? 'Uploaded document'),
          kind: (payload.kind as EvidenceKind) ?? 'document',
          source: String(payload.source ?? 'chat_upload'),
          status: (payload.status as CreateEvidenceInput['status']) ?? 'received',
          description: typeof payload.description === 'string' ? payload.description : undefined,
          fileName: payload.fileName ? String(payload.fileName) : undefined,
          assessmentIds: (payload.assessmentIds as string[]) ?? [],
          scopeInstanceIds: (payload.scopeInstanceIds as string[]) ?? [],
          checkIds: (payload.checkIds as string[]) ?? [],
        } satisfies CreateEvidenceInput,
        actor,
      );
    } else {
      for (const aid of (payload.assessmentIds as string[]) ?? []) {
        if (!evidence.assessmentIds.includes(aid)) evidence.assessmentIds.push(aid);
      }
      for (const sid of (payload.scopeInstanceIds as string[]) ?? []) {
        if (!evidence.scopeInstanceIds.includes(sid)) evidence.scopeInstanceIds.push(sid);
      }
      for (const cid of (payload.checkIds as string[]) ?? []) {
        if (!evidence.checkIds.includes(cid)) evidence.checkIds.push(cid);
      }
      if (evidence.status === 'expected' || evidence.status === 'missing' || evidence.status === 'requested') {
        updateEvidenceStatus(project, evidence.id, 'received', { considered: true }, actor);
      }
    }
    const quotes = proposalQuotes(payload);
    if (quotes.length) evidence.quotes = mergeQuoteLists(evidence.quotes, quotes);
    const notes = proposalExtractionNotes(payload);
    if (notes) evidence.extractionNotes = notes;
    if (payload.storageKey && payload.fileName) {
      attachEvidenceFile(
        project,
        evidence.id,
        {
          fileName: String(payload.fileName),
          mimeType: String(payload.mimeType ?? 'application/octet-stream'),
          sizeBytes: Number(payload.sizeBytes ?? 0),
          storageKey: String(payload.storageKey),
        },
        actor,
      );
    }
    for (const checkId of evidence.checkIds) {
      for (const assessment of project.assessments) {
        for (const scope of assessment.scopes) {
          const check = scope.checks.find((c) => c.id === checkId);
          if (check && !check.evidenceIds.includes(evidence.id)) check.evidenceIds.push(evidence.id);
        }
      }
    }
    recordId = evidence.id;
  } else if (item.kind === 'request_evidence' || item.kind === 'add_action') {
    const record = addAction(project, payload as unknown as CreateActionInput, actor);
    recordId = record.id;
  } else if (item.kind === 'add_finding') {
    const record = addFinding(project, payload as unknown as CreateFindingInput, actor);
    recordId = record.id;
  } else if (item.kind === 'generate_report') {
    const record = generateReport(
      project,
      {
        kind: payload.kind as ReportKind,
        assessmentIds: (payload.assessmentIds as string[]) ?? [],
        generatedBy: String(payload.generatedBy ?? actor),
      },
      actor,
    );
    recordId = record.id;
  } else if (item.kind === 'run_valuation') {
    const record = createValuationRun(project, actor);
    recordId = record.id;
  } else if (item.kind === 'run_screen') {
    const applied = screenProject(project, actor);
    recordId = applied.valuationId;
  } else if (item.kind === 'patch_project') {
    patchProject(project, payload as PatchProjectInput, actor);
    recordId = project.id;
  } else if (item.kind === 'patch_asset') {
    const record = patchAsset(project, String(payload.assetId), payload as PatchAssetInput, actor);
    recordId = record.id;
  } else if (item.kind === 'change_stage') {
    const record = changeStage(
      project,
      {
        subject: payload.subject === 'asset' ? 'asset' : 'project',
        assetId: typeof payload.assetId === 'string' ? payload.assetId : undefined,
        stage: payload.stage as LifecycleStage,
        reason: String(payload.reason ?? 'Updated from chat'),
      },
      actor,
    );
    recordId = record.assetId ?? project.id;
  } else if (item.kind === 'add_risk') {
    const record = addRisk(project, payload as unknown as CreateRiskInput, actor);
    recordId = record.id;
  } else if (item.kind === 'add_decision') {
    const record = addDecision(project, payload as unknown as CreateDecisionInput, actor);
    recordId = record.id;
  } else if (item.kind === 'open_connector') {
    const shaped = connectorEvidenceInput(payload, actor);
    const existingId = typeof payload.evidenceId === 'string' ? payload.evidenceId : undefined;
    let evidence = existingId ? project.evidence.find((e) => e.id === existingId) : undefined;
    if (!evidence) {
      evidence = addEvidence(project, shaped.evidence, actor);
    }
    const action = addAction(project, { ...shaped.action, evidenceIds: [evidence.id] }, actor);
    recordId = action.id;
  } else if (item.kind === 'commit_draft') {
    const ids = (payload.draftIds as string[]) ?? [];
    const last: string[] = [];
    for (const draftId of ids) {
      const committed = commitAiDraft(project, draftId, actor);
      if (committed.recordId) last.push(committed.recordId);
    }
    recordId = last[0];
  } else if (item.kind === 'snapshot_capabilities') {
    snapshotCapabilities(project, actor);
    recordId = project.id;
  }

  item.status = 'committed';
  item.committedRecordId = recordId;
  return { proposal: item, recordId };
}

export function rejectChatProposal(project: DdProject, proposalId: string): ChatProposal {
  ensureProjectShape(project);
  const item = project.chatProposals.find((p) => p.id === proposalId);
  if (!item) throw new Error('Proposal not found');
  if (item.status === 'committed') throw new Error('Committed proposals cannot be rejected');
  item.status = 'rejected';
  return item;
}

export function matchProposal(project: DdProject, question: string): ChatProposal | undefined {
  const open = project.chatProposals.filter((p) => p.status === 'proposed');
  const quoted = question.match(/["“]([^"”]+)["”]/);
  if (quoted) {
    const needle = quoted[1].toLowerCase();
    return open.find((p) => p.title.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle));
  }
  const q = question.toLowerCase();
  const byId = open.find((p) => q.includes(p.id.toLowerCase()));
  if (byId) return byId;
  let best: ChatProposal | undefined;
  let score = 0;
  for (const p of open) {
    const title = p.title.toLowerCase();
    if (q.includes(title)) return p;
    const tokens = title.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    const hits = tokens.filter((t) => q.includes(t)).length;
    if (hits > score) {
      best = p;
      score = hits;
    }
  }
  return score >= 2 ? best : undefined;
}

export function wantsWizard(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (q.length === 0) return true;
  return /^(hi|hello|hey|help|start|guide|wizard|next)\b/.test(q)
    || /\b(what should (i|we)|what do i|guide me|walk me|set up|next step|what.?s next|how do i start|suggest)\b/.test(q)
    || /\b(assets? to (add|create)|which dd|what scopes?|what.?s missing|gaps?)\b/.test(q);
}

export function wantsAssets(q: string): boolean {
  return /\bassets?\b/.test(q) && /\b(add|create|suggest|should|which|what)\b/.test(q);
}

export function wantsDdTypes(q: string): boolean {
  return /\b(dd types?|assessments?|due diligence)\b/.test(q) && /\b(start|add|create|suggest|which|what|recommend)\b/.test(q);
}

export function wantsScopes(q: string): boolean {
  return /\bscopes?\b/.test(q);
}

export function wantsReport(q: string): boolean {
  return /\breports?\b/.test(q) || /\bred flag\b/.test(q) || /\bexecutive (dd|report)\b/.test(q);
}

export function wantsProofs(q: string): boolean {
  return /\bproofs?\b/.test(q) || /\bcite\b/.test(q) || /\bwhat supports\b/.test(q) || /\bevidence for\b/.test(q);
}

export function wantsApprove(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (/^(yes|ok|okay|do it|go ahead)([.! ]|$)/.test(t)) return true;
  if (/\bapprove(\s+all)?\b/.test(t)) return true;
  if (/^(accept|commit)\b/.test(t)) return true;
  return /\b(accept|commit) (this|all|the|it)\b/.test(t);
}

export function wantsReject(q: string): boolean {
  return /\b(reject|skip|dismiss|no thanks)\b/.test(q);
}

function looksLikeInquiry(question: string): boolean {
  const t = question.trim().toLowerCase();
  if (!t || /\?$/.test(t)) return true;
  if (/^(what|which|who|how|why|where|guide|help|hi|hello|hey|next)\b/.test(t)) return true;
  if (/\b(should i|do i need|can you (guide|suggest|recommend)|what.?s missing|walk me)\b/.test(t)) return true;
  return false;
}

function isImperative(question: string): boolean {
  const t = question.trim().toLowerCase();
  return /^(set|update|change|add|create|record|patch|put|rename|move|mark|file|log|raise)\b/.test(t)
    || /\bplease (set|add|update|create|record|change)\b/.test(t);
}

function clipPhrase(raw: string): string {
  return raw
    .replace(/["“”']/g, '')
    .replace(/\s+(and then|and also|, and|, then)\b[\s\S]*/i, '')
    .replace(/[.?!;].*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(raw: string): number | undefined {
  const n = Number(raw.replace(/,/g, '').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function toSqm(n: number, unit?: string): number {
  const u = (unit ?? 'sqm').toLowerCase();
  if (/acre/.test(u)) return Math.round(n * 4046.8564224);
  if (/^ha|hectare/.test(u)) return Math.round(n * 10_000);
  return Math.round(n);
}

function toMoney(n: number, unit?: string): number {
  const u = (unit ?? '').toLowerCase();
  if (/cr|crore/.test(u)) return n * 10_000_000;
  if (/lakh/.test(u)) return n * 100_000;
  if (/million|\bmn\b/.test(u)) return n * 1_000_000;
  return n;
}

function inferAssetType(name: string, extra = ''): string {
  const h = `${name} ${extra}`.toLowerCase();
  if (/\bland|parcel|plot\b/.test(h)) return 'Land';
  if (/\btower|block\b/.test(h)) return 'Residential tower';
  if (/\bclubhouse|amenity\b/.test(h)) return 'Amenity';
  if (/\bpodium\b/.test(h)) return 'Podium';
  if (/\bwarehouse|shed\b/.test(h)) return 'Warehouse';
  if (/\boffice\b/.test(h)) return 'Office';
  if (/\bhotel\b/.test(h)) return 'Hotel';
  if (/\bparking\b/.test(h)) return 'Parking';
  if (/\binfra|road|utility\b/.test(h)) return 'Infrastructure';
  return extra.trim() || 'Asset';
}

function matchStage(text: string): LifecycleStage | undefined {
  const t = text.toLowerCase();
  const byLabel = LIFECYCLE_STAGES.find((s) => t.includes(s.label.toLowerCase()) || t.includes(s.key.replaceAll('_', ' ')));
  return byLabel?.key;
}

function matchExistingAsset(project: DdProject, text: string) {
  const t = text.toLowerCase();
  return [...project.assets]
    .sort((a, b) => b.name.length - a.name.length)
    .find((a) => a.name.length >= 3 && t.includes(a.name.toLowerCase()));
}

function sameNumber(a: number | undefined, b: number): boolean {
  if (a == null) return false;
  return Math.abs(a - b) / Math.max(1, Math.abs(b)) < 0.01;
}

/**
 * Read a conversational turn as concrete add/edit work.
 * Returns cards; the caller decides whether to auto-commit (imperative) or wait for approve.
 */
export function interpretConversation(project: DdProject, question: string, actor = 'operator'): {
  proposals: ChatProposal[];
  imperative: boolean;
} {
  ensureProjectShape(project);
  const q = question.trim();
  if (looksLikeInquiry(q) || wantsApprove(q.toLowerCase()) || wantsReject(q.toLowerCase())) {
    return { proposals: [], imperative: false };
  }

  const out: ChatProposal[] = [];
  const patch: PatchProjectInput = {};
  const patchBits: string[] = [];
  const owner = project.owner || actor;

  const ownerHit = q.match(/\b(?:owner|dd lead|diligence lead|project lead)\b(?:\s+is|\s+as|:|\s+to)?\s+([^.\n]+)/i);
  if (ownerHit) {
    const next = clipPhrase(ownerHit[1] ?? '');
    if (next.length >= 2 && next.toLowerCase() !== (project.owner ?? '').toLowerCase()) {
      patch.owner = next;
      patchBits.push(`owner “${project.owner || 'blank'}” → “${next}”`);
    }
  }

  const developerHit = q.match(/\bdeveloper\b(?:\s+is|\s+as|:|\s+to)?\s+([^.\n]+)/i);
  if (developerHit) {
    const next = clipPhrase(developerHit[1] ?? '');
    if (next.length >= 2 && next.toLowerCase() !== (project.developer ?? '').toLowerCase()) {
      patch.developer = next;
      patchBits.push(`developer “${project.developer || 'blank'}” → “${next}”`);
    }
  }

  const cityHit = q.match(/\bcity\b(?:\s+is|:|\s+to)?\s+([A-Za-z .-]{2,40})/i);
  if (cityHit) {
    const next = clipPhrase(cityHit[1] ?? '');
    if (next && next.toLowerCase() !== project.city.toLowerCase()) {
      patch.city = next;
      patchBits.push(`city “${project.city}” → “${next}”`);
    }
  }

  const addressHit = q.match(/\b(?:site address|address)\b(?:\s+is|:|\s+to)?\s+([^.\n]+)/i);
  if (addressHit) {
    const next = clipPhrase(addressHit[1] ?? '');
    if (next.length >= 6 && next.toLowerCase() !== (project.siteAddress ?? '').toLowerCase()) {
      patch.siteAddress = next;
      patchBits.push('site address');
    }
  }

  const areaHit = q.match(
    /\b(land(?:\s+area)?|plot|site area|bua|built-?up(?:\s+area)?|saleable(?:\s+area)?)\b[^\d]{0,24}([\d,.]+)\s*(sq\.?\s*m|sqm|acres?|ha|hectares?)?/i,
  );
  const acresOnly = !areaHit ? q.match(/\b([\d,.]+)\s*(acres?)\b/i) : null;
  const areaSource = areaHit ?? (acresOnly ? (['land', acresOnly[1], acresOnly[2]] as string[]) : null);
  if (areaSource) {
    const label = String(areaSource[1] ?? 'land').toLowerCase();
    const n = parseNumber(String(areaSource[2] ?? ''));
    const unit = areaSource[3];
    if (n != null) {
      const sqm = toSqm(n, unit);
      if (/bua|built/.test(label)) {
        if (!sameNumber(project.builtUpAreaSqm, sqm)) {
          patch.builtUpAreaSqm = sqm;
          patchBits.push(`built-up ${project.builtUpAreaSqm ?? 'blank'} → ${sqm} sqm`);
        }
      } else if (/saleable/.test(label)) {
        if (!sameNumber(project.saleableAreaSqm, sqm)) {
          patch.saleableAreaSqm = sqm;
          patchBits.push(`saleable ${project.saleableAreaSqm ?? 'blank'} → ${sqm} sqm`);
        }
      } else if (!sameNumber(project.landAreaSqm, sqm)) {
        patch.landAreaSqm = sqm;
        patchBits.push(`land ${project.landAreaSqm ?? 'blank'} → ${sqm} sqm`);
      }
    }
  }

  const budgetHit = q.match(/\bbudget\b[^\d]{0,20}([\d,.]+)\s*(cr|crore|crores|lakh|lakhs|million|mn|inr)?/i);
  if (budgetHit) {
    const n = parseNumber(budgetHit[1] ?? '');
    if (n != null) {
      const money = toMoney(n, budgetHit[2]);
      if (!sameNumber(project.budget, money)) {
        patch.budget = money;
        patchBits.push(`budget ${project.budget ?? 'blank'} → ${money.toLocaleString()}`);
      }
    }
  }

  if (patchBits.length) {
    out.push(
      proposal(
        'patch_project',
        `Update ${patchBits.map((b) => b.split(' ')[0]).join(', ')}`,
        patchBits.join('; ') + '.',
        'Patches the project record. Valuation, reports and the work pane read these fields live.',
        patch as Record<string, unknown>,
        actor,
        { citedNodeIds: [project.id] },
      ),
    );
  }

  const addAssetHit = q.match(
    /\b(?:add|create|new)\s+(?:an?\s+)?(?:asset\s+)?(?:called\s+|named\s+)?["']?([A-Za-z0-9][A-Za-z0-9 ./-]{0,40}?)["']?(?:\s+as\s+(?:a\s+)?([A-Za-z ]{2,40}))?(?:\s+at\s+([A-Za-z /]+))?$/i,
  ) ?? q.match(/\badd\s+["']?([A-Za-z0-9][A-Za-z0-9 ./-]{1,40})["']?(?:\s*[—,-]\s*([A-Za-z ]{2,40}))?/i);
  if (addAssetHit) {
    const name = clipPhrase(addAssetHit[1] ?? '');
    const type = inferAssetType(name, addAssetHit[2] ?? '');
    const stage = matchStage(addAssetHit[3] ?? q);
    const reserved = /^(risk|finding|action|decision|asset|evidence|scope|report|draft)$/i;
    if (name.length >= 2 && !reserved.test(name) && !project.assets.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      out.push(
        proposal(
          'add_asset',
          `Add asset: ${name}`,
          `Chat named “${name}” as ${type.toLowerCase()}${stage ? ` at ${LIFECYCLE_STAGE_LABEL[stage]}` : ''}.`,
          'Creates the asset on the project tree. Later DDs can target it.',
          { name, assetType: type, currentStage: stage } satisfies CreateAssetInput,
          actor,
        ),
      );
    }
  }

  const renameHit = q.match(/\brename\s+(.+?)\s+to\s+(.+)/i);
  if (renameHit) {
    const from = matchExistingAsset(project, renameHit[1] ?? '');
    const next = clipPhrase(renameHit[2] ?? '');
    if (from && next && next.toLowerCase() !== from.name.toLowerCase()) {
      out.push(
        proposal(
          'patch_asset',
          `Rename ${from.name} → ${next}`,
          `Asset is currently “${from.name}”.`,
          'Renames the asset everywhere it is linked.',
          { assetId: from.id, name: next },
          actor,
          { citedNodeIds: [from.id] },
        ),
      );
    }
  }

  const responsibleHit = q.match(/\bresponsible(?:\s+for)?\b.{0,24}(?:is|to|:)\s+([^.\n]+)/i)
    ?? q.match(/\b([A-Za-z0-9][A-Za-z0-9 ./-]{1,40})\b.{0,12}\b(?:lead|engineer|owner)\b(?:\s+is|\s+to|:)\s+([^.\n]+)/i);
  if (responsibleHit) {
    const asset = matchExistingAsset(project, q);
    const person = clipPhrase(responsibleHit[responsibleHit.length - 1] ?? '');
    if (asset && person.length >= 2 && person.toLowerCase() !== (asset.responsible ?? '').toLowerCase()) {
      out.push(
        proposal(
          'patch_asset',
          `Set ${asset.name} responsible to ${person}`,
          `${asset.name} responsible is currently “${asset.responsible || 'blank'}”.`,
          'Patches the asset record.',
          { assetId: asset.id, responsible: person },
          actor,
          { citedNodeIds: [asset.id] },
        ),
      );
    }
  }

  const stage = matchStage(q);
  const stagedAsset = matchExistingAsset(project, q);
  if (stage && /\b(stage|now|move|moved|at|to)\b/i.test(q)) {
    if (stagedAsset && stagedAsset.currentStage !== stage) {
      out.push(
        proposal(
          'change_stage',
          `Move ${stagedAsset.name} to ${LIFECYCLE_STAGE_LABEL[stage]}`,
          `Currently ${LIFECYCLE_STAGE_LABEL[stagedAsset.currentStage]}.`,
          'Writes a stage history row on the asset.',
          { subject: 'asset', assetId: stagedAsset.id, stage, reason: q.slice(0, 180) },
          actor,
          { citedNodeIds: [stagedAsset.id] },
        ),
      );
    } else if (!stagedAsset && project.currentStage !== stage && /\bproject\b/i.test(q)) {
      out.push(
        proposal(
          'change_stage',
          `Move project to ${LIFECYCLE_STAGE_LABEL[stage]}`,
          `Currently ${LIFECYCLE_STAGE_LABEL[project.currentStage]}.`,
          'Writes a stage history row on the project.',
          { subject: 'project', stage, reason: q.slice(0, 180) },
          actor,
          { citedNodeIds: [project.id] },
        ),
      );
    }
  }

  const findingHit = q.match(/\b(?:add|raise|log|record)\s+(?:a\s+)?finding[:\s]+(.{8,180})/i);
  if (findingHit) {
    const title = clipPhrase(findingHit[1] ?? '').slice(0, 160);
    const severity = /\bcritical\b/i.test(q) ? 'critical' : /\bhigh\b/i.test(q) ? 'high' : 'medium';
    const discipline: ScopeKey = /\blegal|title\b/i.test(q) ? 'legal' : /\bhse|safety|fire\b/i.test(q) ? 'hse' : 'technical';
    out.push(
      proposal(
        'add_finding',
        `Log finding: ${title}`,
        `Severity ${severity}, discipline ${SCOPE_LABEL[discipline]}. No evidence is linked yet.`,
        'Creates an open finding on the register. Attach proof afterwards.',
        { title, description: q, severity, discipline, owner } satisfies CreateFindingInput,
        actor,
      ),
    );
  }

  const actionHit = q.match(/\b(?:add|open|create)\s+(?:an?\s+)?action[:\s]+(.{8,180})/i);
  if (actionHit) {
    const title = clipPhrase(actionHit[1] ?? '').slice(0, 160);
    out.push(
      proposal(
        'add_action',
        `Add action: ${title}`,
        'Opened from chat. Owner defaults to the project lead.',
        'Creates an open action on the register.',
        { title, kind: 'clarification', owner, priority: 'medium', description: q } satisfies CreateActionInput,
        actor,
      ),
    );
  }

  const riskHit = q.match(/\b(?:add|raise|log|record)\s+(?:a\s+)?risk[:\s]+(.{8,180})/i);
  if (riskHit) {
    const title = clipPhrase(riskHit[1] ?? '').slice(0, 160);
    out.push(
      proposal(
        'add_risk',
        `Log risk: ${title}`,
        'Opened from chat. Probability possible, impact 3 until you edit it.',
        'Creates an open risk on the register.',
        {
          title,
          category: 'operational',
          cause: q,
          impactType: 'operational',
          probability: 'possible',
          impactScore: 3,
          materiality: 'medium',
          owner,
        } satisfies CreateRiskInput,
        actor,
      ),
    );
  }

  const decisionHit = q.match(/\b(?:add|record|log)\s+(?:a\s+)?decision[:\s]+(.{8,180})/i);
  if (decisionHit) {
    const title = clipPhrase(decisionHit[1] ?? '').slice(0, 160);
    out.push(
      proposal(
        'add_decision',
        `Record decision: ${title}`,
        'Opened from chat as proposed. Decision-maker defaults to the project lead.',
        'Creates a proposed decision on the register.',
        {
          title,
          decisionType: 'proceed',
          decisionMaker: owner,
          rationale: q,
          status: 'proposed',
        } satisfies CreateDecisionInput,
        actor,
      ),
    );
  }

  const receivedHit = q.match(/\b(?:received|got|have|filed)\b.{0,48}/i);
  if (receivedHit) {
    const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
    const hit = gaps.find((g) => q.toLowerCase().includes(g.title.toLowerCase()));
    if (hit) {
      out.push(
        proposal(
          'file_evidence',
          `Mark “${hit.title}” received`,
          `It is currently ${hit.status}. Chat says it has arrived.`,
          'Marks the expected item received. Attach the file in chat if you have the bytes.',
          { evidenceId: hit.id, title: hit.title },
          actor,
          { citedEvidenceIds: [hit.id] },
        ),
      );
    }
  }

  const startDd = startDdFromQuestion(project, q, actor);
  if (startDd && !isImperative(q) && /\b(should|need|recommend|suggest)\b/i.test(q)) {
    out.push(startDd);
  }

  return { proposals: out, imperative: isImperative(q) && out.length > 0 };
}

export function startDdFromQuestion(project: DdProject, question: string, actor: string): ChatProposal | undefined {
  const q = question.toLowerCase();
  if (!/\b(start|create|open|run)\b/.test(q) || !/\bdd\b|\bdue diligence\b|\bassessment\b/.test(q)) return undefined;
  const hit = DD_TYPE_DEFINITIONS.find((d) => d.key !== 'custom' && (q.includes(d.key.replaceAll('_', ' ')) || q.includes(d.label.toLowerCase())));
  if (!hit) return undefined;
  if (project.assessments.some((a) => a.ddType === hit.key && a.status !== 'archived')) return undefined;
  return proposal(
    'start_dd',
    `Start ${hit.label}`,
    hit.purpose,
    `Instantiates default scopes (${hit.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ')}) and seeds expected evidence.`,
    { ddType: hit.key as DdTypeKey, owner: project.owner || actor, targetType: 'project', name: hit.label } satisfies CreateAssessmentInput,
    actor,
  );
}
