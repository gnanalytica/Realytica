/**
 * Tools over one DdProject for the project copilot and orchestrator.
 *
 * Reads are live. Writes are queued as ChatProposal cards — a person still
 * approves before a finding, risk, action or decision lands on a register.
 * `run_capability` may snapshot capabilities or propose drafts (still review
 * before register writes) when the person asked for that work.
 */

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import {
  CHECK_RESULTS,
  candidateChoices,
  checkFieldReading,
  findCheck,
  formatFieldValue,
  isBlank,
  isLiveBlock,
  openReportOf,
  reportIsFrozen,
  reportSummaryLine,
  resolveReportBlock,
  REPORT_SOURCE_LABEL,
  rankTalkSittings,
  DD_CONNECTORS,
  PROJECT_COCKPIT_PANES,
  SCOPE_KEYS,
  SCOPE_LABEL,
  clampGraphHops,
  compareProjectPlanning,
  createChatProposal,
  extractProjectSubgraph,
  captureConcerns,
  conditionRatings,
  escalatedFindings,
  findProjectNodes,
  findingCriticSitting,
  landUseSittingOf,
  lookupReferences,
  packCompleteness,
  remedialCostSummary,
  ricsConditionRating,
  sheetPlacements,
  visitCoverage,
  ENVIRONMENTAL_CONDITION_CAVEAT,
  RICS_RATING_LABEL,
  paneForProposalKind,
  paneForTalk,
  portalForCheck,
  portalObtainLine,
  projectGraphOf,
  projectNextStep,
  proposeAiDrafts,
  proposeProjectScreen,
  runProjectOrchestrator,
  serializePlanningOverlay,
  serializeProjectSubgraph,
  serializeReferenceHits,
  sittingCheckOf,
  sittingFromCitedId,
  snapshotCapabilities,
  traceProjectNode,
  type ChatChoice,
  type ChatProposal,
  type ChatProposalKind,
  type CockpitPathExtra,
  type DdProject,
  type ProjectCockpitPane,
  type ProjectGraphRagSource,
  type ScopeKey,
  type SittingRef,
} from '@realytica/shared';

const PROPOSE_KINDS = [
  'start_dd',
  'add_asset',
  'add_scope',
  'request_evidence',
  'add_finding',
  'add_action',
  'add_risk',
  'add_decision',
  'record_check',
  'record_check_fields',
  'generate_report',
  'edit_report',
  'run_valuation',
  'run_screen',
  'patch_project',
  'change_stage',
  'commit_draft',
  'snapshot_capabilities',
] as const satisfies readonly ChatProposalKind[];

export interface ProjectGraphRagPort {
  kind: 'journal' | 'neo4j';
  neighbourhood(
    projectId: string,
    seedIds: string[],
    hops: number,
  ): Promise<{ nodes: { id: string }[]; edges: unknown[] } | null>;
}

export interface ProjectAgentCollectors {
  proposals: ChatProposal[];
  navigations: Array<{ target: string } & CockpitPathExtra>;
  toolCalls: { name: string; summary: string }[];
  /**
   * Options put to the person because the model could not tell which thing
   * they meant. Same shape the deterministic path emits, so the panel renders
   * one mechanism and the discipline does not depend on whether a key is
   * configured.
   */
  choices: ChatChoice[];
}

function openTalk(bag: ProjectAgentCollectors, sitting: ReturnType<typeof sittingFromCitedId>): void {
  if (!sitting) return;
  const target = paneForTalk(sitting.kind);
  const opened = { target, ...sitting.extra };
  if (!bag.navigations.some((n) => n.target === opened.target && n.checkId === opened.checkId && n.scopeId === opened.scopeId && n.evidenceId === opened.evidenceId && n.findingId === opened.findingId)) {
    bag.navigations.push(opened);
  }
}

function clipList<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

