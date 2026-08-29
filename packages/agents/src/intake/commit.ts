import type { CreateCaseRequest, IntakeField, IntakeSession, ProjectBrief, ReferenceData } from '@realytica/shared';
import { assessmentFitCaution } from '@realytica/shared';
import { draftIdentity, draftProjectKind } from './fields';
import { readDraft } from './readout';

/**
 * Turn a finished draft into the request that creates a case.
 *
 * Deliberately not a tool the agent can call. Creating a case is the user's
 * decision, taken by pressing a button after seeing exactly what will be
 * built — a model that could do it on its own reading of "yes, go ahead" would
 * be acting on an interpretation of consent rather than on consent.
 *
 * Refuses a draft the engine could not screen. The check is `readDraft`'s, not
 * a second opinion: building a case the screen cannot run leaves someone with
 * an empty workspace and no explanation.
 */
export interface CommitRefusal {
  ok: false;
  reason: string;
  missing: string[];
}
export interface CommitReady {
  ok: true;
  request: CreateCaseRequest;
  /** Particulars the user never confirmed, carried so the caller can mark them on the case. */
  unconfirmed: IntakeField[];
}


export function commitDraft(
  session: Pick<IntakeSession, 'fields' | 'documents' | 'ownerName' | 'caseId'>,
  refData: ReferenceData,
  now: string,
): CommitReady | CommitRefusal {
  if (session.caseId) {
    return { ok: false, reason: 'This conversation has already produced a case.', missing: [] };
  }
  const readout = readDraft(session, refData, now);
  if (!readout.screenable) {
    return {
      ok: false,
      reason: 'There is not yet enough to screen this property, so building a case would produce an empty one.',
      missing: readout.gaps.filter(g => g.blocking).map(g => g.label),
    };
  }

  const identity = draftIdentity(session.fields);
  const unconfirmed = session.fields.filter(f => !f.confirmed);

  /*
   * The project kind carries across from the conversation.
   *
   * `source` is the load-bearing part: a kind the person picked is `user` and
   * the engine will not revise it, while one the conversation merely read off
   * the draft stays `inferred` and keeps showing its reasoning on the case.
   * Collapsing the two would turn "we think this is a land purchase" into
   * "you said this is a land purchase" at the moment a case is created.
   */
  const statedKind = draftProjectKind(session.fields);
  const inference = readout.project;
  const project: ProjectBrief | undefined = inference
    ? {
        kind: statedKind ?? inference.kind,
        source: statedKind ? 'user' : 'inferred',
        intent: 'unknown',
        inference,
        fitCaution: assessmentFitCaution(identity, statedKind ?? inference.kind),
        decidedAt: now,
      }
    : undefined;

  /*
   * The note is the audit trail for the conversation.
   *
   * A case built from a chat should carry, on its face, which of its
   * particulars nobody actually stated — otherwise an inference made in
   * conversation becomes indistinguishable from a fact by the time anyone
   * reads the case a week later.
   */
  const noteLines = [`Built from an intake conversation on ${now.slice(0, 10)}.`];
  if (project) {
    noteLines.push(
      '',
      project.source === 'user'
        ? `Assessed as: ${readout.assessment?.label ?? project.kind} — stated in the conversation.`
        : `Assessed as: ${readout.assessment?.label ?? project.kind} — read from the particulars, not stated. ${project.inference.basis.join(' ')}`,
    );
  }
  if (unconfirmed.length > 0) {
    noteLines.push(
      '',
      'Particulars inferred during that conversation and not confirmed by the user:',
      ...unconfirmed.map(f => `- ${f.label}: ${String(f.value)}${f.basis ? ` (inferred from ${f.basis})` : ''}`),
    );
  }

  return {
    ok: true,
    request: {
      identity,
      ownerName: session.ownerName?.trim() || 'Unnamed',
      notes: noteLines.join('\n'),
      project,
    },
    unconfirmed,
  };
}
