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
  PROJECT_COCKPIT_PANES,
  SCOPE_KEYS,
  createChatProposal,
  paneForProposalKind,
  proposeAiDrafts,
  proposeProjectScreen,
  runProjectOrchestrator,
  snapshotCapabilities,
  type ChatProposal,
  type ChatProposalKind,
  type DdProject,
  type ProjectCockpitPane,
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
  'generate_report',
  'run_valuation',
  'run_screen',
  'patch_project',
  'change_stage',
  'commit_draft',
  'snapshot_capabilities',
] as const satisfies readonly ChatProposalKind[];

export interface ProjectAgentCollectors {
  proposals: ChatProposal[];
  navigations: { target: string }[];
  toolCalls: { name: string; summary: string }[];
}

function clipList<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

export function projectAgentSnapshot(project: DdProject): Record<string, unknown> {
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
    evidenceGaps: clipList(
      project.evidence
        .filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested')
        .map((e) => ({ id: e.id, title: e.title, status: e.status, kind: e.kind })),
      20,
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
  if (kind === 'add_decision' && (!str('title') || !str('decisionType') || !str('decisionMaker') || !str('rationale'))) {
    return 'add_decision needs title, decisionType, decisionMaker, rationale.';
  }
  if (kind === 'generate_report' && !str('kind')) return 'generate_report needs kind.';
  if (kind === 'patch_project' && Object.keys(payload).length === 0) return 'patch_project needs at least one field.';
  if (kind === 'change_stage' && !str('stage')) return 'change_stage needs stage.';
  if (kind === 'add_scope' && str('scopeKey') && !(SCOPE_KEYS as readonly string[]).includes(str('scopeKey'))) {
    return `"${str('scopeKey')}" is not a recognised scope.`;
  }
  return null;
}

export function createProjectTools(project: DdProject, actor: string, bag: ProjectAgentCollectors) {
  const getProject = betaTool({
    name: 'get_project',
    description:
      'Read the live project snapshot: identity, assets, assessments and scopes, open findings/risks/actions, evidence gaps, pending drafts and proposals. Call this before proposing anything.',
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
            'JSON object for the kind: start_dd {ddType,name,owner,targetType}; add_finding {title,description,severity,discipline,evidenceIds?}; add_action/request_evidence {title,kind,owner,priority,description?}; add_risk {title,category,cause,impactType,probability,impactScore,materiality}; add_decision {title,decisionType,decisionMaker,rationale}; generate_report {kind}; add_asset {name,assetType}; add_scope {assessmentId,scopeKey}; patch_project {owner?,landAreaSqm?,...}; change_stage {stage,reason}; commit_draft {draftIds}; run_screen/run_valuation/snapshot_capabilities may be {}.',
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
    description: 'Open a cockpit pane on the right so the person can see the registers or DD you are talking about.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['pane'],
      properties: {
        pane: { type: 'string', enum: [...PROJECT_COCKPIT_PANES] },
      },
    } as const,
    run: async ({ pane }) => {
      const target = pane as ProjectCockpitPane;
      if (!bag.navigations.some((n) => n.target === target)) bag.navigations.push({ target });
      bag.toolCalls.push({ name: 'navigate', summary: target });
      return JSON.stringify({ opened: target });
    },
  });

  return [getProject, searchRegisters, proposeUpdate, runCapability, navigatePane];
}
