/**
 * The report as a document of blocks, half of which are alive.
 *
 * A due-diligence report mixes two kinds of sentence and they need opposite
 * treatment:
 *
 *   "14 open findings, 3 of them critical, across 5 assessments."
 *   "We recommend proceeding subject to the DC conversion order being
 *    produced before completion."
 *
 * The first is a READING OF THE REGISTERS. Nobody should type it, because the
 * moment they do it stops agreeing with the file — and it will keep not
 * agreeing, silently, for as long as the report exists. The second is
 * SOMEBODY'S JUDGEMENT. It exists nowhere else, no amount of regeneration can
 * produce it, and anything that overwrites it has destroyed the only copy.
 *
 * A report that is one editable text box gets the first case wrong. A report
 * that is regenerated wholesale gets the second case wrong. This module is the
 * split that gets both right, and it is deliberately the same split the graph
 * store already runs on: `derived` is an index over data that lives elsewhere,
 * `authored` is a home for something held nowhere else. One idea, two surfaces.
 *
 * Three states a block can be in, and the third is the one most tools skip:
 *
 * 1. **Bound** — `origin: 'derived'` with a `source`. Re-resolved from the
 *    registers on every render. You cannot type into it. You CAN change what
 *    it asks for, move it, or remove it.
 * 2. **Authored** — `origin: 'authored'` with `text`. Yours. Nothing in this
 *    file ever rewrites one.
 * 3. **Detached** — was bound, now authored, with `detachedFrom` and
 *    `detachedAt` still on it. This is the escape hatch for "I need to say
 *    this differently", and it is recorded rather than hidden: a reader can
 *    see the paragraph is a person's words frozen at a date, not a live
 *    reading. Silently letting an edit stop a block updating would be the
 *    same lie by a quieter route.
 *
 * Everything here is a pure function of its arguments. `resolveReportBlock`
 * has to return the same lines for the same project on every call, because
 * the editor renders it on every keystroke elsewhere in the document and an
 * unstable resolve would make the page flicker between two truths.
 */

import { LIFECYCLE_STAGE_LABEL, SCOPE_LABEL } from './catalogs';
import { CAPTURE_PURPOSE_LABEL } from './capture';
import { remedialCostSummary } from './remedial';
import { VISIT_LIMITATION_LABEL } from './site-visit';
import { ENVIRONMENTAL_CONDITION_CAVEAT, ENVIRONMENTAL_CONDITION_LABEL, ricsConditionRating } from './standards';
import type {
  DdProject,
  ReportBlock,
  ReportBoundSource,
  ReportBoundSourceKind,
  ResolvedReportBlock,
} from './types';

/* ==================================================================== */
/* The closed set of things a block may be bound to                      */
/* ==================================================================== */

/**
 * Listed explicitly rather than derived from the union, because the whole
 * point of rejecting an unknown source is that the check survives to runtime
 * — a person retuning a block over HTTP is exactly when it matters.
 */
export const REPORT_BOUND_SOURCES: readonly ReportBoundSourceKind[] = [
  'particulars',
  'title_chain',
  'findings',
  'risks',
  'actions',
  'decisions',
  'evidence_gaps',
  'dd_progress',
  'checks',
  'valuation',
  'remedial_cost',
  'site_visits',
  'changes_since_previous',
] as const;

export function isReportBoundSource(value: unknown): value is ReportBoundSourceKind {
  return typeof value === 'string' && (REPORT_BOUND_SOURCES as readonly string[]).includes(value);
}

/** What each source is called in the editor, and what it reads. */
export const REPORT_SOURCE_LABEL: Record<ReportBoundSourceKind, string> = {
  particulars: 'The property',
  title_chain: 'Chain of title',
  findings: 'Findings',
  risks: 'Risks',
  actions: 'Actions',
  decisions: 'Decisions',
  evidence_gaps: 'Evidence gaps',
  dd_progress: 'DD progress',
  checks: 'Checks by scope',
  valuation: 'Indicative valuation',
  remedial_cost: 'Remedial cost by band',
  site_visits: 'Inspection record',
  changes_since_previous: 'Changes since the previous assessment',
};

