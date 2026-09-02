/**
 * A person editing the report by talking to it.
 *
 * The report is the one surface where "just let the model write it" is most
 * tempting and most wrong. So the same authorship law that governs every other
 * register governs this one, with the same split:
 *
 *   A PERSON saying "add a note under Risks: the rajakaluve setback is
 *   unresolved" is an instruction. It executes, and the paragraph is theirs.
 *
 *   A MODEL concluding the same thing raises an `edit_report` card. Somebody
 *   accepts it, and only then is it in the document.
 *
 * And one rule on top, which is this module's own: neither of them may write
 * into a bound block. A block that reads the findings register says what the
 * register says. If a person wants to say it differently they detach it —
 * by name, deliberately — and the document then shows that the paragraph
 * stopped updating. `editReportBlock` enforces that; this file just makes
 * "detach the findings section" a sentence you can type.
 *
 * Subject resolution follows the clarifier's rule rather than guessing: a
 * phrase that could mean two sections offers both. A wrong guess when adding
 * a paragraph is untidy; a wrong guess when REMOVING one destroys somebody's
 * writing, which is why removal is held to the strict reading.
 */

import type { ChatChoice, DdProject, GeneratedReport, ReportBlock } from './types';
import { REPORT_SOURCE_LABEL, reportIsFrozen } from './report-blocks';

export type ReportCommandKind = 'add_note' | 'remove_block' | 'detach_block' | 'reattach_block' | 'issue' | 'rename_block';

export interface ReportCommand {
  kind: ReportCommandKind;
  /** The block the sentence is about, when it names one. */
  blockId?: string;
  /** Prose for `add_note`, or the new heading for `rename_block`. */
  text?: string;
  heading?: string;
}

/* ------------------------------------------------------------------ */
/* Recognising that a sentence is about the report at all              */
/* ------------------------------------------------------------------ */

const REPORT_NOUN = /\b(report|pack|memo|write-?up|document)\b/i;

const ADD_NOTE =
  /\b(add|append|insert|write|put|note)\b[^.]*?\b(paragraph|note|line|section|caveat|comment|sentence|point)\b/i;
const REMOVE = /\b(remove|delete|drop|take out|get rid of)\b/i;
const DETACH = /\b(detach|unbind|unlink|freeze|let me edit|make .{0,12}editable|edit .{0,20}\b(section|block)\b)\b/i;
const REATTACH = /\b(re-?attach|re-?bind|make .{0,12}live|go back to the register)\b/i;
const ISSUE = /\b(issue|finali[sz]e|sign off|send|publish|lock)\b[^.]*\b(report|pack|memo|document)\b|\b(report|pack|memo)\b[^.]*\b(issue|finali[sz]e|sign off)\b/i;
const RENAME = /\b(rename|retitle|call)\b[^.]*\b(section|block|heading)\b/i;

/**
 * True when this sentence is a person's instruction about the report.
 *
 * Deliberately demands the report noun on everything except a sitting-scoped
 * detach: "remove the Actions section" while looking at a project register
 * means something entirely different, and answering it as a report edit would
 * be the confident wrong answer the clarifier exists to prevent.
 */
export function looksLikeReportCommand(question: string, hasOpenReport: boolean): boolean {
  const q = question.trim();
  if (!q || !hasOpenReport) return false;
  if (ISSUE.test(q)) return true;
  if (!REPORT_NOUN.test(q)) return false;
  return ADD_NOTE.test(q) || REMOVE.test(q) || DETACH.test(q) || REATTACH.test(q) || RENAME.test(q);
}

