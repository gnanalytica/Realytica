/**
 * Record ids in a model's prose become links, or stop being printed.
 *
 * A real answer read:
 *
 *   Legal DD: scope scp_1a06d7c69ff-3aabde155fcff8-41b1e44a4fe088 ("legal")
 *   under the Approval / Compliance DD (dd_1a06d7c69ff-9e8d8b87279e9-0df31…).
 *
 * Forty-six characters of primary key, twice, in a sentence about five pending
 * checks. Nobody reads an id, nobody can act on one, and the parenthetical was
 * the same record the four words before it had just named in English.
 *
 * The chat renderer has understood `[id]` for a long time: it resolves the id
 * to that record's real title and draws a chip that opens the record in the
 * work pane. What it cannot do is guess that a bare `scp_…` in the middle of a
 * sentence was meant as one. The prompt does ask for titles rather than ids —
 * and a prompt is a request, not a guarantee, which is why this exists at the
 * seam instead. Every answer passes through here on its way to a person.
 *
 * Two rules, and the second is the one that makes the result read like a
 * sentence rather than a database dump:
 *
 * **A bare id becomes a link.** Wrapped as `[id]` so the existing renderer
 * shows the title and opens the record. An id belonging to no record on this
 * project is left exactly as written — inventing a link to nothing would be
 * worse than an ugly string, and a reader who sees the raw id can at least
 * tell somebody about it.
 *
 * **A parenthesis holding only an id the sentence already named is deleted.**
 * "the Approval / Compliance DD (dd_1a06…)" says the same thing twice, once in
 * a form nobody can read. The prose keeps the name; the id goes.
 */

import type { DdProject } from './types';
import { graphNodeLabels } from './sitting';

/**
 * The id shapes this product mints, as a prefix set.
 *
 * Matched by prefix rather than by a general "looks like an id" pattern so
 * that a survey number, a registration number or a document reference — the
 * things a Karnataka file is full of — can never be mistaken for one of ours
 * and mangled into a broken link.
 */
const ID = String.raw`(?:prj|ast|dd|scp|chk|fnd|rsk|act|ev|dec|rep|val|prp|cht|aud|flw|run)_[A-Za-z0-9][A-Za-z0-9_-]*`;

/** A bare id, not already inside a `[…]` token. */
const BARE_ID = new RegExp(String.raw`(?<!\[)(?<!\[ev:)\b(${ID})\b(?!\])`, 'g');

/** A parenthesis whose entire content is one id, with the space before it. */
const PARENTHESISED_ID = new RegExp(String.raw`\s*\((${ID})\)`, 'g');

/** Loose equality for "the sentence already said this": case and punctuation blind. */
function said(haystack: string, label: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const needle = norm(label);
  return needle.length > 0 && norm(haystack).includes(needle);
}

/**
 * How far back to look for a name the parenthesis is repeating.
 *
 * Long enough to cover a title and the few words of sentence around it, short
 * enough that a mention two sentences earlier does not license deleting an id
 * whose record has not been named nearby.
 */
const LOOKBACK = 80;

/**
 * Rewrite one assistant answer.
 *
 * Returns the text unchanged when it holds no ids, which is the common case —
 * the deterministic paths cite titles already.
 */
export function linkRecordIds(project: DdProject, text: string): string {
  if (!text || !new RegExp(ID).test(text)) return text;
  const labels = new Map(graphNodeLabels(project).map((n) => [n.id, n.label]));

  // Redundant parentheticals first: once a bare id has become `[id]` the
  // parenthesis is no longer recognisable as one, and it is the whole
  // parenthesis that has to go, not just its contents.
  let out = text.replace(PARENTHESISED_ID, (whole, id: string, at: number) => {
    const label = labels.get(id);
    if (!label) return whole;
    return said(text.slice(Math.max(0, at - LOOKBACK), at), label) ? '' : whole;
  });

  out = out.replace(BARE_ID, (whole, id: string) => (labels.has(id) ? `[${id}]` : whole));
  return out;
}