export const REPORT_SOURCE_READS: Record<ReportBoundSourceKind, string> = {
  particulars: 'The parcel, its extent, tenure and jurisdiction, from the file’s own particulars.',
  title_chain: 'The conveyances the last screen walked, with breaks and contradictions.',
  findings: 'The findings register, filtered to what this block asks for.',
  risks: 'The risk register.',
  actions: 'The action register.',
  decisions: 'The decision register.',
  evidence_gaps: 'Evidence expected, requested or missing — never what is already on file.',
  dd_progress: 'Each assessment’s completion, from its checks.',
  checks: 'Every check that did not come back compliant, by scope.',
  valuation: 'The most recent valuation run, with its premise and sign-off state.',
  remedial_cost: 'What the open actions cost, banded by when the money falls — with what is still unpriced said out loud.',
  site_visits: 'Who inspected, when, and what they could not get to. A visit nobody wrote up is named as such.',
  changes_since_previous: 'What a reassessment opened, closed and left unresolved.',
};

/* ==================================================================== */
/* Resolving a bound block against the live registers                    */
/* ==================================================================== */

const OPEN_FINDING = new Set(['open', 'under_review', 'accepted']);
const MATERIAL = new Set(['critical', 'high']);

function inScope(project: DdProject, assessmentIds: string[] | undefined): (ids: string[]) => boolean {
  if (!assessmentIds || assessmentIds.length === 0) return () => true;
  const wanted = new Set(assessmentIds);
  return (ids) => ids.some((id) => wanted.has(id));
}

/**
 * One bound block, rendered from the registers as they stand right now.
 *
 * Returns `recordIds` alongside the lines so the editor can offer "open the
 * finding this line is about" — a report you can walk back into the file from
 * is the difference between a document and a view.
 *
 * An empty result is returned as an empty `lines` array with a `note`, never
 * as a fabricated "none found" line: the editor decides how to show an empty
 * section, and a report that silently prints "No open risks" when the risk
 * register was simply never filled in is the failure this whole module is
 * about.
 */
