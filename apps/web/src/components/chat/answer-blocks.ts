/**
 * Turning a model's prose into blocks, without a markdown dependency and
 * without trusting the model to emit anything in particular.
 *
 * The copilot answers in plain text and is not instructed to format. It still
 * writes the way anything trained on prose writes — a lead sentence, then
 * dashes or numbers when it enumerates, occasionally a pipe table when it
 * compares. Rendering all of that into one `<p>` threw the structure away and
 * produced the wall of text this exists to fix.
 *
 * So this READS structure rather than requiring it. Every rule degrades to a
 * paragraph: a malformed table is prose, a lone dash is prose, and a model
 * that formats nothing gets exactly what it gets today. That is the whole
 * design constraint — the free-tier models this deployment runs on cannot be
 * relied on to follow an output contract, so nothing here may depend on one.
 *
 * Deliberately NOT markdown. Full markdown would invite links and images and
 * raw HTML from a model into a page that renders case data, and the answer to
 * "can the model emit an anchor tag" has to be no. The vocabulary here is
 * closed: headings, bullets, numbers, tables, flags, and inline emphasis/code.
 */

import { memTagPrinted, projectFrameNames, type DdProject, type MemTagWords, type ProjectChatTurn, type ScreenResult, type ValuationRun } from '@realytica/shared';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  /**
   * `[ev:xyz]` — an evidence id the answer cited in the flow of a sentence.
   * `[ev:xyz:p3]` cites page 3 of that paper, and the chip opens it there.
   */
  | { kind: 'evidence'; id: string; page?: number }
  /** `[dd-risk-…]` — a graph node id, rendered with its real label. */
  | { kind: 'node'; id: string }
  /**
   * Where a fact of the project's memory stood when the sentence before it
   * was written: approved, waiting, or a thought. Never read out of the
   * text. It is placed where the turn itself says a tag was printed.
   */
  | { kind: 'memory'; tag: MemTagWords }
  /**
   * `[notes:<meeting>]` or `[notes:<meeting>:<item>]`: a way to open the
   * notes of a meeting, at the words one item of them rests on. A way to
   * look, like a citation, and it says nothing of where anything stands.
   */
  | { kind: 'notes'; meetingId: string; itemId?: string }
  /**
   * A bracketed token that is plainly one of our ids, of a kind the chat can
   * open, and resolves to nothing.
   *
   * Observed in real answers: `[dd-check-…bda_bmrda_acquisition]`, where the
   * model abbreviated the id it was quoting. Left as prose it prints an
   * ellipsis and an underscore-cased key in the middle of a sentence, which
   * reads as a rendering fault. It is not dropped either — a reference the
   * answer made and we cannot follow is a fact about the answer, and hiding
   * it would present an unsupported claim as a clean one.
   */
  | { kind: 'dangling'; id: string };