export function projectAgentSnapshot(project: DdProject): Record<string, unknown> {
  const next = projectNextStep(project);
  const pack = packCompleteness(project);
  return {
    id: project.id,
    reference: project.reference,
    name: project.name,
    type: project.type,
    city: project.city,
    location: project.location,
    stage: project.currentStage,
    health: project.health,
    owner: project.owner,
    developer: project.developer,
    landAreaSqm: project.landAreaSqm,
    builtUpAreaSqm: project.builtUpAreaSqm,
    budget: project.budget,
    currency: project.currency,
    lastScreen: project.lastScreen ?? null,
    next: { title: next.title, why: next.why, pane: next.pane, extra: next.extra ?? null },
    packCompleteness: pack,
    assets: clipList(
      project.assets.map((a) => ({ id: a.id, name: a.name, assetType: a.assetType, stage: a.currentStage })),
      24,
    ),
    assessments: clipList(
      project.assessments
        .filter((a) => a.status !== 'archived')
        .map((a) => ({
          id: a.id,
          name: a.name,
          ddType: a.ddType,
          status: a.status,
          scopes: a.scopes.map((s) => ({
            id: s.id,
            scopeKey: s.scopeKey,
            checks: s.checks.length,
            pending: s.checks.filter((c) => c.result === 'pending').length,
          })),
        })),
      16,
    ),
    findings: clipList(
      project.findings
        .filter((f) => f.status === 'open' || f.status === 'under_review' || f.status === 'draft')
        .map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, discipline: f.discipline })),
      20,
    ),
    risks: clipList(
      project.risks
        .filter((r) => r.status !== 'closed' && r.status !== 'accepted')
        .map((r) => ({ id: r.id, title: r.title, status: r.status, materiality: r.materiality })),
      16,
    ),
    actions: clipList(
      project.actions
        .filter((a) => a.status !== 'closed')
        .map((a) => ({ id: a.id, title: a.title, status: a.status, kind: a.kind, dueDate: a.dueDate })),
      20,
    ),
    packGaps: clipList(
      project.evidence
        .filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested')
        .filter((e) => pack.missingTitles.some((t) => e.title === t) || /title|survey|sanction|fire noc|encumbrance|conversion|khata|rera|soil/i.test(e.title))
        .map((e) => ({ id: e.id, title: e.title, status: e.status, kind: e.kind })),
      8,
    ),
    decisions: clipList(
      project.decisions
        .filter((d) => d.status === 'proposed' || d.status === 'pending')
        .map((d) => ({ id: d.id, title: d.title, status: d.status, decisionType: d.decisionType })),
      12,
    ),
    openProposals: clipList(
      project.chatProposals.filter((p) => p.status === 'proposed').map((p) => ({ id: p.id, kind: p.kind, title: p.title })),
      12,
    ),
    pendingDrafts: clipList(
      project.aiDrafts
        .filter((d) => d.status === 'draft' || d.status === 'in_review' || d.status === 'accepted')
        .map((d) => ({ id: d.id, kind: d.kind, title: d.title, status: d.status })),
      12,
    ),
    latestValuation: project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1)
      ? {
          indicatedValue: project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1)?.indicatedValue,
          premise: project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1)?.ibbi.premise,
          signOff: project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1)?.signOff,
        }
      : null,
  };
}

function parsePayload(raw: string): Record<string, unknown> | { error: string } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'payloadJson must be a JSON object.' };
    }
    return value as Record<string, unknown>;
  } catch {
    return { error: 'payloadJson is not valid JSON.' };
  }
}

function validateProposal(kind: ChatProposalKind, payload: Record<string, unknown>): string | null {
  const str = (key: string) => (typeof payload[key] === 'string' ? payload[key].trim() : '');
  if (kind === 'start_dd' && !str('ddType') && !str('name')) return 'start_dd needs ddType or name.';
  if (kind === 'add_asset' && !str('name')) return 'add_asset needs name.';
  if (kind === 'add_scope' && (!str('assessmentId') || !str('scopeKey'))) return 'add_scope needs assessmentId and scopeKey.';
  if (kind === 'add_finding' && (!str('title') || !str('description') || !str('severity') || !str('discipline'))) {
    return 'add_finding needs title, description, severity, discipline.';
  }
  if ((kind === 'add_action' || kind === 'request_evidence') && (!str('title') || !str('kind') || !str('owner') || !str('priority'))) {
    return 'actions need title, kind, owner, priority.';
  }
  if (kind === 'add_risk' && (!str('title') || !str('category') || !str('cause'))) return 'add_risk needs title, category, cause.';
  if (kind === 'record_check_fields') {
    if (!str('checkId')) return 'record_check_fields needs checkId.';
    const values = payload.values;
    if (typeof values !== 'object' || values === null || Array.isArray(values) || Object.keys(values).length === 0) {
      return 'record_check_fields needs values — an object of fieldKey to value. Call get_check_fields for the keys.';
    }
  }
  if (kind === 'edit_report') {
    if (!str('reportId')) return 'edit_report needs reportId.';
    const hasText = typeof payload.text === 'string';
    const hasSource = typeof payload.source === 'object' && payload.source !== null;
    if (!hasText && !hasSource) return 'edit_report needs text (a paragraph) or source (what a live section reads).';
    // The rule this whole feature turns on, checked before a card is even
    // queued: a model may add prose or retune a section, never restate what
    // the registers say in its own words.
    if (hasSource && !str('blockId')) return 'Changing what a section reads needs the blockId of that section.';
  }
  if (kind === 'add_decision' && (!str('title') || !str('decisionType') || !str('decisionMaker') || !str('rationale'))) {
    return 'add_decision needs title, decisionType, decisionMaker, rationale.';
  }
  if (kind === 'record_check') {
    if (!str('checkId')) return 'record_check needs checkId — call get_sitting or search_registers for it.';
    if (!(CHECK_RESULTS as readonly string[]).includes(str('result'))) {
      return `record_check needs one of: ${CHECK_RESULTS.join(', ')}.`;
    }
    if (!str('comments')) return 'record_check needs comments saying what in the evidence supports this result.';
  }
  if (kind === 'generate_report' && !str('kind')) return 'generate_report needs kind.';
  if (kind === 'patch_project' && Object.keys(payload).length === 0) return 'patch_project needs at least one field.';
  if (kind === 'change_stage' && !str('stage')) return 'change_stage needs stage.';
  if (kind === 'add_scope' && str('scopeKey') && !(SCOPE_KEYS as readonly string[]).includes(str('scopeKey'))) {
    return `"${str('scopeKey')}" is not a recognised scope.`;
  }
  return null;
}