export function resolveReportBlock(project: DdProject, block: ReportBlock): ResolvedReportBlock {
  const source = block.source;
  if (block.origin === 'authored' || !source) {
    return { lines: block.text ? block.text.split('\n').filter(Boolean) : [], recordIds: [] };
  }
  const scoped = inScope(project, source.assessmentIds);

  switch (source.kind) {
    case 'particulars': {
      const lines = [
        `${project.name} (${project.reference}) — ${[project.location, project.city].filter(Boolean).join(', ')}.`,
        `Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}. Health: ${project.health}.`,
      ];
      if (project.parcelId) lines.push(`Parcel: ${project.parcelId}.`);
      if (project.landAreaSqm) lines.push(`Land: ${Math.round(project.landAreaSqm).toLocaleString('en-IN')} sqm.`);
      if (project.tenure && project.tenure !== 'unknown') lines.push(`Tenure: ${project.tenure}.`);
      if (project.karnataka?.jurisdiction) lines.push(`Jurisdiction: ${project.karnataka.jurisdiction}.`);
      if (project.karnataka?.landConversionStatus && project.karnataka.landConversionStatus !== 'unknown') {
        lines.push(`Land conversion: ${project.karnataka.landConversionStatus.replace(/_/g, ' ')}.`);
      }
      return { lines, recordIds: [project.id] };
    }

    case 'title_chain': {
      const title = project.lastScreenResult?.titleGraph;
      if (!title) return { lines: [], recordIds: [], note: 'No screen has run on this file yet, so there is no chain to report.' };
      const lines: string[] = [title.headline];
      for (const chain of title.chains) {
        lines.push(
          `${chain.parcelLabel}: ${chain.links.length} instrument(s)`
            + (chain.yearsEstablished ? `, ${chain.yearsEstablished} years established` : '')
            + (chain.breaks.length ? `, ${chain.breaks.length} break(s)` : '')
            + '.',
        );
        for (const link of chain.links) lines.push(`  ${link.at ? link.at.slice(0, 10) : 'undated'} — ${link.label}`);
        for (const brk of chain.breaks) lines.push(`  BREAK (${brk.severity}): ${brk.statement}`);
      }
      for (const row of title.contradictions) lines.push(`CONFLICT (${row.severity}) ${row.subject}: ${row.statement}`);
      return { lines, recordIds: [], note: `Title integrity ${title.integrityScore}/100.` };
    }

    case 'findings': {
      const rows = project.findings
        .filter((f) => scoped(f.assessmentIds))
        .filter((f) => (source.openOnly === false ? true : OPEN_FINDING.has(f.status)))
        .filter((f) => (source.materialOnly ? MATERIAL.has(f.severity) : true))
        .filter((f) => (source.discipline ? f.discipline === source.discipline : true));
      return {
        // The condition rating leads, because it is the grading a reader of a
        // TDD report already knows how to read; the severity stays beside it
        // rather than being replaced by it, since four grades is the finer
        // instrument and the report should not pretend otherwise.
        lines: rows.map((f) => {
          const rating = ricsConditionRating(f.severity);
          const head = `[${rating}] ${f.severity.toUpperCase()} · ${SCOPE_LABEL[f.discipline]} · ${f.title} — ${f.description}`;
          const tail: string[] = [];
          if (f.escalation?.immediateAction) {
            tail.push(
              `Immediate action${f.escalation.notifiedTo ? `; ${f.escalation.notifiedTo} notified${f.escalation.notifiedAt ? ` on ${f.escalation.notifiedAt}` : ''}` : ' — nobody recorded as notified'}.`,
            );
          }
          if (f.environmentalCondition) tail.push(`${ENVIRONMENTAL_CONDITION_LABEL[f.environmentalCondition]}. ${ENVIRONMENTAL_CONDITION_CAVEAT}`);
          return tail.length ? `${head} ${tail.join(' ')}` : head;
        }),
        recordIds: rows.map((f) => f.id),
      };
    }

    case 'risks': {
      const rows = project.risks
        .filter((r) => scoped(r.assessmentIds))
        .filter((r) => (source.openOnly === false ? true : r.status !== 'closed'))
        .filter((r) => (source.materialOnly ? r.materiality === 'critical' || r.materiality === 'high' : true));
      return {
        lines: rows.map((r) => `${r.title} (${r.category}, ${r.materiality}) — ${r.cause}`),
        recordIds: rows.map((r) => r.id),
      };
    }

    case 'actions': {
      const rows = project.actions.filter((a) => (source.openOnly === false ? true : a.status !== 'closed'));
      return {
        lines: rows.map((a) => `${a.title} · ${a.owner} · ${a.status}${a.dueDate ? ` · due ${a.dueDate}` : ''}`),
        recordIds: rows.map((a) => a.id),
      };
    }

    case 'decisions': {
      const rows = project.decisions;
      return { lines: rows.map((d) => `${d.title} — ${d.status}${d.rationale ? `. ${d.rationale}` : ''}`), recordIds: rows.map((d) => d.id) };
    }

    case 'evidence_gaps': {
      const rows = project.evidence
        .filter((e) => ['expected', 'requested', 'missing'].includes(e.status))
        .filter((e) => scoped(e.assessmentIds));
      return { lines: rows.map((e) => `${e.title} — ${e.status}`), recordIds: rows.map((e) => e.id) };
    }

    case 'dd_progress': {
      const rows = project.assessments.filter((a) => !source.assessmentIds?.length || source.assessmentIds.includes(a.id));
      return {
        lines: rows.map((a) => {
          const checks = a.scopes.flatMap((s) => s.checks);
          const done = checks.filter((c) => c.result !== 'pending').length;
          return `${a.name} — ${a.status}, ${done}/${checks.length} checks recorded.`;
        }),
        recordIds: rows.map((a) => a.id),
      };
    }

    case 'checks': {
      const lines: string[] = [];
      const recordIds: string[] = [];
      for (const assessment of project.assessments) {
        if (source.assessmentIds?.length && !source.assessmentIds.includes(assessment.id)) continue;
        for (const scope of assessment.scopes) {
          const unresolved = scope.checks.filter(
            (c) => c.result !== 'compliant' && c.result !== 'not_applicable' && (source.openOnly === false || c.result !== 'pending'),
          );
          if (!unresolved.length) continue;
          lines.push(`${assessment.name} · ${SCOPE_LABEL[scope.scopeKey]}`);
          for (const check of unresolved) {
            lines.push(`  ${check.title}: ${check.result}${check.comments ? ` — ${check.comments}` : ''}`);
            recordIds.push(check.id);
          }
        }
      }
      return { lines, recordIds };
    }

    case 'valuation': {
      const run = project.valuationRuns[project.valuationRuns.length - 1];
      if (!run) return { lines: [], recordIds: [], note: 'No valuation has been run on this file.' };
      return {
        lines: [
          `${run.indicatedValue.toLocaleString('en-IN')} ${run.currency} (${run.low.toLocaleString('en-IN')}–${run.high.toLocaleString('en-IN')}) · ${run.status}.`,
          run.signOff === 'registered_valuer_required'
            ? 'Indicative only. A registered valuer must sign this before it is relied on.'
            : `Sign-off: ${run.signOff.replace(/_/g, ' ')}.`,
          'Indicative valuation is not a certified IBBI certificate.',
        ],
        recordIds: [run.id],
      };
    }

    case 'remedial_cost': {
      // Banded, and honest about its own gaps. A cost table that prints a
      // total while sixteen actions sit unpriced is the single most
      // load-bearing number in a TDD report and the easiest one to read as
      // complete, so the shortfall is a line, not a footnote somebody drops.
      const summary = remedialCostSummary(project, { openOnly: source.openOnly !== false });
      const priced = summary.rows.filter((r) => r.count > 0);
      if (!priced.length && !summary.unbanded) {
        return { lines: [], recordIds: [], note: 'No open action on this file carries a remedial cost band.' };
      }
      const money = (n: number) => `${summary.currency} ${Math.round(n).toLocaleString('en-IN')}`;
      const lines = priced.map((r) => {
        const unpriced = r.count - r.costed;
        // A band where nothing has been priced must NOT print a zero. "INR 0
        // across 3 actions" reads as "these are free", which is the exact
        // opposite of what an unpriced band means, and it is the reading a
        // buyer would act on.
        if (r.costed === 0) return `${r.label}: ${r.count} action(s), none of them priced yet.`;
        return `${r.label}: ${money(r.total)} across ${r.count} action(s)${unpriced ? ` — ${unpriced} of them not yet priced` : ''}.`;
      });
      // Same rule at the footer: a total of zero is not a cheap file, it is an
      // unpriced one, and only one of those two readings is true here.
      lines.push(
        summary.total > 0
          ? `Total of what has been priced: ${money(summary.total)}.`
          : 'Nothing on this file has been priced yet, so there is no total to give.',
      );
      if (summary.unbanded) lines.push(`${summary.unbanded} open action(s) carry no band, and are not in that total.`);
      return { lines, recordIds: priced.flatMap((r) => r.actionIds) };
    }

    case 'site_visits': {
      /*
       * The limitations are the reason this block exists.
       *
       * A report that lists what was inspected and stays silent about what was
       * not reads as more complete than it is — "no defect found" and "could
       * not get onto the roof" are indistinguishable to the reader, and only
       * one of them is worth anything. RICS asks for the limitations for
       * exactly this reason, so they are printed under each visit rather than
       * summarised away.
       */
      const rows = (project.siteVisits ?? []).filter((v) => scoped(v.assessmentIds));
      if (!rows.length) return { lines: [], recordIds: [], note: 'No site visit has been recorded on this file.' };
      const lines: string[] = [];
      for (const visit of rows) {
        const photos = project.evidence.reduce(
          (n, e) => n + e.attachments.filter((a) => a.capture?.visitId === visit.id).length,
          0,
        );
        lines.push(
          `${visit.visitedOn} — ${visit.title}. ${CAPTURE_PURPOSE_LABEL[visit.purpose]}, by ${visit.surveyor}${visit.accompaniedBy ? ` with ${visit.accompaniedBy}` : ''}${visit.weather ? `. ${visit.weather}` : ''}. ${photos} photograph(s).${visit.status === 'aborted' ? ' Inspection could not be carried out.' : ''}`,
        );
        for (const limit of visit.limitations) lines.push(`   Not inspected — ${VISIT_LIMITATION_LABEL[limit.kind].toLowerCase()}: ${limit.what}`);
        // An empty limitations list is a claim of full access. A visit nobody
        // wrote up is silence, and the report must not print the second as
        // though it were the first.
        if (!visit.limitations.length && !visit.notes?.trim()) {
          lines.push('   Nothing recorded about what could or could not be inspected on this visit.');
        }
      }
      return { lines, recordIds: rows.map((v) => v.id) };
    }

    case 'changes_since_previous': {
      const rows = project.assessments.filter((a) => a.priorAssessmentId);
      if (!rows.length) return { lines: [], recordIds: [], note: 'No assessment on this file supersedes an earlier one.' };
      return {
        lines: rows.map((a) => {
          const prior = project.assessments.find((p) => p.id === a.priorAssessmentId);
          const opened = project.findings.filter((f) => f.assessmentIds.includes(a.id)).length;
          const before = prior ? project.findings.filter((f) => f.assessmentIds.includes(prior.id)).length : 0;
          return `${a.name}: ${opened} finding(s), against ${before} on ${prior?.name ?? 'the previous assessment'}.`;
        }),
        recordIds: rows.map((a) => a.id),
      };
    }
  }
}