export type Block =
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'heading'; spans: Inline[] }
  | { kind: 'bullets'; items: Inline[][] }
  /**
   * `start` is the number the first item was written with, kept when it is
   * not 1, so a list picked up again after a paragraph counts on from where
   * it was. `details` are the dashed lines written under each item, by the
   * item's place, and are absent when no item has any.
   */
  | { kind: 'numbers'; items: Inline[][]; start?: number; details?: Inline[][][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  /** A line that opens with the flag mark: something that differs, falls short or is at risk. */
  | { kind: 'flag'; spans: Inline[] }
  | { kind: 'rule' };

/**
 * A citation: `[ev:<paper's id>]`, or `[ev:<paper's id>:p<page>]` for one
 * page of it, as in `[ev:ev_1a2b-3c4d:p3]`. The page is a whole number from
 * 1, written with no space and no full stop. Each token is one chip that
 * opens its own paper, so a sentence resting on two papers carries two.
 */
const EVIDENCE_TOKEN = /\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/;
/** The page at the end of a citation's id. No id this product mints holds a colon. */
const CITED_PAGE = /^(.+):p([1-9]\d{0,3})$/;

/** The span a citation becomes: the paper, and the page when one is named. */
function cited(token: string): Inline {
  const paged = CITED_PAGE.exec(token);
  return paged ? { kind: 'evidence', id: paged[1], page: Number(paged[2]) } : { kind: 'evidence', id: token };
}

const NOTES_TOKEN = /\[notes:([A-Za-z0-9_]{4,80})(?::([A-Za-z0-9_]{4,80}))?\]/;
/** Every bracketed token on a line. The ellipsis is let in so that an id a model cut short is still read as one. */
const NODE_TOKENS = /\[([A-Za-z0-9][A-Za-z0-9_.:…-]*)\]/g;

/**
 * The facts a turn rests on, as the turn keeps them: each with its tag and
 * the places in the turn's text where the server printed that tag.
 */
export type TagPlaces = ReadonlyArray<{ tag: 'approved' | 'proposed' | 'thought'; stands?: boolean; at?: readonly number[] }>;

/**
 * The two characters an anchor is written between, from the range Unicode
 * leaves for private use. An anchor stands in the text, while it is parsed,
 * for one tag at one place.
 */
const ANCHOR_OPEN = '\uE000';
const ANCHOR_CLOSE = '\uE001';
const ANCHOR = /\uE000(\d{1,4})\uE001/;
const ANCHORS = /\uE000(\d{1,4})\uE001/g;

/**
 * A turn's text with an anchor at each place the turn says a tag was printed,
 * and the tag each anchor is for.
 *
 * This is the only way a tag is drawn. The places come from the turn's own
 * record of what it rests on, which the server sets from the facts and no
 * model writes. A place counts only when the text there is that fact's tag
 * as the server prints it, so a turn whose text was changed after is drawn
 * with the words and no tag. Whatever the text itself holds of the anchor's
 * two characters is put out of use first, without moving anything. So no
 * text, whoever wrote it, can make a tag appear: "[approved]" typed into an
 * answer is those ten characters.
 */
function anchored(text: string, places: TagPlaces | undefined): { text: string; tags: MemTagWords[] } {
  const plain = text.replace(/[\uE000\uE001]/g, '\uFFFD');
  const found = new Map<number, { len: number; words: MemTagWords }>();
  for (const rest of places ?? []) {
    const printed = memTagPrinted(rest.tag, rest.stands);
    for (const at of rest.at ?? []) {
      if (Number.isInteger(at) && at >= 0 && plain.startsWith(printed, at)) found.set(at, { len: printed.length, words: printed.slice(1, -1) as MemTagWords });
    }
  }
  const tags: MemTagWords[] = [];
  let out = plain;
  let above = Infinity;
  // From the end, so the places still to come have not moved.
  for (const at of [...found.keys()].sort((a, b) => b - a)) {
    const { len, words } = found.get(at)!;
    if (at + len > above) continue;
    out = `${out.slice(0, at)}${ANCHOR_OPEN}${tags.length}${ANCHOR_CLOSE}${out.slice(at + len)}`;
    tags.push(words);
    above = at;
  }
  return { text: out, tags };
}
const BOLD = /\*\*([^*]+)\*\*/;
const CODE = /`([^`]+)`/;

/**
 * A bracketed id of the project graph's frame: a stage, a department or a
 * function, written `<project>::stage::<key>`, `::dept::<key>` or
 * `::ws::<key>`.
 *
 * One the graph has is a node like any other. One it does not have is still,
 * nearly always, something with a name. The frame was redrawn to match the
 * menu: twelve steps became four stages, and Design became one function of
 * Engineering. An answer written before quotes `…::stage::acquisition` or
 * `…::ws::design.drawings`, which is no node now and is as much the
 * Acquisition step and Drawings & versions as it ever was. A department the
 * project has switched off is the same. So the name is printed where the id
 * stood, as plain words, because there is nothing to open.
 *
 * Taking the id out instead left a hole wherever the sentence leaned on it:
 * "It moved from to in March."
 *
 * It is taken out in two cases. The words just before it are its name ("the
 * Acquisition step […]"), where printing it would say the name twice. Or
 * nothing can name it: a key that was never a stage, a step, a department or
 * a workstream. That is not how a record's id is treated, which is kept and
 * marked when it resolves to nothing, and the difference is what each is. A
 * record's id is a reference the answer made, and hiding one we cannot follow
 * would present an unsupported claim as a clean one. A frame id supports
 * nothing: it says where in the project the sentence is talking about.
 *
 * One nothing can name is taken out wherever it stands, inside bold or code
 * as much as in plain words. It is marked only when the whole line has no
 * word left without it.
 */
const FRAME_TOKEN = /\[([A-Za-z0-9][A-Za-z0-9_-]*::(?:stage|dept|ws)::[A-Za-z0-9_.-]+)\]/;

/** The words for what a name of the frame is, which may stand between the name and its id. */
const FRAME_NOUNS = ['step', 'stage', 'department', 'function', 'workstream'];

/** Lower case, with everything that is not a letter or a digit read as a space. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the words just before an id are already its name: the name alone,
 * or the name and the one word for what it is ("the Acquisition step").
 *
 * Just before, and in the same breath. A name said a sentence or a clause
 * earlier does not count: "The file is at Acquisition. […] closes when the
 * deed is registered" still needs its subject.
 */
function saidJustBefore(before: string, names: readonly string[]): boolean {
  const lead = before.replace(/[\s(*`]+$/, '');
  if (/[.!?,;:]$/.test(lead)) return false;
  const said = ` ${wordsOf(lead)}`;
  return names.some((name) => {
    const words = ` ${wordsOf(name)}`;
    return said.endsWith(words) || FRAME_NOUNS.some((noun) => said.endsWith(`${words} ${noun}`));
  });
}

