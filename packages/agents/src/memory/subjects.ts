/**
 * Subject-key normalisation for cross-case memory.
 *
 * A memory store is only as useful as its hit rate. "Sri. K. Ramaiah S/o
 * Krishnappa" on one case and "RAMAIAH, K." on the next are the same promoter,
 * and if they land under two keys the store politely reports that it has never
 * heard of either. Everything in this file exists to make that recall actually
 * hit, so it is written as a set of pure functions with no I/O and no clock —
 * cheap to test exhaustively, which is the only way to trust it.
 *
 * ## The deliberate asymmetry with the title graph
 *
 * The title graph's `mergeKey` and this key look superficially alike and are
 * calibrated in opposite directions. There, a wrong merge fuses two people into
 * one owner and corrupts a chain of title — so it is conservative. Here, a wrong
 * merge surfaces a prior case that turns out to be about someone else, which the
 * reader discards; a *missed* merge makes memory silently useless. So this fold
 * is deliberately more aggressive, and it is safe to be so only because nothing
 * downstream treats a memory item as evidence.
 *
 * That licence is not unlimited. Two guards keep it honest:
 *
 * - tokens of three characters or fewer are never folded, so initials and short
 *   names cannot collide through transliteration rules meant for longer words;
 * - the human-readable name travels separately in `MemoryFact.subjectLabel`, so
 *   the key never has to be legible and the reader always sees the name as the
 *   document actually spelt it.
 *
 * ## Known limits, stated rather than glossed
 *
 * - Party tokens are **sorted**, which is what merges "K. Ramaiah" with
 *   "Ramaiah, K." — and which also merges "Ramaiah Krishnappa" with "Krishnappa
 *   Ramaiah". Under the South Indian given-name/father's-name convention those
 *   are usually the same person, so the merge is more often right than wrong,
 *   but it is a merge we are choosing, not one we have proved.
 * - An `alias` / `@` clause is dropped rather than indexed, so a person recorded
 *   only under their alias on one case will not join up with the primary name on
 *   another. Indexing both would need a multi-key subject and is not worth the
 *   complexity yet.
 * - Transliteration folding covers the Kannada/Indic romanisation variants that
 *   are common and cheap (aspirates, the -aiah/-ayya ending, doubled
 *   consonants). It is not a phonetic algorithm and does not pretend to be.
 * - A source named by URL and the same source named by label agree only when the
 *   distinctive word survives both routes. `kaverionline.karnataka.gov.in` and
 *   "Kaveri Online Services" do meet at `source:kaveri`; `bbmp.gov.in` and "BBMP
 *   Property Tax Portal" do not, because the label names a specific service the
 *   host does not. Closing that would need a source registry rather than a
 *   string fold, which is the right fix and a larger one — until then the miss
 *   shows up honestly as a consulted subject with no history.
 */

import type { MemoryScope } from '@realytica/shared';

/* ==================================================================== */
/* Kinds                                                                */
/* ==================================================================== */

export type SubjectKind = 'party' | 'locality' | 'source' | 'procedure' | 'user';

/** Which `MemoryScope` a subject of each kind belongs to. */
export const SCOPE_FOR_SUBJECT_KIND: Record<SubjectKind, MemoryScope> = {
  party: 'party',
  locality: 'locality',
  source: 'source_reliability',
  procedure: 'procedure',
  user: 'user_preference',
};

export interface NormalisedSubject {
  kind: SubjectKind;
  /** The stored key, e.g. `party:ramaiah-k`. Prefixed so keys never collide across kinds. */
  key: string;
  /** Human display form — what goes in `MemoryFact.subjectLabel`. */
  label: string;
  /** The scope facts about this subject belong to. */
  scope: MemoryScope;
}

/* ==================================================================== */
/* Shared text plumbing                                                 */
/* ==================================================================== */

