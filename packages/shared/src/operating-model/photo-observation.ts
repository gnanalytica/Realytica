/**
 * What a model may say about a photograph, and the line it may not cross.
 *
 * A photograph is the one piece of evidence on this file that a model can
 * read directly and completely — no OCR, no extraction, nothing between the
 * pixels and the answer. That makes it the most tempting place in the product
 * to let a model state a conclusion, and therefore the place it matters most
 * that it cannot.
 *
 * ## Observation is not diagnosis
 *
 * "Dark staining below the parapet, roughly two metres wide, on the north
 * elevation" is an OBSERVATION. Anybody looking at the same photograph can
 * agree or disagree with it, and checking costs ten seconds.
 *
 * "Water ingress from a failed parapet upstand" is a DIAGNOSIS. It is a claim
 * about a cause that is not in the photograph — it is in a surveyor's head,
 * built from the staining plus the age of the building plus what the roof
 * looked like plus twenty years of having been wrong about it before. A model
 * that writes the second sentence has not read the photograph more carefully;
 * it has invented the part that was not there, in the confident register of
 * the part that was.
 *
 * So this record holds observations. A cause, a severity and a remedy are
 * findings, and findings on this file go through propose-and-review like every
 * other model conclusion — see `suggestedFindings`, which are CARDS, not
 * findings.
 *
 * ## Why it does not touch the caption
 *
 * `CaptureFacts.caption` is what the photographer wanted the viewer to see.
 * This is what a model saw. Merging them would produce a sentence with no
 * author, which is precisely the thing a diligence file cannot carry — and it
 * is the fourth time this codebase has drawn the same line, after the graph's
 * derived/authored split, the report's bound/authored blocks and the computed
 * check fields.
 */

/** What the photograph is OF, which decides what should be done with it. */
export type PhotoSubject =
  /** The property, or something on it. Observations apply. */
  | 'property'
  /**
   * A document, photographed. A khata extract shot on a phone, a notice board,
   * a sanction plan pinned to a wall. Belongs in the extraction path, not
   * here — describing a deed as "a printed page with a stamp" is useless when
   * the survey number on it is what somebody needs.
   */
  | 'document'
  /** Neither, or too poor to tell. Says so rather than guessing. */
  | 'unclear';

export const PHOTO_SUBJECT_LABEL: Record<PhotoSubject, string> = {
  property: 'The property',
  document: 'A photographed document',
  unclear: 'Could not tell',
};

/**
 * One thing visible in the frame, with how sure the model is and what would
 * settle it.
 *
 * `wouldSettle` is the field that makes an uncertain observation useful rather
 * than noise. "Staining that may be efflorescence or may be damp — a moisture
 * meter reading at the base of the wall would settle it" is an instruction. A
 * bare "possible damp, 0.4 confidence" is a number nobody can act on.
 */
export interface PhotoNote {
  text: string;
  /** 0..1, the model's own. Never presented without the text it qualifies. */
  confidence: number;
  /** The one check that would turn this from an observation into a fact. */
  wouldSettle?: string;
}

/**
 * A defect the model thinks is worth raising — as a proposal, never a finding.
 *
 * Held here rather than written to the register, and carried into a card by
 * `photoFindingDrafts`. The distinction is the product's whole discipline:
 * a model may draw a conclusion and a person may accept it, and the moment
 * those two collapse into one step the file stops being a record of what
 * somebody decided.
 */
export interface PhotoSuggestedFinding {
  title: string;
  /** What is visible, in the terms the observation used. Not the cause. */
  observed: string;
  /** Why it might matter — explicitly the model's reasoning, not a fact. */
  whyItMayMatter: string;
  suggestedSeverity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

export interface PhotoObservation {
  subject: PhotoSubject;
  /** One or two sentences: what is in the frame. The searchable part. */
  description: string;
  /** Discrete things visible — "scaffolding", "north elevation", "RCC frame". */
  elements: string[];
  notes: PhotoNote[];
  suggestedFindings: PhotoSuggestedFinding[];
  /** Anything about the photograph that limits what can be said from it. */
  limits?: string;
  model: string;
  at: string;
}

/**
 * The rules a photograph agent works under, as data.
 *
 * Written here rather than only in the prompt because two things need them:
 * the prompt, and the code that has to decide whether an answer obeyed them.
 * A rule that exists only inside a system prompt is a rule nothing can check.
 */
export const PHOTO_OBSERVATION_RULES: readonly string[] = [
  'Describe what is visible. Never state a cause, a diagnosis or a remedy — those are findings, and a finding is a person’s to accept.',
  'Never state a dimension, an area or a distance from a photograph unless a known object gives it scale, and then say what you scaled against.',
  'Never identify a person, read a face, or record a name, a number plate or anything else that identifies somebody who happens to be in shot.',
  'A photograph of a document is not a photograph of the property. Say so and stop — the extraction path reads documents.',
  'Say what the photograph does not let you see. A single elevation says nothing about the other three.',
];

/**
 * A photograph nothing can be said about, said plainly.
 *
 * Returned rather than throwing when a model declines or fails, so a batch of
 * forty photographs is never left half-annotated with no record of why.
 */
export function emptyObservation(model: string, at: string, limits: string): PhotoObservation {
  return { subject: 'unclear', description: '', elements: [], notes: [], suggestedFindings: [], limits, model, at };
}

/** True when the observation carries something worth showing a person. */
export function observationIsUseful(observation: PhotoObservation | undefined): boolean {
  if (!observation) return false;
  return Boolean(observation.description.trim() || observation.notes.length || observation.suggestedFindings.length);
}

/**
 * One line for the register and the graph.
 *
 * Always prefixed with who said it. A description that reads as the file's own
 * voice is exactly the failure this module exists to prevent, and the prefix
 * is the cheapest possible guard against it.
 */
export function describeObservation(observation: PhotoObservation | undefined): string {
  if (!observationIsUseful(observation)) return '';
  const parts = [observation!.description.trim()].filter(Boolean);
  if (observation!.notes.length) parts.push(`${observation!.notes.length} note(s)`);
  if (observation!.suggestedFindings.length) parts.push(`${observation!.suggestedFindings.length} proposed finding(s)`);
  return `Read by ${observation!.model}: ${parts.join(' · ')}`;
}