/**
 * The stretch to take out with an id that is not printed: the token, the
 * round brackets when it stood alone in them, and the space before, so that
 * "the Acquisition step ([…]) is done" closes up as a sentence. At the start
 * of the line it is the space after that goes, so the line does not open on
 * one.
 */
function stretchOf(text: string, at: number, len: number, opensLine: boolean): { at: number; len: number } {
  let from = at;
  let to = at + len;
  if (text[from - 1] === '(' && text[to] === ')') {
    from -= 1;
    to += 1;
  }
  while (from > 0 && text[from - 1] === ' ') from -= 1;
  if (opensLine && from === 0) while (text[to] === ' ') to += 1;
  return { at: from, len: to - from };
}

/**
 * Split one line into spans.
 *
 * `isNode` decides whether a bracketed token is a real graph node or just
 * prose in brackets. It is a lookup against the case's own graph, not a
 * pattern — a model writing "[see above]" must not produce a chip that opens
 * nothing, and no regex can tell the two apart.
 *
 * It draws no memory tag: a tag is placed by `parseAnswer`, from the places a
 * turn keeps, and "[approved]" in a line given to this is words in brackets.
 */
export function parseInline(text: string, isNode: (id: string) => boolean): Inline[] {
  return inline(text.replace(/[\uE000\uE001]/g, '\uFFFD'), isNode, []);
}

/** `tags` is the tag each anchor in the text is for; see `anchored`. */
function inline(text: string, isNode: (id: string) => boolean, tags: readonly MemTagWords[]): Inline[] {
  const { spans, unnamed } = read(text, isNode, tags, true);
  // A line that was nothing but ids no one can name has no word left on it,
  // and a bullet would show as a dot beside nothing. There the id is marked,
  // as a record's is: the answer pointed at something and this is all it said.
  const hasWords = spans.some((span) => span.kind !== 'text' || /[\p{L}\p{N}]/u.test(span.text));
  if (!hasWords && unnamed.length > 0) return unnamed.map((id) => ({ kind: 'dangling', id }));
  return spans;
}

/**
 * The spans of a line, and the frame ids taken out of it because nothing
 * could name them. `marks` is off for the words inside bold or code, where no
 * second mark is read. `before` is what the line said ahead of those words,
 * so a name said just before a mark is not said again inside it.
 */
