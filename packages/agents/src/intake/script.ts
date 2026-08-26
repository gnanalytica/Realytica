import type { IntakeField, IntakeGap, IntakeReadout, ReferenceData } from '@realytica/shared';
import { INTAKE_FIELDS, SQFT_PER_SQM } from './fields';
import { resolveLocality } from './readout';
import type { CaptureInput } from './fields';

/**
 * The conversation without a model.
 *
 * Every branch here produces the same *next step* the model would be steered
 * toward, in fixed words. That is what lets the intake ship as a real feature
 * on a deployment with no credentials configured, instead of as an error page
 * — and it is also the floor the model degrades to when a request fails
 * mid-conversation, so a dropped turn costs phrasing rather than progress.
 *
 * What is genuinely lost without a model is free-text reading: this cannot
 * turn "1200 sqft 3BHK in Whitefield asking 1.15" into four particulars. The
 * UI compensates by offering the current question as buttons or a typed input
 * bound to one field, so the conversation still advances one answer at a time.
 * Worse, and honest about being worse.
 */

export type FallbackReason = 'no_credentials' | 'no_agent_layer' | 'model_failed' | 'empty_reply';

const money = (n: number): string => {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

/**
 * The state block handed to the model each turn.
 *
 * Written as prose rather than JSON because it is read by a language model and
 * every line of it is something the model must not contradict. It carries only
 * what the deterministic core computed — no figure in here was written by a
 * model, which is what makes "never state a figure STATE did not give you" an
 * enforceable instruction rather than a hope.
 */
export function describeState(readout: IntakeReadout, fields: IntakeField[]): string {
  const lines: string[] = ['STATE (computed, authoritative — do not contradict any of it):'];

  lines.push(`Stage: ${readout.stage}.`);

  if (fields.length === 0) {
    lines.push('Nothing captured yet. This is the first exchange.');
  } else {
    lines.push('Captured so far:');
    for (const f of fields) {
      // The option's label, not its stored value: a model handed
      // `residential_apartment` tends to echo it back at the user, and nobody
      // calls their home that.
      const spec = INTAKE_FIELDS.find(x => x.path === f.path);
      const shown = spec?.options?.find(o => o.value === String(f.value))?.label ?? String(f.value);
      const said = f.saidAs ? ` (they said "${f.saidAs}")` : '';
      const mark =
        f.provenance === 'stated' || f.provenance === 'document'
          ? ''
          : ` — ${f.provenance.toUpperCase()}${f.basis ? ` from ${f.basis}` : ''}, NOT yet confirmed by them`;
      lines.push(`  - ${f.label}: ${shown}${said}${mark}`);
    }
    const unconfirmed = fields.filter(f => !f.confirmed);
    if (unconfirmed.length > 0) {
      lines.push(
        `  ${unconfirmed.length} of these you inferred and they have not confirmed. If a natural moment arises, check one — do not interrogate them about all of them.`,
      );
    }
  }

  if (readout.preview) {
    const p = readout.preview;
    lines.push(
      '',
      'PREVIEW — the engine has screened this draft. These figures are the engine\'s; use them and do not alter them:',
      `  Indicative range: ${money(p.indicativeValue.low)} to ${money(p.indicativeValue.high)}.`,
      `  Verdict: ${p.recommendation.verdict.replace(/_/g, ' ')} — ${p.recommendation.headline}`,
      `  Confidence: ${p.confidence.band} (${p.confidence.score}/100).`,
    );
    const worst = [...p.risks].sort((a, b) => {
      const order = { critical: 0, serious: 1, warning: 2, info: 3 } as const;
      return order[a.severity] - order[b.severity];
    })[0];
    if (worst) lines.push(`  Most serious finding: ${worst.title} (${worst.severity}) — ${worst.description}`);
  } else {
    lines.push('', 'No preview yet — the engine cannot screen this draft until the blocking particulars below are known.');
  }

  const blocking = readout.gaps.filter(g => g.blocking);
  const optional = readout.gaps.filter(g => !g.blocking);
  if (blocking.length > 0) {
    lines.push('', 'STILL BLOCKING a screen (ask for these first):');
    for (const g of blocking) lines.push(`  - ${g.label} (${g.path}) — ${g.consequence}`);
  }
  if (optional.length > 0) {
    lines.push('', 'Would sharpen the answer (ask only once nothing is blocking):');
    for (const g of optional.slice(0, 6)) lines.push(`  - ${g.label} (${g.path}) — ${g.consequence}`);
  }

  const outstanding = readout.documents.filter(d => !d.received);
  const critical = outstanding.filter(d => d.critical);
  if (critical.length > 0) {
    lines.push('', 'DOCUMENTS still needed, most important first. Ask for one or two, and say what each settles:');
    for (const d of critical.slice(0, 4)) lines.push(`  - ${d.label} — settles: ${d.settles}`);
  }
  const held = readout.documents.filter(d => d.received);
  if (held.length > 0) lines.push('', `Already received: ${held.map(d => d.label).join(', ')}.`);

  /*
   * One line, and it has to agree with the stage.
   *
   * `nextQuestion` is the next *particular*, which is the right answer while
   * something is blocking a screen and the wrong one once the blockers are
   * gone and critical documents are outstanding — at that point the useful
   * ask is the document. Saying "ask for the asking price" directly above a
   * list headed "documents still needed" is how a state block stops being
   * trusted.
   */
  const topDocument = critical[0];
  if (readout.stage === 'documents' && topDocument) {
    lines.push('', `The single most useful thing to ask for now: the ${topDocument.label} — it settles ${topDocument.settles}`);
  } else if (readout.nextQuestion) {
    lines.push('', `The single most useful thing to ask for now: ${readout.nextQuestion.label} — ${readout.nextQuestion.consequence}`);
  }
  if (readout.stage === 'ready') {
    lines.push('', 'The draft is ready to build. Offer it; do not build it yourself.');
  }
  return lines.join('\n');
}

const OPENER =
  "Tell me about the property — where it is, what it is, and roughly how big. Three answers and I can put a real number and the first findings in front of you.";

function askFor(readout: IntakeReadout): string {
  const gap = readout.nextQuestion;
  if (!gap) return 'Anything else you can tell me about the property will sharpen the answer.';
  const spec = INTAKE_FIELDS.find(f => f.path === gap.path);
  if (spec?.options) {
    return `${gap.label}? (${spec.options.map(o => o.label).join(' / ')}) — ${gap.consequence}`;
  }
  return `What is the ${gap.label.toLowerCase()}? ${gap.consequence}`;
}

/** The deterministic reply, used when no model ran or the model returned nothing. */
export function fallbackReply(readout: IntakeReadout, userMessage: string, reason: FallbackReason): string {
  const preamble =
    reason === 'no_credentials' || reason === 'no_agent_layer'
      ? "I'm running without a language model configured, so I can't read free text — but I can still take you through this and build the case. Answer each question directly and everything else works exactly the same."
      : '';

  const parts: string[] = [];
  if (preamble && readout.stage === 'orienting') parts.push(preamble);
  if (readout.stage === 'orienting') {
    parts.push(reason === 'no_credentials' || reason === 'no_agent_layer' ? askFor(readout) : OPENER);
    return parts.join('\n\n');
  }

  if (readout.preview) {
    const p = readout.preview;
    parts.push(
      `On what I have: ${money(p.indicativeValue.low)} to ${money(p.indicativeValue.high)}, ${p.recommendation.verdict.replace(/_/g, ' ')} at ${p.confidence.band} confidence.`,
    );
  }

  const nextDoc = readout.documents.find(d => d.critical && !d.received);
  if (readout.stage === 'ready') {
    parts.push('That is enough to build the case. Everything still open will show as a gap on the screen rather than blocking it.');
  } else if (readout.gaps.some(g => g.blocking)) {
    parts.push(askFor(readout));
  } else if (nextDoc) {
    parts.push(`Do you have the ${nextDoc.label.toLowerCase()}? It settles: ${nextDoc.settles}`);
  } else {
    parts.push(askFor(readout));
  }

  // No `stage !== 'orienting'` guard here: the orienting branch returned above,
  // so by this line it cannot be orienting and the compiler says so.
  if (preamble) parts.push(`(${preamble})`);
  return parts.join('\n\n');
}

/** The first thing the concierge says, before the user has said anything. */
export function openingTurn(hasModel: boolean): string {
  return hasModel
    ? OPENER
    : `${OPENER}\n\nI'm running without a language model configured, so answer each question directly rather than in a sentence — everything else works the same.`;
}

/* ==================================================================== */
/* Answering the question that was actually asked                       */
/* ==================================================================== */

/**
 * Read one message as a direct answer to one question.
 *
 * This is not free-text parsing and must not grow into it. It runs only when
 * no model read the message, and it only ever considers the single gap the
 * conversation just asked about — "what is the locality?" followed by
 * "Whitefield" is an answer, and treating it as one is the difference between
 * a guided intake that works and a chat box that silently discards everything
 * typed into it.
 *
 * Returns nothing when the message does not read as an answer, which leaves
 * the deterministic reply to ask again rather than storing a guess.
 */
export function answerCurrentGap(
  message: string,
  gap: IntakeGap | undefined,
  refData?: ReferenceData,
): CaptureInput | undefined {
  if (!gap) return undefined;
  const spec = INTAKE_FIELDS.find(f => f.path === gap.path);
  if (!spec) return undefined;
  const text = message.trim();
  if (!text) return undefined;

  if (spec.kind === 'enum') {
    const lower = text.toLowerCase();
    /*
     * Exact first, then the option named inside a phrase.
     *
     * The loose pass matches the value's own words ("residential_plot" ->
     * "residential plot") and each half of a slashed label ("Residential plot
     * / site"), because a whole-label match never fires: nobody types
     * "Residential plot / site". Longest match wins, so "residential plot"
     * beats a bare "plot" that another option might also contain.
     */
    const phrases = (o: { value: string; label: string }): string[] =>
      [o.value.replace(/_/g, ' '), ...o.label.split('/').map(x => x.trim())]
        .map(x => x.toLowerCase())
        .filter(x => x.length >= 4);
    const loose = (spec.options ?? [])
      .map(o => ({ o, hit: phrases(o).filter(px => lower.includes(px)).sort((a, b) => b.length - a.length)[0] }))
      .filter((x): x is { o: { value: string; label: string }; hit: string } => x.hit !== undefined)
      .sort((a, b) => b.hit.length - a.hit.length)[0]?.o;
    const hit =
      spec.options?.find(o => o.label.toLowerCase() === lower) ??
      spec.options?.find(o => o.value.toLowerCase() === lower) ??
      loose;
    return hit ? { path: gap.path, value: hit.value, provenance: 'stated', saidAs: text } : undefined;
  }

  if (spec.kind === 'number') {
    const parsed = parseIndianQuantity(text);
    return parsed === undefined ? undefined : { path: gap.path, value: parsed.value, provenance: 'stated', saidAs: text };
  }

  if (spec.kind === 'boolean') {
    if (/^(yes|y|true)\b/i.test(text)) return { path: gap.path, value: true, provenance: 'stated', saidAs: text };
    if (/^(no|n|false)\b/i.test(text)) return { path: gap.path, value: false, provenance: 'stated', saidAs: text };
    return undefined;
  }

  // A string answer to a string question. Rejected when it reads as a
  // sentence rather than a value — someone typing "actually can you tell me
  // about stamp duty" into the locality question has not answered it, and
  // storing that as their locality would be worse than not hearing them.
  if (text.length > 60 || /\?$/.test(text)) return undefined;

  /*
   * Locality is the one string field that can actually be checked, so it is.
   *
   * Without this, anything short became your locality: "hello there" and "show
   * me the Whitefield one" were both accepted, and the draft then sat on a
   * locality the reference data has never heard of, quietly refusing to
   * produce a preview with nothing on screen to say why. Validating against
   * the same list that prices everything is both stricter and more honest —
   * an unrecognised name is not an answer, and the conversation asks again.
   */
  if (gap.path === 'locality' && refData && !resolveLocality(text, refData).match) return undefined;

  return { path: gap.path, value: text, provenance: 'stated', saidAs: text };
}

/**
 * Indian quantity notation, for the one field being asked about.
 *
 * Areas are quoted in square feet in Bengaluru and stored in square metres;
 * prices are quoted in lakh and crore. Both conversions are stated back to the
 * user through `saidAs`, so a misread is visible rather than silent.
 */
export function parseIndianQuantity(text: string): { value: number } | undefined {
  const t = text.toLowerCase().replace(/,/g, '');

  const dims = /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)/.exec(t);
  if (dims) {
    // A "30x40 site" is feet, always — the phrase is never used in metres.
    return { value: (parseFloat(dims[1]) * parseFloat(dims[2])) / SQFT_PER_SQM };
  }

  const num = /(\d+(?:\.\d+)?)/.exec(t);
  if (!num) return undefined;
  const n = parseFloat(num[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;

  if (/\bcr\b|crore/.test(t)) return { value: Math.round(n * 10_000_000) };
  // `\bl\b` does not match the "l" in "85l" — digits and letters are both word
  // characters, so there is no boundary between them. Matched against the
  // digits instead, which is how people actually write it.
  if (/\blakh?s?\b|\d\s*l\b/.test(t)) return { value: Math.round(n * 100_000) };
  if (/sq\s*m|sqm|square met/.test(t)) return { value: n };
  if (/sq\s*ft|sqft|square f(?:ee|oo)t|\bft\b/.test(t)) return { value: n / SQFT_PER_SQM };
  return { value: n };
}