/** True when this block still reads the registers rather than holding text. */
export function isLiveBlock(block: ReportBlock): boolean {
  return block.origin === 'derived' && !!block.source && !block.detachedAt;
}

/**
 * What the report shows for a block, honouring the freeze.
 *
 * A `draft` report resolves live. An `issued` one shows what it said at issue
 * — it went to a bank, and a document that quietly rewrites itself after it
 * was relied on is worse than one that is out of date. The drift between the
 * two is not hidden either; see `reportDrift`.
 */
export function readReportBlock(project: DdProject, block: ReportBlock, frozen: boolean): ResolvedReportBlock {
  if (frozen && block.frozen) return { lines: block.frozen, recordIds: block.frozenRecordIds ?? [] };
  return resolveReportBlock(project, block);
}

/** True when the report may no longer change under the reader's feet. */
export function reportIsFrozen(status: string): boolean {
  return status === 'issued' || status === 'superseded' || status === 'archived';
}

export interface ReportDriftRow {
  blockId: string;
  heading: string;
  wasCount: number;
  nowCount: number;
  added: string[];
  removed: string[];
}

/**
 * What the registers say now, against what the report said when it was issued.
 *
 * This falls out of the freeze almost for free and is the most useful screen
 * the report has: a person who issued a red-flag pack three weeks ago wants
 * one question answered — what has moved since. Computed rather than stored,
 * so it can never itself go stale.
 */