function read(text: string, isNode: (id: string) => boolean, tags: readonly MemTagWords[], marks: boolean, before = ''): { spans: Inline[]; unnamed: string[] } {
  // An anchor caught inside bold or code is said there in words: a tag is not drawn inside another mark.
  const worded = (words: string): string => words.replace(ANCHORS, (_whole, n: string) => `[${tags[Number(n)] ?? ''}]`);
  /*
   * A record named inside bold or code is still its chip, and the words
   * around it keep the mark. The server puts brackets round an id wherever a
   * model wrote it, and a model writes an id in backticks more often than
   * not. Taken as one run of words, that printed the id the brackets were
   * there to replace.
   */
  const within = (kind: 'bold' | 'code', words: string, ahead: string): { spans: Inline[]; unnamed: string[] } => {
    const inner = read(worded(words), isNode, [], false, ahead);
    return { spans: inner.spans.map((span) => (span.kind === 'text' ? { kind, text: span.text } : span)), unnamed: inner.unnamed };
  };
  const out: Inline[] = [];
  let rest = text;
  // The frame ids taken out because nothing could name them.
  const unnamed: string[] = [];
  // Text joins the text before it, so a sentence an id was named in or taken
  // out of is one run of words again and not two with a seam.
  const say = (words: string): void => {
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += words;
    else out.push({ kind: 'text', text: words });
  };

  while (rest.length > 0) {
    // What is found next on the line and the spans it becomes: none when it is taken out.
    const candidates: { at: number; len: number; spans: Inline[]; unnamed?: string[] }[] = [];
    // `rest` is always the end of `text`, so what was read is the start.
    const done = text.length - rest.length;
    // Bold or code that held nothing but ids taken out goes with them, as a bare id does.
    const marked = (kind: 'bold' | 'code', found: RegExpExecArray): void => {
      const inner = within(kind, found[1], text.slice(0, done + found.index));
      const place = inner.spans.length ? { at: found.index, len: found[0].length } : stretchOf(rest, found.index, found[0].length, done === 0);
      candidates.push({ ...place, spans: inner.spans, unnamed: inner.unnamed });
    };

    const ev = EVIDENCE_TOKEN.exec(rest);
    if (ev) candidates.push({ at: ev.index, len: ev[0].length, spans: [cited(ev[1])] });

    const notes = NOTES_TOKEN.exec(rest);
    if (notes) candidates.push({ at: notes.index, len: notes[0].length, spans: [{ kind: 'notes', meetingId: notes[1], ...(notes[2] ? { itemId: notes[2] } : {}) }] });

    const anchor = tags.length ? ANCHOR.exec(rest) : null;
    const tag = anchor ? tags[Number(anchor[1])] : undefined;
    if (anchor && tag) candidates.push({ at: anchor.index, len: anchor[0].length, spans: [{ kind: 'memory', tag }] });

    const bold = marks ? BOLD.exec(rest) : null;
    if (bold) marked('bold', bold);

    const code = marks ? CODE.exec(rest) : null;
    if (code) marked('code', code);

    // A frame id is looked for by its own shape, wherever it stands on the
    // line. One the graph has is a node like any other. One it does not have
    // is printed as its name, unless the sentence has just said the name or
    // there is none to say, and then it leaves the sentence.
    const frame = FRAME_TOKEN.exec(rest);
    if (frame) {
      const id = frame[1];
      const at = frame.index;
      const len = frame[0].length;
      if (isNode(id)) {
        candidates.push({ at, len, spans: [{ kind: 'node', id }] });
      } else {
        const names = projectFrameNames(id);
        if (names.length > 0 && !saidJustBefore(before + text.slice(0, done + at), names)) {
          candidates.push({ at, len, spans: [{ kind: 'text', text: names[0] }] });
        } else {
          candidates.push({ ...stretchOf(rest, at, len, done === 0), spans: [], ...(names.length === 0 ? { unnamed: [id] } : {}) });
        }
      }
    }

    // Checked last and gated on the graph, so `[ev:…]` is never also read as a
    // node — one citation rendering as two chips was a real bug in the
    // server-side extractor and the same trap exists here. Every bracketed
    // word is tried until one is a record: stopping at the first let "[1]" or
    // "[see above]" hide the ids written after it on the line.
    for (const node of rest.matchAll(NODE_TOKENS)) {
      if (node[0].startsWith('[ev:') || FRAME_TOKEN.test(node[0])) continue;
      const id = node[1];
      // An id of a kind with no page is the id as words, without the brackets: nothing here can say whether the project has it.
      const span: Inline | null = isNode(id) ? { kind: 'node', id } : LINKED_ID.test(id) ? { kind: 'dangling', id } : PAGELESS_ID.test(id) ? { kind: 'text', text: id } : null;
      if (!span) continue;
      candidates.push({ at: node.index, len: node[0].length, spans: [span] });
      break;
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.at - b.at);
    const first = candidates[0];
    if (first.at > 0) say(rest.slice(0, first.at));
    for (const span of first.spans) {
      if (span.kind === 'text') say(span.text);
      else out.push(span);
    }
    if (first.unnamed) unnamed.push(...first.unnamed);
    rest = rest.slice(first.at + first.len);
  }

  if (rest.length > 0) say(rest);
  return { spans: out, unnamed };
}