export function createProjectTools(
  project: DdProject,
  actor: string,
  bag: ProjectAgentCollectors,
  extra?: {
    sitting?: SittingRef;
    graphRag?: ProjectGraphRagPort;
    lookupShelf?: (query: string, extra?: { scopeKey?: ScopeKey; checkTitle?: string }) => Promise<string>;
  },
) {
  const getSitting = betaTool({
    name: 'get_sitting',
    description:
      'Read the check the person is sitting on (URL or next-step). Prefer this over listing every pending check. Returns titles, expected evidence, and open cards pinned to that check.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    run: async () => {
      const next = projectNextStep(project);
      const sitting = sittingCheckOf(project, extra?.sitting) ?? sittingCheckOf(project, next.extra);
      if (!sitting) {
        return JSON.stringify({ sitting: null, next: { title: next.title, why: next.why } });
      }
      const pinned = project.chatProposals.filter((p) => {
        if (p.status !== 'proposed') return false;
        const pl = p.payload as Record<string, unknown>;
        return pl.checkId === sitting.check.id || (Array.isArray(pl.checkIds) && pl.checkIds.includes(sitting.check.id));
      });
      const portal = portalForCheck(sitting.check);
      return JSON.stringify({
        assessment: { id: sitting.assessment.id, name: sitting.assessment.name, owner: sitting.assessment.owner },
        scope: { id: sitting.scope.id, label: SCOPE_LABEL[sitting.scope.scopeKey] },
        check: {
          id: sitting.check.id,
          title: sitting.check.title,
          result: sitting.check.result,
          expectedEvidence: sitting.check.expectedEvidence,
          purpose: sitting.check.purpose,
        },
        portal: portal
          ? {
              key: portal.key,
              label: portal.label,
              url: portal.url,
              route: portal.route,
              instruction: portalObtainLine(portal),
              notScraped: true,
            }
          : null,
        pinnedCards: pinned.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
      });
    },
  });

  const getCheck = betaTool({
    name: 'get_check',
    description: 'Read one check by id: title, expected evidence, linked evidence, and the parent scope. Use instead of dumping the library.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['checkId'],
      properties: { checkId: { type: 'string' } },
    } as const,
    run: async ({ checkId }) => {
      for (const a of project.assessments) {
        for (const s of a.scopes) {
          const check = s.checks.find((c) => c.id === checkId);
          if (!check) continue;
          openTalk(bag, sittingFromCitedId(project, check.id));
          const evidence = project.evidence.filter((e) => e.checkIds.includes(check.id) || check.evidenceIds.includes(e.id));
          return JSON.stringify({
            assessment: { id: a.id, name: a.name },
            scope: { id: s.id, label: SCOPE_LABEL[s.scopeKey] },
            check: {
              id: check.id,
              title: check.title,
              result: check.result,
              expectedEvidence: check.expectedEvidence,
              purpose: check.purpose,
              comments: check.comments,
            },
            evidence: evidence.slice(0, 12).map((e) => ({ id: e.id, title: e.title, status: e.status })),
          });
        }
      }
      return JSON.stringify({ error: 'Check not found.' });
    },
  });

  const getFinding = betaTool({
    name: 'get_finding',
    description: 'Read one finding by id with linked evidence titles. Use before proposing a duplicate or a critic card.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['findingId'],
      properties: { findingId: { type: 'string' } },
    } as const,
    run: async ({ findingId }) => {
      const f = project.findings.find((row) => row.id === findingId);
      if (!f) return JSON.stringify({ error: 'Finding not found.' });
      openTalk(bag, sittingFromCitedId(project, f.id));
      const evidence = project.evidence.filter((e) => f.evidenceIds.includes(e.id));
      return JSON.stringify({
        id: f.id,
        title: f.title,
        severity: f.severity,
        status: f.status,
        discipline: f.discipline,
        description: f.description,
        // Derived here rather than stored on the record, so a model reading a
        // finding sees the same traffic light the report prints.
        conditionRating: ricsConditionRating(f.severity),
        conditionRatingLabel: RICS_RATING_LABEL[ricsConditionRating(f.severity)],
        immediateAction: f.escalation?.immediateAction ?? false,
        notifiedTo: f.escalation?.notifiedTo,
        environmentalCondition: f.environmentalCondition,
        environmentalConditionCaveat: f.environmentalCondition ? ENVIRONMENTAL_CONDITION_CAVEAT : undefined,
        evidence: evidence.map((e) => ({ id: e.id, title: e.title, status: e.status })),
        unevidenced: f.evidenceIds.length === 0,
      });
    },
  });

  /**
   * The three readings a client asks for in the standards' own words.
   *
   * One tool rather than three because they are always read together — "what
   * is broken, how bad, what does it cost" is a single question — and because
   * each is a pure derivation the model must not be tempted to recompute. The
   * shortfalls travel with the total for the same reason they do in the
   * report: a model that sees only the sum will quote the sum.
   */
  const getStandardsView = betaTool({
    name: 'get_standards_view',
    description:
      'Read the RICS condition-rating spread, the remedial cost by band, and any finding escalated for immediate action. Use when asked what is wrong, how serious, what it will cost, or to write a technical DD summary. Never add up the actions yourself — this is the arithmetic.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { includeClosed: { type: 'boolean' } },
    } as const,
    run: async ({ includeClosed }) => {
      const openOnly = includeClosed !== true;
      const cost = remedialCostSummary(project, { openOnly });
      bag.toolCalls.push({ name: 'get_standards_view', summary: `${cost.currency} ${Math.round(cost.total).toLocaleString('en-IN')} priced` });
      return JSON.stringify({
        conditionRatings: conditionRatings(project, { openOnly }),
        remedialCost: cost,
        escalated: escalatedFindings(project).map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          notifiedTo: f.escalation?.notifiedTo ?? null,
          notifiedAt: f.escalation?.notifiedAt ?? null,
        })),
        caveat:
          cost.unbanded || cost.uncosted
            ? `${cost.unbanded} open action(s) carry no band and ${cost.uncosted} banded one(s) carry no figure — the total covers neither. Say so if you quote it.`
            : undefined,
      });
    },
  });

  /**
   * What is known from having LOOKED at the place, as against having been sent
   * documents about it.
   *
   * Given to the model as one read because the three parts only mean anything
   * together: a photograph is worth what its purpose and date make it worth, a
   * visit is worth what it could actually reach, and a sheet is worth how well
   * it is placed. The limitations especially — a model that lists what was
   * inspected without saying what was not will write "no defect found" where
   * the honest sentence is "the roof was not looked at".
   */
  const getSiteRecord = betaTool({
    name: 'get_site_record',
    description:
      'Read the site visits, what each one could NOT inspect, what the photographs on file claim about themselves, and how well any plan sheet is placed. Use before saying anything about condition, what was seen on site, or a master plan. Never state that something was inspected without checking the limitations here.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} } as const,
    run: async () => {
      const coverage = visitCoverage(project);
      const concerns = captureConcerns(project);
      bag.toolCalls.push({ name: 'get_site_record', summary: `${coverage.length} visit(s), ${concerns.length} capture concern(s)` });
      return JSON.stringify({
        visits: (project.siteVisits ?? []).map((visit) => ({
          id: visit.id,
          title: visit.title,
          visitedOn: visit.visitedOn,
          purpose: visit.purpose,
          status: visit.status,
          surveyor: visit.surveyor,
          weather: visit.weather,
          limitations: visit.limitations,
          // The distinction a report turns on: an empty list claims full
          // access, a visit nobody wrote up claims nothing.
          limitationsStated: coverage.find((c) => c.visitId === visit.id)?.limitationsStated ?? false,
          photos: coverage.find((c) => c.visitId === visit.id)?.photos ?? 0,
        })),
        photographConcerns: concerns,
        sheets: sheetPlacements(project).map(({ sheet, reading }) => ({
          id: sheet.id,
          title: sheet.title,
          kind: sheet.kind,
          issuer: sheet.issuer,
          asOf: sheet.asOf,
          verdict: reading.verdict,
          say: reading.say,
        })),
        caveat:
          'A photograph geotag is what the camera claimed, not where the shot was taken. A sheet placement is derived from control points a person placed. Neither is a survey.',
      });
    },
  });

  const reviewFindings = betaTool({
    name: 'review_findings',
    description:
      'Queue critic cards for unevidenced material findings. Propose-and-review only — never records a check result. Call when they ask to criticise or review findings.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    run: async () => {
      const critic = findingCriticSitting(project, actor);
      const queued: string[] = [];
      for (const card of critic.proposals) {
        if (project.chatProposals.some((p) => p.status === 'proposed' && p.title === card.title) || bag.proposals.some((p) => p.title === card.title)) {
          continue;
        }
        bag.proposals.push(card);
        queued.push(card.title);
      }
      bag.toolCalls.push({ name: 'review_findings', summary: queued.length ? queued.join('; ') : 'No unevidenced material findings' });
      if (!bag.navigations.some((n) => n.target === 'findings')) bag.navigations.push({ target: 'findings' });
      return JSON.stringify({ text: critic.text, queued, note: 'Cards are queued. A person must approve. Checks are not recorded.' });
    },
  });

  const getProject = betaTool({
    name: 'get_project',
    description:
      'Read the live project snapshot: identity, next step, pack completeness, assets, assessments, material findings/risks/actions, and pack gaps. Call this before proposing anything. Do not treat the full evidence library as the health figure.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const,
    run: async () => JSON.stringify(projectAgentSnapshot(project)),
  });

  const searchRegisters = betaTool({
    name: 'search_registers',
    description: 'Search one shared register by title/description substring. Use before proposing a duplicate finding, action or evidence request.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['register', 'query'],
      properties: {
        register: {
          type: 'string',
          enum: ['evidence', 'findings', 'risks', 'actions', 'decisions', 'assessments', 'assets', 'reports'],
        },
        query: { type: 'string' },
      },
    } as const,
    run: async ({ register, query }) => {
      const needle = query.trim().toLowerCase();
      const match = (title: string, extra?: string) =>
        title.toLowerCase().includes(needle) || (extra ?? '').toLowerCase().includes(needle);
      const rows =
        register === 'evidence'
          ? project.evidence.filter((e) => match(e.title, e.description)).map((e) => ({ id: e.id, title: e.title, status: e.status }))
          : register === 'findings'
            ? project.findings.filter((f) => match(f.title, f.description)).map((f) => ({ id: f.id, title: f.title, status: f.status, severity: f.severity }))
            : register === 'risks'
              ? project.risks.filter((r) => match(r.title, r.cause)).map((r) => ({ id: r.id, title: r.title, status: r.status }))
              : register === 'actions'
                ? project.actions.filter((a) => match(a.title, a.description)).map((a) => ({ id: a.id, title: a.title, status: a.status }))
                : register === 'decisions'
                  ? project.decisions.filter((d) => match(d.title, d.rationale)).map((d) => ({ id: d.id, title: d.title, status: d.status }))
                  : register === 'assessments'
                    ? project.assessments.filter((a) => match(a.name)).map((a) => ({ id: a.id, name: a.name, status: a.status }))
                    : register === 'assets'
                      ? project.assets.filter((a) => match(a.name)).map((a) => ({ id: a.id, name: a.name, assetType: a.assetType }))
                      : project.reports.filter((r) => match(r.title)).map((r) => ({ id: r.id, title: r.title, kind: r.kind }));
      return JSON.stringify({ count: rows.length, rows: rows.slice(0, 24) });
    },
  });

  const proposeUpdate = betaTool({
    name: 'propose_update',
    description:
      'Queue a propose-and-review card. Nothing is written to a register until a person approves. Use for findings, risks, actions, decisions, evidence requests, starting a DD, reports, or a property screen. Do not propose a duplicate of an already-open card.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'title', 'rationale', 'impact', 'payloadJson'],
      properties: {
        kind: { type: 'string', enum: [...PROPOSE_KINDS] },
        title: { type: 'string' },
        rationale: { type: 'string', description: 'Why this follows from the registers. Cite record ids in prose.' },
        impact: { type: 'string', description: 'What lands on the project if approved.' },
        payloadJson: {
          type: 'string',
          description:
            'JSON object for the kind: record_check_fields {checkId, values:{fieldKey:value,...}} — call get_check_fields first and use its exact field keys and units; values you read off a document, never guessed. edit_report {reportId, and then EITHER text (+optional heading, afterBlockId) to add a paragraph, OR blockId+text to rewrite a paragraph somebody wrote, OR blockId+source to change what a live section reads}. You may never write the text of a section that reads the registers — propose a source change or a new paragraph beside it. record_check {checkId,result,comments} — result is one of pending, compliant, non_compliant, partially_compliant, not_applicable, unable_to_verify, missing_evidence, requires_expert_review, and comments must say what in the evidence supports it; start_dd {ddType,name,owner,targetType}; add_finding {title,description,severity,discipline,evidenceIds?}; add_action/request_evidence {title,kind,owner,priority,description?}; add_risk {title,category,cause,impactType,probability,impactScore,materiality}; add_decision {title,decisionType,decisionMaker,rationale}; generate_report {kind}; add_asset {name,assetType}; add_scope {assessmentId,scopeKey}; patch_project {owner?,landAreaSqm?,...}; change_stage {stage,reason}; commit_draft {draftIds}; run_screen/run_valuation/snapshot_capabilities may be {}.',
        },
      },
    } as const,
    run: async ({ kind, title, rationale, impact, payloadJson }) => {
      if (!(PROPOSE_KINDS as readonly string[]).includes(kind)) {
        return JSON.stringify({ error: `"${kind}" is not a proposable kind.` });
      }
      const payload = parsePayload(payloadJson);
      if ('error' in payload) return JSON.stringify(payload);
      const invalid = validateProposal(kind as ChatProposalKind, payload);
      if (invalid) return JSON.stringify({ error: invalid });
      const open = project.chatProposals.filter((p) => p.status === 'proposed');
      if (open.some((p) => p.title === title) || bag.proposals.some((p) => p.title === title)) {
        return JSON.stringify({ error: 'A card with that title is already open. Do not duplicate it.' });
      }
      const card = createChatProposal(kind as ChatProposalKind, title, rationale, impact, payload, actor);
      bag.proposals.push(card);
      bag.toolCalls.push({ name: 'propose_update', summary: title });
      const pane = paneForProposalKind(kind as ChatProposalKind);
      if (!bag.navigations.some((n) => n.target === pane)) bag.navigations.push({ target: pane });
      return JSON.stringify({ queued: true, id: card.id, pane, note: 'Queued — a person must approve before it writes.' });
    },
  });

  /**
   * The model's version of "I am not sure which one you mean".
   *
   * The deterministic path already ranks near matches and asks; without this
   * the behaviour would depend on whether a key is configured, and the model
   * would be left with only two moves on an ambiguous message — guess, or
   * write a paragraph asking a question the person cannot click. Neither is
   * acceptable on a command.
   *
   * Options come from the project's own records, matched against the phrase
   * the person used. The model chooses WHETHER to ask; it does not get to
   * invent what the options are.
   */
  const askToChoose = betaTool({
    name: 'ask_to_choose',
    description:
      'Ask the person which record they meant, instead of guessing. Use whenever a message names a check, scope, DD, finding, risk or action that does not clearly resolve to exactly one — especially when they asked you to CHANGE something, where a wrong guess writes to a register. Options are drawn from this project; you supply the phrase they used.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['phrase'],
      properties: {
        phrase: {
          type: 'string',
          description: 'The words the person used for the thing, e.g. "boundary check".',
        },
        question: {
          type: 'string',
          description: 'One short line saying what is unclear. Say plainly that nothing has been changed.',
        },
      },
    } as const,
    run: async ({ phrase, question }) => {
      const ranked = rankTalkSittings(project, String(phrase), 5);
      if (!ranked.length) {
        return JSON.stringify({
          offered: 0,
          note: 'Nothing on this project resembles that. Say so, and ask them to name it as it appears on the register.',
        });
      }
      const rows = candidateChoices(project, ranked);
      for (const row of rows) {
        if (!bag.choices.some((c) => c.send === row.send)) bag.choices.push(row);
      }
      bag.toolCalls.push({ name: 'ask_to_choose', summary: `${rows.length} option(s) offered` });
      return JSON.stringify({
        offered: rows.length,
        options: rows.map((r) => ({ label: r.label, detail: r.detail })),
        question: question ?? null,
        note: 'Offered to the person as buttons. Do NOT also act on one of them — wait for the pick.',
      });
    },
  });

  const runCapability = betaTool({
    name: 'run_capability',
    description:
      'Run a named project capability the person asked for. screen queues a property-screen card (does not write). orchestrate and drafts propose AI drafts from registers (still review before findings/actions). valuation queues an indicative valuation card, not a certified IBBI certificate. capabilities snapshots what this deployment can do.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['capability'],
      properties: {
        capability: { type: 'string', enum: ['screen', 'orchestrate', 'drafts', 'valuation', 'capabilities'] },
      },
    } as const,
    run: async ({ capability }) => {
      if (capability === 'screen') {
        const card = proposeProjectScreen(project, actor);
        if (project.chatProposals.some((p) => p.status === 'proposed' && p.title === card.title) || bag.proposals.some((p) => p.title === card.title)) {
          return JSON.stringify({ alreadyOpen: true, title: card.title });
        }
        bag.proposals.push(card);
        bag.toolCalls.push({ name: 'screen', summary: card.title });
        bag.navigations.push({ target: 'overview' });
        return JSON.stringify({ queued: true, id: card.id, note: 'Approve to write screen results into registers.' });
      }
      if (capability === 'orchestrate') {
        const run = runProjectOrchestrator(project, actor);
        bag.toolCalls.push({ name: 'orchestrate', summary: run.summary });
        bag.navigations.push({ target: 'orchestrate' }, { target: 'drafts' });
        return JSON.stringify({
          ran: true,
          runId: run.id,
          summary: run.summary,
          draftCount: run.draftIds.length,
          recommendedDdTypes: run.recommendedDdTypes,
          evidenceGapCount: run.evidenceGapCount,
          openFindingCount: run.openFindingCount,
          note: 'Drafts are not findings. A person still commits.',
        });
      }
      if (capability === 'drafts') {
        const drafts = proposeAiDrafts(project, actor, 'model');
        bag.toolCalls.push({ name: 'propose_drafts', summary: `${drafts.length} draft(s)` });
        bag.navigations.push({ target: 'drafts' });
        return JSON.stringify({ ran: true, draftCount: drafts.length, titles: drafts.slice(0, 8).map((d) => d.title) });
      }
      if (capability === 'valuation') {
        const card = createChatProposal(
          'run_valuation',
          'Run indicative valuation',
          'Compute an indicative value from live registers. Not a certified IBBI certificate.',
          'Adds a valuation run. Sign-off stays unsigned until a person sets it.',
          {},
          actor,
        );
        bag.proposals.push(card);
        bag.toolCalls.push({ name: 'run_valuation', summary: card.title });
        bag.navigations.push({ target: 'valuation' });
        return JSON.stringify({ queued: true, id: card.id });
      }
      snapshotCapabilities(project, actor);
      bag.toolCalls.push({ name: 'snapshot_capabilities', summary: 'Capability snapshot' });
      bag.navigations.push({ target: 'orchestrate' });
      return JSON.stringify({ ran: true, kinds: project.capabilityRuns.map((r) => r.kind) });
    },
  });

  const navigatePane = betaTool({
    name: 'navigate_pane',
    description: 'Open a cockpit pane on the right so the person can see the DD, scope, check (field), or register you are talking about. Pass ddId/scopeId/checkId when you name a sitting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['pane'],
      properties: {
        pane: { type: 'string', enum: [...PROJECT_COCKPIT_PANES] },
        ddId: { type: 'string' },
        scopeId: { type: 'string' },
        checkId: { type: 'string' },
        evidenceId: { type: 'string' },
        findingId: { type: 'string' },
      },
    } as const,
    run: async ({ pane, ddId, scopeId, checkId, evidenceId, findingId }) => {
      const target = pane as ProjectCockpitPane;
      const opened = {
        target,
        ...(ddId ? { ddId } : {}),
        ...(scopeId ? { scopeId } : {}),
        ...(checkId ? { checkId } : {}),
        ...(evidenceId ? { evidenceId } : {}),
        ...(findingId ? { findingId } : {}),
      };
      if (!bag.navigations.some((n) => n.target === target && n.checkId === checkId && n.scopeId === scopeId && n.evidenceId === evidenceId && n.findingId === findingId)) {
        bag.navigations.push(opened);
      }
      bag.toolCalls.push({ name: 'navigate', summary: checkId ? `${target} · check` : target });
      return JSON.stringify({ opened });
    },
  });

  const getSubgraph = betaTool({
    name: 'get_subgraph',
    description:
      "Query THIS FILE's register graph: assets, DDs, scopes, checks, evidence, findings, risks, actions. Pass a term or an id and hops (1-3). The result is the neighbourhood as [id] lines. Prefer this when asked how things connect. Graph hits are this project's registers — never treat them as a statute. For IBBI/NBC/acts use lookup_reference, which is catalogue-only and is not evidence.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'hops'],
      properties: {
        query: { type: 'string', description: 'A search term or an exact node/evidence/check id.' },
        hops: { type: 'number', minimum: 1, maximum: 3, description: 'Neighbourhood depth (1-3).' },
      },
    } as const,
    run: async ({ query, hops }) => {
      const live = projectGraphOf(project);
      const seeds = findProjectNodes(live, String(query ?? '')).slice(0, 5);
      if (seeds.length === 0) {
        return JSON.stringify({ error: `Nothing in this file's graph matches "${query}". Try a check title, a finding, or an id.` });
      }
      const depth = clampGraphHops(Number(hops) || 1);
      const seedIds = seeds.map((s) => s.id);
      let source: ProjectGraphRagSource = 'live';
      let sub = extractProjectSubgraph(live, seedIds, depth);
      if (extra?.graphRag) {
        try {
          const stored = await extra.graphRag.neighbourhood(project.id, seedIds, depth);
          if (stored && stored.nodes.length > 0) {
            sub = stored as typeof sub;
            source = extra.graphRag.kind;
          }
        } catch {
          /* live projection is the source of truth when the index is unreachable */
        }
      }
      const seed = seeds[0];
      if (seed) openTalk(bag, sittingFromCitedId(project, seed.id));
      bag.toolCalls.push({ name: 'get_subgraph', summary: `${seed?.label ?? query} · ${source}` });
      return serializeProjectSubgraph(sub, source);
    },
  });

  const traceConclusion = betaTool({
    name: 'trace_conclusion',
    description:
      'Trace one check, finding, risk or action down to the evidence on THIS FILE. If the trace reaches no evidence, say so — never invent support. This is not a statute lookup.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string', description: 'A check, finding, risk, action or evidence id from get_subgraph.' },
      },
    } as const,
    run: async ({ nodeId }) => {
      const cone = traceProjectNode(projectGraphOf(project), String(nodeId ?? ''));
      if (!cone) return JSON.stringify({ error: `No node "${nodeId}" in this file's graph.` });
      openTalk(bag, sittingFromCitedId(project, String(nodeId)));
      bag.toolCalls.push({ name: 'trace_conclusion', summary: String(nodeId) });
      return serializeProjectSubgraph(cone, 'live');
    },
  });

  const lookupReference = betaTool({
    name: 'lookup_reference',
    description:
      'Look up an official act, IBBI circular, gazette, or master-plan statute in the reference shelf. Hits are REFERENCE, not this project\'s evidence — cite title and asOf, never file them on the evidence register. Do not scrape gated portals. NBC and full IVS are paid; RMP map sheets are catalogue-only until a person files the extract.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'A statute, circular, or topic: IBBI, PTCL, Registration Act, fire, NBC.' },
      },
    } as const,
    run: async ({ query }) => {
      const seated = sittingCheckOf(project, extra?.sitting);
      const extraQuery = {
        scopeKey: seated?.scope.scopeKey,
        checkTitle: seated?.check.title,
      };
      bag.toolCalls.push({ name: 'lookup_reference', summary: String(query) });
      if (extra?.lookupShelf) return extra.lookupShelf(String(query ?? ''), extraQuery);
      const hits = lookupReferences(String(query ?? ''), extraQuery);
      return serializeReferenceHits(hits);
    },
  });

  const getPortalRoute = betaTool({
    name: 'get_portal_route',
    description:
      'Name the government portal for the current sitting (Kaveri, Bhoomi, e-Khata, Fire NOC, BDA master plan, K-RERA). Returns the URL and the manual download route. Do not fetch or scrape the portal — tell the person to download after OTP and attach the file on this check.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        checkId: { type: 'string', description: 'Optional check id. Defaults to the sitting.' },
      },
    } as const,
    run: async ({ checkId }) => {
      let seated = sittingCheckOf(project, extra?.sitting);
      if (checkId) {
        for (const a of project.assessments) {
          for (const s of a.scopes) {
            const check = s.checks.find((c) => c.id === checkId);
            if (check) seated = { assessment: a, scope: s, check };
          }
        }
      }
      if (!seated) return JSON.stringify({ error: 'No sitting check. Name a check first.' });
      const portal = portalForCheck(seated.check);
      openTalk(bag, sittingFromCitedId(project, seated.check.id));
      bag.toolCalls.push({ name: 'get_portal_route', summary: portal?.label ?? 'none' });
      if (!portal) {
        return JSON.stringify({
          checkId: seated.check.id,
          portal: null,
          note: 'No named Karnataka portal for this check. Ask for the expected evidence by hand.',
        });
      }
      return JSON.stringify({
        checkId: seated.check.id,
        checkTitle: seated.check.title,
        portal: {
          key: portal.key,
          label: portal.label,
          url: portal.url,
          route: portal.route,
          instruction: portalObtainLine(portal),
        },
        notScraped: true,
      });
    },
  });

  const comparePlanning = betaTool({
    name: 'compare_planning',
    description:
      'Compare this project pin and locality pack to the kept master plan (RMP 2015 as extended). Returns flags only — not a geometric overlay, not a zoning certificate. Queue the BDA/LPA obtain card. Never file the shelf or pack as this file\'s extract.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        checkId: { type: 'string', description: 'Optional land-use check id. Defaults to the sitting or the land-use check on this file.' },
      },
    } as const,
    run: async ({ checkId }) => {
      const seated = landUseSittingOf(project, checkId ? { checkId } : extra?.sitting);
      const sitting = seated
        ? { checkId: seated.check.id, ddId: seated.assessment.id, scopeId: seated.scope.id }
        : extra?.sitting;
      const read = compareProjectPlanning(project, { sitting });
      openTalk(bag, sittingFromCitedId(project, seated?.check.id ?? ''));
      bag.toolCalls.push({ name: 'compare_planning', summary: read.pin ? 'pin vs kept plan' : 'kept plan, no pin' });
      const portal = DD_CONNECTORS.find((c) => c.key === 'bda_rmp');
      if (portal) {
        const title = `Obtain ${portal.label}`;
        const already = project.chatProposals.some((p) => p.status === 'proposed' && p.title === title) || bag.proposals.some((p) => p.title === title);
        if (!already) {
          bag.proposals.push(
            createChatProposal(
              'open_connector',
              title,
              `${portal.authority} settles: ${portal.settles} Manual route: ${portal.route}${portal.url ? ` Portal: ${portal.url}` : ''}. This product does not log in or scrape the portal.`,
              seated
                ? `Writes a requested evidence row pinned to “${seated.check.title}”. Attach the sheet or zoning certificate on that check.`
                : 'Writes a requested evidence row and an action to collect the master-plan extract.',
              {
                connectorKey: portal.key,
                label: portal.label,
                authority: portal.authority,
                settles: portal.settles,
                url: portal.url,
                route: portal.route,
                kind: 'gis',
                owner: project.owner || actor,
                ...(seated
                  ? {
                      checkId: seated.check.id,
                      checkIds: [seated.check.id],
                      assessmentIds: [seated.assessment.id],
                      scopeInstanceIds: [seated.scope.id],
                    }
                  : {}),
              },
              actor,
              { citedNodeIds: seated ? [seated.check.id] : undefined },
            ),
          );
        }
      }
      let shelf = '';
      if (extra?.lookupShelf) {
        shelf = await extra.lookupShelf('KTCP master plan RMP zoning', {
          scopeKey: seated?.scope.scopeKey,
          checkTitle: seated?.check.title,
        });
      }
      return JSON.stringify({
        notGeometry: true,
        notEvidence: true,
        overlay: serializePlanningOverlay(read),
        shelf: shelf || undefined,
        instruction: portal ? portalObtainLine(portal) : undefined,
        note: 'Approve the obtain card to put a collection action on the register. Do not treat the locality pack or this overlay as the sheet. The GIS map on Overview overlays OSM and OpenCity civic layers around the pin — CONTEXT, not RMP.',
      });
    },
  });

  return [
    getProject,
    getSitting,
    getCheck,
    getFinding,
    getStandardsView,
    getSiteRecord,
    searchRegisters,
    getSubgraph,
    traceConclusion,
    lookupReference,
    getPortalRoute,
    comparePlanning,
    proposeUpdate,
    askToChoose,
    runCapability,
    reviewFindings,
    navigatePane,
  ];
}