export function reportDrift(project: DdProject, blocks: ReportBlock[]): ReportDriftRow[] {
  const rows: ReportDriftRow[] = [];
  for (const block of blocks) {
    if (!isLiveBlock(block) || !block.frozen) continue;
    const now = resolveReportBlock(project, block).lines;
    const was = block.frozen;
    const wasSet = new Set(was);
    const nowSet = new Set(now);
    const added = now.filter((l: string) => !wasSet.has(l));
    const removed = was.filter((l: string) => !nowSet.has(l));
    if (!added.length && !removed.length) continue;
    rows.push({
      blockId: block.id,
      heading: block.heading ?? REPORT_SOURCE_LABEL[block.source!.kind],
      wasCount: was.length,
      nowCount: now.length,
      added,
      removed,
    });
  }
  return rows;
}

/* ==================================================================== */
/* The starting document for each report kind                            */
/* ==================================================================== */

function bound(kind: ReportBoundSourceKind, extra: Partial<ReportBoundSource> = {}): ReportBoundSource {
  return { kind, ...extra };
}

/**
 * What each report kind opens as.
 *
 * A layout, not a lock: every block here can be moved, retuned, detached or
 * removed, and prose can be added anywhere. The one thing the template does
 * that a blank page cannot is put the standing caveats in front of somebody
 * before they write around them.
 */