/**
 * Strip diacritics and fold typographic punctuation to ASCII.
 *
 * Names reach us from OCR, from portals that re-encode, and from hand typing, so
 * the same name arrives with curly apostrophes, non-breaking spaces and combining
 * marks in different combinations. None of that is identity.
 */
function toAscii(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ');
}

/** Everything that is not a letter or digit becomes a space. */
function toTokens(s: string): string[] {
  return s
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Title-case a token for display; a bare initial keeps its full stop. */
function displayToken(t: string): string {
  if (t.length === 1) return `${t.toUpperCase()}.`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ==================================================================== */
/* Party                                                                */
/* ==================================================================== */

/**
 * Clauses that introduce someone *other* than the person being named, or an
 * alternative name for them. Everything from the marker onwards is cut.
 *
 * `S/o Krishnappa` identifies the father, not the party, and keeping it would
 * put "Ramaiah S/o Krishnappa" and "Ramaiah" under different keys — the single
 * most common way an Indian party index fails to join up.
 */
const PARTY_RELATION_CUT =
  /\b(?:s|d|w|h|c|r)\s*[/.]\s*o\b|\b(?:son|daughter|wife|widow|husband)\s+of\b|\balias\b|\ba\.?\s?k\.?\s?a\.?\b|\balso\s+known\s+as\b|\brepresented\s+by\b|\brep\.?\s+by\b|\bthrough\s+(?:his|her|its)\b|\bgpa\s+holder\b|\s@\s/;

/** Titles and honorifics. Never identity, always noise. */
const PARTY_HONORIFICS = new Set([
  'sri', 'shri', 'sree', 'shree', 'smt', 'smpt', 'srimathi', 'shrimati', 'srimati',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'late', 'kum', 'kumari', 'kumar',
  'thiru', 'sardar', 'capt', 'col', 'maj', 'adv', 'er', 'messrs', 'sir', 'madam',
]);

/**
 * Legal-form tokens on an entity name.
 *
 * "Prestige Estates Projects Ltd" and "Prestige Estates Projects Pvt Ltd" are
 * one developer; the suffix records incorporation, not identity. Trade names
 * that could distinguish two firms — "Builders", "Developers", "Estates" — are
 * deliberately *not* stripped.
 */
const PARTY_LEGAL_FORMS = new Set([
  'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'incorporated',
  'corp', 'corporation', 'plc', 'company', 'co',
]);

/**
 * Fold one token onto its transliteration canonical form.
 *
 * Applied only to tokens longer than three characters — see the guard note at
 * the top of this file.
 */
function foldPartyToken(t: string): string {
  if (t.length <= 3) return t;
  let s = t;
  // The Kannada patronymic ending, which romanises half a dozen ways.
  s = s.replace(/(?:ayya|aiya|aiah|ayah|iyah|iah)$/, 'aiah');
  // Aspirated consonants: the classic Indic romanisation variance.
  s = s.replace(/chh/g, 'ch');
  s = s.replace(/shw/g, 'sw');
  s = s.replace(/th/g, 't');
  s = s.replace(/dh/g, 'd');
  s = s.replace(/bh/g, 'b');
  s = s.replace(/gh/g, 'g');
  s = s.replace(/kh/g, 'k');
  s = s.replace(/ph/g, 'f');
  // Anglicised vowel and consonant doublings.
  s = s.replace(/ck/g, 'k');
  s = s.replace(/ee/g, 'i');
  s = s.replace(/oo/g, 'u');
  s = s.replace(/y/g, 'i');
  s = s.replace(/([bcdfgjklmnpqrstvwxz])\1+/g, '$1');
  s = s.replace(/([aeiou])\1+/g, '$1');
  return s;
}

/** Keys are capped so one pathological name cannot produce an unbounded key. */
const MAX_KEY_TOKENS = 6;

interface CleanedName {
  /** Tokens in source order, honorifics and relation clauses removed, unfolded. */
  tokens: string[];
}

function cleanPartyName(raw: string): CleanedName {
  let s = toAscii(raw).toLowerCase();
  // `M/s` before punctuation is flattened, or it would survive as the tokens
  // `m` and `s` and be mistaken for initials.
  s = s.replace(/\bm\s*\/\s*s\b/g, ' ');
  // Parenthetical asides ("(late)", "(minor)", "(deceased)") are commentary.
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\[[^\]]*\]/g, ' ');
  const cut = s.search(PARTY_RELATION_CUT);
  if (cut > 0) s = s.slice(0, cut);
  const tokens = toTokens(s).filter(t => !PARTY_HONORIFICS.has(t) && !PARTY_LEGAL_FORMS.has(t));
  return { tokens };
}