/**
 * Whether a bracketed token is one of OUR ids rather than prose in brackets,
 * and which of two sorts.
 *
 * Kept to the shapes this product mints. A record's id is a prefix and an
 * underscore, and the prefixes are the ones `link-ids.ts` in the shared
 * package links by; the graph and the screen still write the two older ones
 * with a hyphen. An underscore id has to hold a digit, as every minted one
 * does, because the product's own words open the same way: `run_valuation`,
 * `log_site_entry`. A model writing "[see above]" or "[sic]" must not produce
 * a broken-reference chip, and the price of being wrong in that direction is
 * much higher than leaving a genuine dangling id as text.
 *
 * `LINKED_ID` is the kinds the chat is given a name for (`chatLinkLabels`):
 * every record of such a kind that the project has is a chip, so one that is
 * not names nothing, and is marked as a broken reference.
 *
 * `PAGELESS_ID` is the kinds with no page of their own: a card, a chat turn,
 * a line of the history, a valuation run, a flow, a run. The chat is given no
 * name for these whether the project has them or not, so one is never marked.
 */
const LINKED_ID = /^(?:(?:dd|ev)-|(?:prj|ast|dd|scp|chk|fnd|rsk|act|ev|dec|rep|rpt|mil|log|vis|crt|qnr)_(?=.*\d))/;
const PAGELESS_ID = /^(?:val|prp|cht|aud|flw|run)_(?=.*\d)/;

