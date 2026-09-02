/**
 * Cross-project memory — locality, developer, owner — using the same store
 * as cases. Facts are context, never evidence. sourceCaseId is the project id.
 */

import type { DdProject, MemoryFact, MemoryRecall } from '@realytica/shared';
import { LIFECYCLE_STAGE_LABEL, PROJECT_HEALTH_LABEL, packCompleteness, projectNextStep } from '@realytica/shared';
import { DEFAULT_HALF_LIFE_DAYS, DEFAULT_RECALL_LIMIT, memoryFactId } from './store';
import type { MemoryStore } from './types';
import type { RecallOptions } from './recall';
import { localitySubject, looksLikePartyName, partySubject, userSubject, type NormalisedSubject } from './subjects';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Subjects a project gives us a reason to look up: locality, developer, owner. */
export function subjectsForProject(project: DdProject): NormalisedSubject[] {
  const collected: Array<NormalisedSubject | null> = [
    localitySubject(`${project.location}, ${project.city}`),
    project.developer && looksLikePartyName(project.developer) ? partySubject(project.developer) : null,
    userSubject(project.owner),
  ];
  return collected.filter((s): s is NormalisedSubject => Boolean(s));
}

/** What earlier files know that bears on this project. */
export async function recallForProject(
  store: MemoryStore,
  project: DdProject,
  opts: RecallOptions,
): Promise<MemoryRecall> {
  const consultedSubjects = [...new Set([...subjectsForProject(project).map((s) => s.key), ...(opts.extraSubjects ?? [])])];
  const storedFactCount = (await store.snapshot()).length;
  if (consultedSubjects.length === 0) {
    return { facts: [], consultedSubjects: [], excludedCount: 0, storedFactCount };
  }
  const result = await store.query({
    subjects: consultedSubjects,
    // Deny by default rather than "everything unless told otherwise": an
    // omitted `tenants` on this path would be the whole leak back again, and
    // the failure would be invisible — a prompt with one extra locality
    // observation in it looks exactly like a prompt without one.
    tenants: opts.tenants ?? [project.tenantId ?? null],
    now: opts.now,
    asOf: opts.asOf,
    validAt: opts.validAt,
    excludeCaseIds: opts.includeOwnCase ? undefined : [project.id],
    limit: opts.limit ?? DEFAULT_RECALL_LIMIT,
    perScopeLimit: opts.perScopeLimit,
    halfLifeDays: opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    minConfidence: opts.minConfidence,
  });
  return {
    facts: result.facts,
    consultedSubjects,
    excludedCount: result.excludedCount,
    storedFactCount,
  };
}

/**
 * Deterministic facts a project is allowed to teach other files.
 *
 * No model. Locality, developer-as-promoter, owner, plus stage / health / pack
 * as context. Findings, check comments, and chat text are not copied as evidence.
 */
export function extractFactsFromProject(project: DdProject, opts: { now: string }): MemoryFact[] {
  const assertedAt = opts.now;
  const drafts: Array<Omit<MemoryFact, 'id'>> = [];
  const locality = localitySubject(`${project.location}, ${project.city}`);
  const stageLabel = LIFECYCLE_STAGE_LABEL[project.currentStage] ?? project.currentStage;
  const pack = packCompleteness(project);
  const next = projectNextStep(project);
  if (locality) {
    drafts.push({
      scope: 'locality',
      subject: locality.key,
      subjectLabel: locality.label,
      predicate: 'seen_as_project',
      object: `${project.type.replaceAll('_', ' ')} at ${project.currentStage}`,
      validFrom: project.createdAt,
      assertedAt,
      sourceCaseId: project.id,
      sourceRef: `project:${project.reference}`,
      confidence: 0.7,
    });
    drafts.push({
      scope: 'locality',
      subject: locality.key,
      subjectLabel: locality.label,
      predicate: 'at_stage',
      object: stageLabel,
      validFrom: project.createdAt,
      assertedAt,
      sourceCaseId: project.id,
      sourceRef: `project:${project.reference}#stage`,
      confidence: 0.65,
    });
    drafts.push({
      scope: 'locality',
      subject: locality.key,
      subjectLabel: locality.label,
      predicate: 'case_health',
      object: PROJECT_HEALTH_LABEL[project.health] ?? project.health,
      validFrom: project.createdAt,
      assertedAt,
      sourceCaseId: project.id,
      sourceRef: `project:${project.reference}#health`,
      confidence: 0.45,
    });
    drafts.push({
      scope: 'locality',
      subject: locality.key,
      subjectLabel: locality.label,
      predicate: 'pack_progress',
      object: `${pack.percent}% of the pack received`,
      validFrom: project.createdAt,
      assertedAt,
      sourceCaseId: project.id,
      sourceRef: `project:${project.reference}#pack`,
      confidence: 0.5,
    });
  }
  if (project.developer && looksLikePartyName(project.developer)) {
    const party = partySubject(project.developer);
    if (party) {
      drafts.push({
        scope: 'party',
        subject: party.key,
        subjectLabel: party.label,
        predicate: 'appeared_as',
        object: 'promoter',
        validFrom: project.createdAt,
        assertedAt,
        sourceCaseId: project.id,
        sourceRef: `project:${project.reference}#developer`,
        confidence: 0.8,
      });
      drafts.push({
        scope: 'party',
        subject: party.key,
        subjectLabel: party.label,
        predicate: 'known_as',
        object: project.developer.replace(/\s+/g, ' ').trim(),
        validFrom: project.createdAt,
        assertedAt,
        sourceCaseId: project.id,
        sourceRef: `project:${project.reference}#developer`,
        confidence: 0.8,
      });
    }
  }
  const user = userSubject(project.owner);
  drafts.push({
    scope: 'user_preference',
    subject: user.key,
    subjectLabel: user.label,
    predicate: 'owns_project',
    object: project.reference,
    validFrom: project.createdAt,
    assertedAt,
    sourceCaseId: project.id,
    sourceRef: `project:${project.id}`,
    confidence: 0.6,
  });
  drafts.push({
    scope: 'user_preference',
    subject: user.key,
    subjectLabel: user.label,
    predicate: 'working_next',
    object: next.title,
    validFrom: project.createdAt,
    assertedAt,
    sourceCaseId: project.id,
    sourceRef: `project:${project.reference}#next`,
    confidence: 0.4,
  });

  // The workspace is stamped here rather than on each draft: one place, so a
  // draft added later cannot be the one that goes out unattributed and ends up
  // recalled into somebody else's prompt. It is not part of the identity tuple
  // — `sourceCaseId` already separates two workspaces' facts, because a project
  // belongs to exactly one of them.
  const facts: MemoryFact[] = drafts.map((d) => {
    const confidence = round2(clamp01(d.confidence));
    const base = { ...d, confidence, ...(project.tenantId ? { tenantId: project.tenantId } : {}) };
    return { ...base, id: memoryFactId({ ...base, scope: d.scope }) };
  });
  const seen = new Set<string>();
  return facts.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}