/**
 * Values that are placeholders rather than names.
 *
 * Extraction fields carry text like "Independent valuer on file" or "Not
 * stated". Indexing those creates a phantom party that then appears to recur
 * across every case in the store, which is worse than learning nothing.
 */
const NON_NAME_MARKERS = [
  'on file', 'not stated', 'not available', 'not applicable', 'unknown', 'n/a',
  'to be confirmed', 'tbc', 'as per record', 'no name', 'redacted', 'illegible',
];

/** True when a raw extracted value should not be treated as a party name. */
export function looksLikePartyName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return false;
  const lower = trimmed.toLowerCase();
  if (NON_NAME_MARKERS.some(m => lower.includes(m))) return false;
  // A name is words, not a reference number: reject anything mostly digits.
  const digits = (trimmed.match(/\d/g) ?? []).length;
  if (digits > 0 && digits >= trimmed.replace(/\s/g, '').length / 2) return false;
  const { tokens } = cleanPartyName(trimmed);
  if (tokens.length === 0) return false;
  // Six or more tokens after honorifics are stripped is a sentence, not a name.
  if (tokens.length > 5) return false;
  return true;
}

/**
 * Normalise a party name to a subject.
 *
 * Returns `null` when nothing usable survives the fold — the caller should skip
 * rather than index an empty subject.
 */
export function partySubject(raw: string): NormalisedSubject | null {
  const { tokens } = cleanPartyName(raw);
  if (tokens.length === 0) return null;
  const folded = tokens.map(foldPartyToken);
  // Full tokens first, then initials — both alphabetically. Sorting is what
  // makes "K. Ramaiah" and "Ramaiah, K." one subject; putting the full tokens
  // first keeps the key led by the name-like part rather than by an initial.
  const full = folded.filter(t => t.length > 1).sort();
  const initials = folded.filter(t => t.length === 1).sort();
  const key = [...full, ...initials].slice(0, MAX_KEY_TOKENS).join('-');
  if (!key) return null;
  return {
    kind: 'party',
    key: `party:${key}`,
    label: tokens.map(displayToken).join(' '),
    scope: 'party',
  };
}

/* ==================================================================== */
/* Locality                                                             */
/* ==================================================================== */

/**
 * Tokens that place a locality rather than name it.
 *
 * "Whitefield" and "Whitefield, Bengaluru" are one locality. Bangalore is folded
 * to Bengaluru first so the older spelling is recognised as the same noise.
 */
const LOCALITY_NOISE = new Set([
  'bengaluru', 'karnataka', 'india', 'city', 'post', 'taluk', 'taluka',
  'district', 'dist', 'village', 'ward', 'zone', 'pin', 'pincode',
]);

/** Abbreviations worth expanding because Bengaluru addresses use them constantly. */
const LOCALITY_EXPANSIONS: Record<string, string> = {
  orr: 'outer ring road',
  bangalore: 'bengaluru',
  blr: 'bengaluru',
  bnglr: 'bengaluru',
  'b lore': 'bengaluru',
};