export function reportTemplate(kind: string): Array<{ heading: string; source?: ReportBoundSource; text?: string }> {
  const opening = { heading: 'The property', source: bound('particulars') };
  switch (kind) {
    case 'red_flag':
      return [
        opening,
        { heading: 'Why this pack exists', text: 'Material findings only. A gap listed here is unresolved at the date of this pack, not merely unrecorded.' },
        { heading: 'Material findings', source: bound('findings', { materialOnly: true }) },
        { heading: 'Evidence gaps', source: bound('evidence_gaps') },
        { heading: 'Recommendation', text: '' },
      ];
    case 'evidence_completeness':
      return [opening, { heading: 'Evidence gaps', source: bound('evidence_gaps') }, { heading: 'DD progress', source: bound('dd_progress') }];
    case 'open_risk_action':
      return [opening, { heading: 'Open risks', source: bound('risks') }, { heading: 'Open actions', source: bound('actions') }];
    case 'changes_since_previous':
      return [opening, { heading: 'What changed', source: bound('changes_since_previous') }, { heading: 'Open findings', source: bound('findings') }];
    case 'indicative_valuation':
      return [
        opening,
        { heading: 'Indicative valuation', source: bound('valuation') },
        { heading: 'Basis and caveats', text: 'Indicative only, computed from the registers on this file. It is not a certified IBBI valuation and must not be relied on as one.' },
      ];
    case 'handover_readiness':
      return [
        opening,
        { heading: 'DD progress', source: bound('dd_progress') },
        { heading: 'Blocking findings', source: bound('findings', { materialOnly: true }) },
        { heading: 'Open actions', source: bound('actions') },
        { heading: 'Remedial cost by band', source: bound('remedial_cost') },
        { heading: 'Inspection record', source: bound('site_visits') },
      ];
    case 'detailed_dd':
      return [
        opening,
        { heading: 'Chain of title', source: bound('title_chain') },
        { heading: 'Findings', source: bound('findings') },
        { heading: 'Risks', source: bound('risks') },
        { heading: 'Actions', source: bound('actions') },
        { heading: 'Remedial cost by band', source: bound('remedial_cost') },
        { heading: 'Inspection record', source: bound('site_visits') },
        { heading: 'Decisions', source: bound('decisions') },
        { heading: 'Evidence gaps', source: bound('evidence_gaps') },
        { heading: 'Checks not yet compliant', source: bound('checks') },
        { heading: 'Opinion', text: '' },
      ];
    default:
      return [
        opening,
        { heading: 'Chain of title', source: bound('title_chain') },
        { heading: 'Key findings', source: bound('findings', { materialOnly: true }) },
        { heading: 'Risks', source: bound('risks') },
        { heading: 'Actions', source: bound('actions') },
        { heading: 'Evidence gaps', source: bound('evidence_gaps') },
        { heading: 'Opinion', text: '' },
      ];
  }
}

/**
 * One line summarising the file, recomputed on every read.
 *
 * Deliberately not editable and deliberately not stored: it is the report's
 * own reading of itself, and a stale one at the top of a live document would
 * undermine every block below it.
 */
export function reportSummaryLine(project: DdProject): string {
  const open = project.findings.filter((f) => OPEN_FINDING.has(f.status));
  const material = open.filter((f) => MATERIAL.has(f.severity));
  const gaps = project.evidence.filter((e) => ['expected', 'requested', 'missing'].includes(e.status));
  const risks = project.risks.filter((r) => r.status !== 'closed');
  return `${open.length} open finding(s), ${material.length} material · ${risks.length} open risk(s) · ${gaps.length} evidence gap(s). Read from the registers, not a second copy of them.`;
}