/** Closing punctuation written against the end of a chip, with a space or nothing after it. A possessive counts: "[the deed]'s". A dash is kept whatever follows it. */
const AFTER_CHIP = /^(?:[’']s)?[.,;:!?)\]”’"'…]*(?:—|(?=\s|$))/;
/** An opening bracket or quotation mark written against the start of a chip, with a space or nothing before it. */
const BEFORE_CHIP = /(^|\s)([([“‘]+)$/;

/** Punctuation kept against a chip, and whether it was written in bold. */
export type Beside = { text: string; bold: boolean };

/**
 * The punctuation each chip keeps beside it, by the chip's place, and the
 * words of each run of plain or bold text once that is taken from it. A stop
 * is taken from a bold run as from a plain one: "**See [the deed].**" ends
 * in a bold stop, and left to itself it stood apart from its chip.
 */
export function besideChips(spans: Inline[]): { words: string[]; lead: (Beside | undefined)[]; tail: (Beside | undefined)[] } {
  const words = spans.map((span) => (span.kind === 'text' || span.kind === 'bold' ? span.text : ''));
  const lead: (Beside | undefined)[] = [];
  const tail: (Beside | undefined)[] = [];
  spans.forEach((span, i) => {
    if (span.kind === 'text' || span.kind === 'bold' || span.kind === 'code') return;
    const next = spans[i + 1];
    const after = next?.kind === 'text' || next?.kind === 'bold' ? AFTER_CHIP.exec(words[i + 1]) : null;
    if (after?.[0]) {
      tail[i] = { text: after[0], bold: next?.kind === 'bold' };
      words[i + 1] = words[i + 1].slice(after[0].length);
    }
    const prev = spans[i - 1];
    const before = prev?.kind === 'text' || prev?.kind === 'bold' ? BEFORE_CHIP.exec(words[i - 1]) : null;
    if (before) {
      lead[i] = { text: before[2], bold: prev?.kind === 'bold' };
      words[i - 1] = words[i - 1].slice(0, words[i - 1].length - before[2].length);
    }
  });
  return { words, lead, tail };
}

/**
 * Citations that stand side by side and would read the same, as one.
 *
 * A passage and a line of memory cite every copy of a paper that holds the
 * words, so two copies of one paper put the same chip down twice in a row.
 * The first is kept. `copies` says, by its place in what is left, how many
 * papers it stands for. `reads` is what a citation would show, or null for
 * one that is never folded into another.
 */
export function oneOfEach(spans: Inline[], reads: (span: Extract<Inline, { kind: 'evidence' }>) => string | null): { spans: Inline[]; copies: number[] } {
  const out: Inline[] = [];
  const papers: Array<Set<string> | undefined> = [];
  for (const span of spans) {
    const gap = out[out.length - 1];
    // The chip before this one, across nothing or a space.
    const at = gap?.kind === 'text' && gap.text.trim() === '' ? out.length - 2 : out.length - 1;
    const kept = out[at];
    const said = span.kind === 'evidence' ? reads(span) : null;
    if (span.kind === 'evidence' && kept?.kind === 'evidence' && said !== null && reads(kept) === said) {
      out.length = at + 1;
      (papers[at] ??= new Set([kept.id])).add(span.id);
      continue;
    }
    out.push(span);
  }
  return { spans: out, copies: out.map((_span, i) => papers[i]?.size ?? 1) };
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim());
}

const DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A line that is only a heading if it is short and ends in a colon. */
const HEADING = /^([A-Z][^.!?]{0,60}):\s*$/;

/**
 * An ATX heading — `## Something`.
 *
 * Added after watching a real answer come back from
 * `nvidia/nemotron-3-super-120b-a12b:free`, which opened each of its two
 * findings with `## 1. Aerodrome height restriction …`. The models on this
 * deployment are not asked to format and do it anyway, so the parser reads
 * the convention they actually reach for rather than the one we might have
 * specified. The leading number is left in the text: it is the model's own
 * ordering of its answer, not ours to renumber.
 */
const ATX = /^#{1,4}\s+(.+?)\s*#*$/;

/** A line of prose that ends in a citation, with whatever closes the sentence after it. */
const ENDS_CITED = /\[ev:[A-Za-z0-9][A-Za-z0-9_.:-]*\][.,;:!?…)\]”’"']*$/;

const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^(\d{1,2})[.)]\s+(.*)$/;
/** A line of three or more of the same mark and nothing else. */
const isRule = (trimmed: string): boolean => /^([-*_])\1{2,}$/.test(trimmed.replace(/\s+/g, ''));