export function localitySubject(raw: string): NormalisedSubject | null {
  let s = toAscii(raw).toLowerCase();
  s = s.replace(/[()[\]]/g, ' ');
  let tokens = toTokens(s);
  // Expand before filtering, so `orr` becomes three real tokens and `bangalore`
  // becomes the noise token it is.
  tokens = tokens.flatMap(t => (LOCALITY_EXPANSIONS[t] ? LOCALITY_EXPANSIONS[t].split(' ') : [t]));
  // Six-digit runs are PIN codes.
  tokens = tokens.filter(t => !/^\d{6}$/.test(t));
  const stripped = tokens.filter(t => !LOCALITY_NOISE.has(t));
  // If the locality *is* the city ("Bengaluru" as a coarse subject) keep it
  // rather than normalising it out of existence.
  const kept = stripped.length > 0 ? stripped : tokens;
  const key = kept.slice(0, MAX_KEY_TOKENS).join('-');
  if (!key) return null;
  return {
    kind: 'locality',
    key: `locality:${key}`,
    label: kept.map(displayToken).join(' '),
    scope: 'locality',
  };
}

/* ==================================================================== */
/* Source                                                               */
/* ==================================================================== */

/**
 * Words that describe what a portal *is* rather than which portal it is.
 *
 * "Kaveri Online Services" and "Kaveri" must be one source, or the store learns
 * a separate reliability history for each way an agent happened to name it.
 */
const SOURCE_NOISE = new Set([
  'portal', 'online', 'service', 'services', 'website', 'site', 'web',
  'department', 'dept', 'govt', 'government', 'of', 'the', 'system',
  'karnataka', 'india', 'official', 'app', 'application',
]);

/** Host labels that are infrastructure, not identity. */
const HOST_NOISE = new Set([
  'www', 'in', 'com', 'org', 'net', 'gov', 'nic', 'co', 'karnataka', 'kar', 'info',
]);

function looksLikeHost(s: string): boolean {
  return /^[a-z0-9.:/_-]+$/i.test(s) && s.includes('.') && !s.includes(' ');
}