/** The report a bare "the report" means: the newest one still editable. */
export function openReportOf(project: DdProject): GeneratedReport | undefined {
  for (let i = project.reports.length - 1; i >= 0; i -= 1) {
    const report = project.reports[i]!;
    if (!reportIsFrozen(report.status)) return report;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Which block                                                          */
/* ------------------------------------------------------------------ */

function blockLabel(block: ReportBlock): string {
  return block.heading?.trim() || (block.source ? REPORT_SOURCE_LABEL[block.source.kind] : 'Untitled');
}

const STOP = new Set([
  'the', 'a', 'an', 'to', 'from', 'in', 'on', 'of', 'for', 'and', 'section', 'block',
  'report', 'pack', 'memo', 'paragraph', 'note', 'line', 'add', 'remove', 'delete',
  'drop', 'detach', 'edit', 'under', 'about', 'please', 'my', 'this', 'that', 'it',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export interface BlockCandidate {
  block: ReportBlock;
  score: number;
}

/**
 * Rank the blocks a phrase could mean.
 *
 * The same shape the clarifier uses everywhere else: a score, a decisive
 * margin, and an honest "I could not tell" rather than the nearest match. A
 * quoted phrase is treated as exact, because somebody who typed quotes has
 * already told us they mean that string.
 */
export function rankBlocks(report: GeneratedReport, phrase: string): BlockCandidate[] {
  const quoted = phrase.match(/["“”']([^"“”']{2,})["“”']/)?.[1];
  const needle = (quoted ?? phrase).toLowerCase();
  const words = tokens(quoted ?? phrase);

  return report.body.blocks
    .map((block) => {
      const label = blockLabel(block).toLowerCase();
      let score = 0;
      if (quoted && label === quoted.toLowerCase()) score += 40;
      else if (needle.includes(label) && label.length > 3) score += 22;
      for (const word of words) if (label.includes(word)) score += 8;
      if (block.source && words.includes(block.source.kind.split('_')[0]!)) score += 6;
      return { block, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

const DECISIVE = 6;

export type BlockResolution =
  | { state: 'confident'; block: ReportBlock }
  | { state: 'ambiguous'; candidates: BlockCandidate[] }
  | { state: 'absent' };

export function resolveBlock(report: GeneratedReport, phrase: string): BlockResolution {
  const ranked = rankBlocks(report, phrase);
  if (!ranked.length) return { state: 'absent' };
  if (ranked.length === 1) return { state: 'confident', block: ranked[0]!.block };
  if (ranked[0]!.score - ranked[1]!.score >= DECISIVE) return { state: 'confident', block: ranked[0]!.block };
  return { state: 'ambiguous', candidates: ranked.slice(0, 4) };
}

/** The offer we make instead of picking one. */
export function blockChoices(report: GeneratedReport, candidates: BlockCandidate[], verb: string): ChatChoice[] {
  return candidates.map((row) => ({
    id: row.block.id,
    label: blockLabel(row.block),
    detail: row.block.origin === 'derived' ? 'reads the registers' : 'your words',
    send: `${verb} the "${blockLabel(row.block)}" section of the report`,
  }));
}

/* ------------------------------------------------------------------ */
/* Parsing the instruction                                              */
/* ------------------------------------------------------------------ */

/**
 * Pull the prose out of "add a note under Risks: the setback is unresolved".
 *
 * Everything after the first colon is the note; everything before it is where
 * to put it. Without a colon there is no note to add, and saying so beats
 * inventing one — a report paragraph nobody wrote is the exact failure the
 * whole propose-and-review rule exists to prevent.
 */
export function parseNote(question: string): { where: string; text: string } | null {
  const colon = question.indexOf(':');
  if (colon < 0) return null;
  const text = question.slice(colon + 1).trim();
  if (text.length < 2) return null;
  return { where: question.slice(0, colon), text };
}

/** Pull the new heading out of "rename the Risks section to Exposures". */
export function parseRename(question: string): { where: string; heading: string } | null {
  const match = question.match(/^(.*?)\bto\s+["“]?([^"”.]{2,60})["”]?\s*\.?$/i);
  if (!match) return null;
  return { where: match[1] ?? '', heading: (match[2] ?? '').trim() };
}

/**
 * What a person's report sentence resolves to, or what to ask them instead.
 *
 * Returns `choices` rather than a command whenever the subject is ambiguous —
 * and for `remove`, whenever it is anything short of certain. Deleting the
 * wrong section deletes writing that exists nowhere else.
 */
export function interpretReportCommand(
  project: DdProject,
  question: string,
): { command?: ReportCommand; report?: GeneratedReport; choices?: ChatChoice[]; say?: string } {
  const report = openReportOf(project);
  if (!report) {
    return { say: 'There is no editable report on this file. Generate one first — an issued report stays exactly as it was read.' };
  }
  const q = question.trim();

  if (ISSUE.test(q)) return { report, command: { kind: 'issue' } };

  if (RENAME.test(q)) {
    const parsed = parseRename(q);
    if (!parsed) return { report, say: 'Say what to rename it to — “rename the Risks section to Exposures”.' };
    const found = resolveBlock(report, parsed.where);
    if (found.state === 'ambiguous') return { report, choices: blockChoices(report, found.candidates, 'rename') };
    if (found.state === 'absent') return { report, say: `Nothing in this report is called “${parsed.where.trim()}”.` };
    return { report, command: { kind: 'rename_block', blockId: found.block.id, heading: parsed.heading } };
  }

  if (ADD_NOTE.test(q)) {
    const parsed = parseNote(q);
    if (!parsed) {
      return {
        report,
        say: 'Give me the words after a colon — “add a note under Risks: the rajakaluve setback is unresolved”. I will not write the paragraph for you as your own.',
      };
    }
    const found = resolveBlock(report, parsed.where);
    return {
      report,
      command: {
        kind: 'add_note',
        // An unplaceable note goes at the end rather than into the nearest
        // section: putting somebody's words under the wrong heading changes
        // what they said.
        blockId: found.state === 'confident' ? found.block.id : undefined,
        text: parsed.text,
      },
    };
  }

  if (REATTACH.test(q)) {
    const found = resolveBlock(report, q);
    if (found.state === 'ambiguous') return { report, choices: blockChoices(report, found.candidates, 'reattach') };
    if (found.state === 'absent') return { report, say: 'Which section should go back to reading the registers?' };
    return { report, command: { kind: 'reattach_block', blockId: found.block.id } };
  }

  if (DETACH.test(q)) {
    const found = resolveBlock(report, q);
    if (found.state === 'ambiguous') return { report, choices: blockChoices(report, found.candidates, 'detach') };
    if (found.state === 'absent') return { report, say: 'Which section do you want to take off the registers and edit yourself?' };
    return { report, command: { kind: 'detach_block', blockId: found.block.id } };
  }

  if (REMOVE.test(q)) {
    const found = resolveBlock(report, q);
    // Held to the strict reading on purpose: a wrong guess here deletes a
    // paragraph that exists nowhere else.
    if (found.state === 'ambiguous') return { report, choices: blockChoices(report, found.candidates, 'remove') };
    if (found.state === 'absent') return { report, say: 'Which section should come out? Nothing matched closely enough to act on.' };
    return { report, command: { kind: 'remove_block', blockId: found.block.id } };
  }

  return { report, say: 'I can add a note, remove, rename, detach or reattach a section, or issue the report.' };
}