export function parseAnswer(text: string, isNode: (id: string) => boolean, places?: TagPlaces): Block[] {
  // The places are places in the text as the turn keeps it, so the anchors go in before anything else is done to it.
  const marked = anchored(text, places);
  const tags = marked.tags;
  const spansOf = (line: string) => inline(line, isNode, tags);
  const lines = marked.text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // The line a numbered list starts on when it follows straight after one that kept dashed lines standing apart from its items.
  let apartFrom = -1;

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: spansOf(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    // A table needs a header, a divider and at least one row. Anything short
    // of that falls through and is read as prose, which is the right failure:
    // a half-written table is still a sentence somebody can read.
    const next = lines[i + 1]?.trim() ?? '';
    if (trimmed.includes('|') && DIVIDER.test(next) && next.includes('-')) {
      const head = splitRow(trimmed);
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim() !== '') {
        rows.push(splitRow(lines[j].trim()).map(c => spansOf(c)));
        j += 1;
      }
      if (rows.length > 0) {
        flush();
        blocks.push({ kind: 'table', head: head.map(c => spansOf(c)), rows });
        i = j - 1;
        continue;
      }
    }

    /*
     * A horizontal rule, which the models here write constantly.
     *
     * Observed in production output: a long answer separates its sections
     * with a bare `---` line, and without this it printed as two literal
     * dashes in the middle of the prose. Checked BEFORE the bullet rule,
     * because `---` also matches `^[-*•]\s+` in spirit and a reader would
     * get an empty bullet instead of a divider.
     */
    if (isRule(trimmed)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    /*
     * A line the answer flagged.
     *
     * The answers written from the file open a line with ⚑ for what a person
     * must not miss: two papers that disagree, an extent that differs, a
     * certificate short of its years. Joined into the prose around it, that
     * line read as one more sentence. It is set apart instead. The mark has
     * to open the line and have words after it: one in the middle of a
     * sentence stays where it was written.
     */
    const flag = /^⚑\s*(.+)$/.exec(trimmed);
    if (flag) {
      flush();
      blocks.push({ kind: 'flag', spans: spansOf(flag[1]) });
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      const items: Inline[][] = [spansOf(bullet[1])];
      let j = i + 1;
      while (j < lines.length) {
        const m = BULLET.exec(lines[j].trim());
        if (!m) break;
        items.push(spansOf(m[1]));
        j += 1;
      }
      blocks.push({ kind: 'bullets', items });
      i = j - 1;
      continue;
    }

    /*
     * A numbered list is one list until something other than an item or its
     * details comes.
     *
     * A model that sets each item apart with a blank line, or writes dashed
     * lines under one, is still counting. Each of those used to end the list,
     * so every item opened a list of its own and all of them read "1.". The
     * dashed lines under an item are kept with it. After a blank line they
     * are its details only when they are set in from the item, the list goes
     * on after them, or an earlier item's were written the same way:
     * otherwise they are more likely a list of their own.
     *
     * A number that starts again at 1 is the first item of another list. It
     * is not when the item before it was written "1." as well: some answers
     * number every item 1 and leave the counting to whoever draws it. A list
     * that follows straight after another keeps its dashed lines the way
     * that one did.
     */
    const numbered = NUMBERED.exec(trimmed);
    if (numbered) {
      flush();
      const items: Inline[][] = [spansOf(numbered[2])];
      const details: Inline[][][] = [[]];
      const skipBlank = (at: number): number => {
        let to = at;
        while (to < lines.length && lines[to].trim() === '') to += 1;
        return to;
      };
      // The number the last item was written with, and the item at a line when it is the next of this list.
      const start = Number(numbered[1]);
      let written = start;
      const nextItem = (at: number): RegExpExecArray | null => {
        const item = NUMBERED.exec(lines[at]?.trim() ?? '');
        // A list counted from 0 comes to 1 once: a second 1 starts another. So does a second 0, once the count has gone past it.
        const again = item && ((Number(item[1]) === 1 && (written > 1 || (start === 0 && items.length > 1))) || (Number(item[1]) === 0 && start === 0 && written > 0));
        return item && !again ? item : null;
      };
      // An item of this list has taken dashed lines that stood apart from it and were not set in. So has the list
      // this one follows straight after, starting again at 1: one answer writes its lists one way.
      let apartBefore = apartFrom === i;
      let j = i + 1;
      while (j < lines.length) {
        const at = skipBlank(j);
        const item = nextItem(at);
        if (item) {
          items.push(spansOf(item[2]));
          details.push([]);
          written = Number(item[1]);
          j = at + 1;
          continue;
        }
        let end = at;
        while (end < lines.length && BULLET.test(lines[end].trim()) && !isRule(lines[end].trim())) end += 1;
        if (end === at) break;
        const apart = at > j && lines[at].search(/\S/) <= line.search(/\S/);
        if (apart && !apartBefore && !nextItem(skipBlank(end))) break;
        if (apart) apartBefore = true;
        for (const under of lines.slice(at, end)) details[details.length - 1].push(spansOf(BULLET.exec(under.trim())![1]));
        j = end;
      }
      apartFrom = apartBefore && NUMBERED.test(lines[skipBlank(j)]?.trim() ?? '') ? skipBlank(j) : -1;
      blocks.push({ kind: 'numbers', items, ...(start === 1 ? {} : { start }), ...(details.some((under) => under.length > 0) ? { details } : {}) });
      i = j - 1;
      continue;
    }

    const atx = ATX.exec(trimmed);
    if (atx) {
      flush();
      blocks.push({ kind: 'heading', spans: spansOf(atx[1]) });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    // Only a heading when something follows it. A trailing "In summary:" with
    // nothing after is the end of a sentence, not a section title.
    if (heading && lines[i + 1] !== undefined && lines[i + 1].trim() !== '') {
      flush();
      blocks.push({ kind: 'heading', spans: spansOf(heading[1]) });
      continue;
    }

    paragraph.push(trimmed);
    // A line that ends in its source is a block of its own. Joined to the line after, a chip that went to the next line stood
    // at the head of the next sentence and read as its source. Not when the line after goes on in lower case: that is one sentence, wrapped.
    // Nor when the line after opens with a source: that one is this line's too, written under it.
    if (ENDS_CITED.test(trimmed) && !/^\p{Ll}/u.test(next) && !/^\[ev:/.test(next)) flush();
  }

  flush();
  return blocks;
}

/** What a reply's picture is chosen from: the reply as the thread keeps it, and the project as the page holds it. */
export type ReplyKept = Pick<ProjectChatTurn, 'role' | 'at' | 'text' | 'toolCalls' | 'changed'>;
export type ProjectHeld = Pick<DdProject, 'lastScreenResult' | 'valuationRuns'>;

/** How long after a screen or a valuation was made a reply may be stamped and still be the one that made it. */
const MADE_JUST_BEFORE_MS = 5000;

/**
 * What a reply ran, of the things a picture is drawn from: the property
 * screen, and a valuation that gave a figure.
 *
 * A picture sits under the reply that reports the thing as done, and under
 * no other. It was keyed on the tool name `screen`, which is recorded when a
 * screen is only proposed. So the reply that said the screen was waiting drew
 * the chart of an earlier screen, or drew one only after a later reply had
 * run it, and the reply that ran it drew none.
 *
 * Nothing on a turn names what it made, so two things have to agree. The
 * time: the screen and a valuation run each keep when they were made, and a
 * reply is stamped just after what it made. And the reply's own account: a
 * line of what it changed that holds the word, or its words saying it ran
 * the thing. Either alone is not enough. A reply sent a second after a
 * screen is not the one that ran it, and "Ran the valuation" is quoted by
 * the reply that undoes one.
 *
 * It holds after the fact too. A screen run again leaves the earlier reply
 * with none, because the project no longer holds that reply's screen, and a
 * reply that was undone has none.
 *
 * A run that could give no figure is not given: a valuation of zero and a
 * valuation that could not be worked out are different facts. The test is
 * the one the Valuation page puts to a run before it shows a figure, and
 * that the figure sits inside a range.
 */
export function replyRan(turn: ReplyKept | undefined, project: ProjectHeld | undefined): { screen?: ScreenResult; valuation?: ValuationRun } {
  if (!turn || !project || turn.role !== 'assistant') return {};
  if (turn.changed?.undone || turn.toolCalls?.some((call) => call.name === 'undo')) return {};
  const at = Date.parse(turn.at);
  // A time that cannot be read leaves every comparison false.
  const justBefore = (when: string | undefined): boolean => at - Date.parse(when ?? '') >= 0 && at - Date.parse(when ?? '') <= MADE_JUST_BEFORE_MS;
  const says = (word: RegExp, ran: string): boolean => (turn.changed?.lines ?? []).some((line) => word.test(line)) || turn.text.toLowerCase().includes(ran);

  const out: { screen?: ScreenResult; valuation?: ValuationRun } = {};
  const screen = project.lastScreenResult;
  if (screen && justBefore(screen.generatedAt) && says(/\bscreens?\b/i, 'ran the property screen')) out.screen = screen;
  if (says(/\bvaluations?\b/i, 'ran the valuation')) {
    // The newest: when a valuation is run twice in a few seconds, the earlier run is still within reach of the later reply.
    const run = (project.valuationRuns ?? []).filter((made) => justBefore(made.createdAt)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const figure = run && (!run.working || run.working.reconciliation.outcome === 'indicated') && run.low > 0 && run.low < run.high && run.low <= run.indicatedValue && run.indicatedValue <= run.high;
    if (run && figure) out.valuation = run;
  }
  return out;
}