function hostOf(raw: string): string | null {
  const s = raw.trim();
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`);
    return url.hostname.toLowerCase();
  } catch {
    return looksLikeHost(s) ? s.toLowerCase() : null;
  }
}

/**
 * Trim `online` / `portal` off the end of a run-together token.
 *
 * `kaverionline.karnataka.gov.in` and the label "Kaveri Online Services" should
 * reach the same key, and this one rule is what closes that gap cheaply.
 */
function trimSourceSuffix(t: string): string {
  const trimmed = t.replace(/(?:online|portal|services|service)$/, '');
  return trimmed.length >= 3 ? trimmed : t;
}

export function sourceSubject(raw: string): NormalisedSubject | null {
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return null;

  const host = /\s/.test(trimmedRaw) ? null : hostOf(trimmedRaw);
  let tokens: string[];
  if (host) {
    const labels = host.split('.').filter(Boolean);
    const kept = labels.filter(l => !HOST_NOISE.has(l));
    tokens = (kept.length > 0 ? kept : labels.slice(0, 1)).map(trimSourceSuffix);
  } else {
    let s = toAscii(trimmedRaw).toLowerCase();
    s = s.replace(/[()[\]]/g, ' ');
    tokens = toTokens(s)
      // Version numbers ("Kaveri 2.0") are not a different source.
      .filter(t => !/^\d+$/.test(t))
      .filter(t => !SOURCE_NOISE.has(t))
      .map(trimSourceSuffix);
  }

  const key = tokens.filter(Boolean).slice(0, 5).join('-');
  if (!key) return null;
  return {
    kind: 'source',
    key: `source:${key}`,
    label: tokens.map(displayToken).join(' '),
    scope: 'source_reliability',
  };
}

/* ==================================================================== */
/* Procedure                                                            */
/* ==================================================================== */

/** Everything from these words on describes where, not what. */
const PROCEDURE_CLAUSE_CUT = /\b(?:from|at|with|before)\b/;

/** Leading verbs: every proof route is phrased as an instruction. */
const PROCEDURE_VERBS = new Set([
  'obtain', 'obtaining', 'apply', 'applying', 'request', 'requesting', 'get',
  'getting', 'download', 'collect', 'file', 'filing', 'secure', 'procure',
  'seek', 'raise', 'submit', 'lodge',
]);

const PROCEDURE_STOPWORDS = new Set(['the', 'a', 'an', 'for', 'of', 'to', 'and', 'via', 'in', 'on']);

/** Generic nouns that every route ends with and none is distinguished by. */
const PROCEDURE_TAIL_NOUNS = new Set([
  'order', 'application', 'applications', 'process', 'procedure', 'route',
  'request', 'pathway', 'step', 'steps',
]);

export function procedureSubject(raw: string): NormalisedSubject | null {
  let s = toAscii(raw).toLowerCase();
  s = s.replace(/[()[\]]/g, ' ');
  const cut = s.search(PROCEDURE_CLAUSE_CUT);
  if (cut > 0) s = s.slice(0, cut);
  let tokens = toTokens(s).filter(t => !PROCEDURE_STOPWORDS.has(t));
  while (tokens.length > 1 && PROCEDURE_VERBS.has(tokens[0])) tokens = tokens.slice(1);
  while (tokens.length > 1 && PROCEDURE_TAIL_NOUNS.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  const key = tokens.slice(0, 5).join('-');
  if (!key) return null;
  return {
    kind: 'procedure',
    key: `procedure:${key}`,
    label: tokens.map(displayToken).join(' '),
    scope: 'procedure',
  };
}

/* ==================================================================== */
/* User                                                                 */
/* ==================================================================== */

/**
 * The person running the case (`PropertyCase.ownerName` — the case owner, not
 * the registered owner of the property).
 *
 * Realytica has no accounts yet, so a blank name collapses to `user:default`
 * rather than being dropped: single-user installs still deserve a preference
 * history, and the key can be swapped for a real account id later without
 * changing anything that reads it.
 */
export function userSubject(raw?: string): NormalisedSubject {
  const party = raw ? partySubject(raw) : null;
  if (!party) {
    return { kind: 'user', key: 'user:default', label: 'Default user', scope: 'user_preference' };
  }
  return {
    kind: 'user',
    key: `user:${party.key.slice('party:'.length)}`,
    label: party.label,
    scope: 'user_preference',
  };
}

/* ==================================================================== */
/* Generic entry points                                                 */
/* ==================================================================== */

/** Normalise by kind. `user` never fails; the rest return `null` on empty input. */
export function subjectFor(kind: SubjectKind, raw: string): NormalisedSubject | null {
  switch (kind) {
    case 'party':
      return partySubject(raw);
    case 'locality':
      return localitySubject(raw);
    case 'source':
      return sourceSubject(raw);
    case 'procedure':
      return procedureSubject(raw);
    case 'user':
      return userSubject(raw);
  }
}

/**
 * Split a stored key back into its parts.
 *
 * Used when rendering a recall, so a consulted subject that returned nothing can
 * still be shown as "no history for this promoter" with the right wording.
 */
export function parseSubjectKey(key: string): { kind: SubjectKind; tail: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const prefix = key.slice(0, idx);
  const kinds: SubjectKind[] = ['party', 'locality', 'source', 'procedure', 'user'];
  const kind = kinds.find(k => k === prefix);
  if (!kind) return null;
  return { kind, tail: key.slice(idx + 1) };
}

/** De-duplicate subjects by key, keeping first-seen order and label. */
export function dedupeSubjects(subjects: (NormalisedSubject | null)[]): NormalisedSubject[] {
  const seen = new Map<string, NormalisedSubject>();
  for (const s of subjects) {
    if (!s) continue;
    if (!seen.has(s.key)) seen.set(s.key, s);
  }
  return [...seen.values()];
}
