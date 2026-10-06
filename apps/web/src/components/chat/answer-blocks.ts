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

import { MEM_TAG_WORDS, projectFrameNames, type MemTagWords } from '@realytica/shared';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  /** `[ev:xyz]` — an evidence id the answer cited in the flow of a sentence. */
  | { kind: 'evidence'; id: string }
  /** `[dd-risk-…]` — a graph node id, rendered with its real label. */
  | { kind: 'node'; id: string }
  /**
   * `[approved]`, `[waiting]`, `[thought]`: where a fact of the project's
   * memory stood when the sentence before it was written. Read only on a turn
   * whose tags the server printed from the facts themselves.
   */
  | { kind: 'memory'; tag: MemTagWords }
  /**
   * A bracketed token that is plainly one of our ids and resolves to nothing.
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
  | { kind: 'numbers'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  /** A line that opens with the flag mark: something that differs, falls short or is at risk. */
  | { kind: 'flag'; spans: Inline[] }
  | { kind: 'rule' };

const EVIDENCE_TOKEN = /\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/;
const NODE_TOKEN = /\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/;
const MEMORY_TOKEN = new RegExp(`\\[(${MEM_TAG_WORDS.join('|')})\\]`);
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
 * `tags` says the turn's memory tags were printed by the server, from the
 * facts the answer cited. Only then is `[approved]` a tag. On any other turn
 * it is words in brackets, whoever wrote them.
 */
export function parseInline(text: string, isNode: (id: string) => boolean, tags = false): Inline[] {
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
    const candidates: { at: number; len: number; span: Inline | null; unnamed?: string }[] = [];

    const ev = EVIDENCE_TOKEN.exec(rest);
    if (ev) candidates.push({ at: ev.index, len: ev[0].length, span: { kind: 'evidence', id: ev[1] } });

    const tag = tags ? MEMORY_TOKEN.exec(rest) : null;
    if (tag) candidates.push({ at: tag.index, len: tag[0].length, span: { kind: 'memory', tag: tag[1] as MemTagWords } });

    const bold = BOLD.exec(rest);
    if (bold) candidates.push({ at: bold.index, len: bold[0].length, span: { kind: 'bold', text: bold[1] } });

    const code = CODE.exec(rest);
    if (code) candidates.push({ at: code.index, len: code[0].length, span: { kind: 'code', text: code[1] } });

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
        candidates.push({ at, len, span: { kind: 'node', id } });
      } else {
        // `rest` is always the end of `text`, so what was read is the start.
        const read = text.length - rest.length;
        const names = projectFrameNames(id);
        if (names.length > 0 && !saidJustBefore(text.slice(0, read + at), names)) {
          candidates.push({ at, len, span: { kind: 'text', text: names[0] } });
        } else {
          candidates.push({ ...stretchOf(rest, at, len, read === 0), span: null, ...(names.length === 0 ? { unnamed: id } : {}) });
        }
      }
    }

    // Checked last and gated on the graph, so `[ev:…]` is never also read as a
    // node — one citation rendering as two chips was a real bug in the
    // server-side extractor and the same trap exists here.
    const node = NODE_TOKEN.exec(rest);
    if (node && !node[0].startsWith('[ev:') && !FRAME_TOKEN.test(node[0])) {
      if (isNode(node[1])) {
        candidates.push({ at: node.index, len: node[0].length, span: { kind: 'node', id: node[1] } });
      } else if (looksLikeOurId(node[1])) {
        candidates.push({ at: node.index, len: node[0].length, span: { kind: 'dangling', id: node[1] } });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.at - b.at);
    const first = candidates[0];
    if (first.at > 0) say(rest.slice(0, first.at));
    if (first.span?.kind === 'text') say(first.span.text);
    else if (first.span) out.push(first.span);
    if (first.unnamed) unnamed.push(first.unnamed);
    rest = rest.slice(first.at + first.len);
  }

  if (rest.length > 0) say(rest);

  // A line that was nothing but ids no one can name has no word left on it,
  // and a bullet would show as a dot beside nothing. There the id is marked,
  // as a record's is: the answer pointed at something and this is all it said.
  const hasWords = out.some((span) => span.kind !== 'text' || /[\p{L}\p{N}]/u.test(span.text));
  if (!hasWords && unnamed.length > 0) return unnamed.map((id) => ({ kind: 'dangling', id }));
  return out;
}

/**
 * Whether a bracketed token is one of OUR ids rather than prose in brackets.
 *
 * Kept to the prefixes the projection actually emits. A model writing "[see
 * above]" or "[sic]" must not produce a broken-reference chip, and the price
 * of being wrong in that direction is much higher than leaving a genuine
 * dangling id as text.
 */
function looksLikeOurId(token: string): boolean {
  return /^(dd|ev)-/.test(token);
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

export function parseAnswer(text: string, isNode: (id: string) => boolean, tags = false): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ').trim(), isNode, tags) });
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
        rows.push(splitRow(lines[j].trim()).map(c => parseInline(c, isNode, tags)));
        j += 1;
      }
      if (rows.length > 0) {
        flush();
        blocks.push({ kind: 'table', head: head.map(c => parseInline(c, isNode, tags)), rows });
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
    if (/^([-*_])\1{2,}$/.test(trimmed.replace(/\s+/g, ''))) {
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
      blocks.push({ kind: 'flag', spans: parseInline(flag[1], isNode, tags) });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      const items: Inline[][] = [parseInline(bullet[1], isNode, tags)];
      let j = i + 1;
      while (j < lines.length) {
        const m = /^[-*•]\s+(.*)$/.exec(lines[j].trim());
        if (!m) break;
        items.push(parseInline(m[1], isNode, tags));
        j += 1;
      }
      blocks.push({ kind: 'bullets', items });
      i = j - 1;
      continue;
    }

    const numbered = /^(\d{1,2})[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flush();
      const items: Inline[][] = [parseInline(numbered[2], isNode, tags)];
      let j = i + 1;
      while (j < lines.length) {
        const m = /^(\d{1,2})[.)]\s+(.*)$/.exec(lines[j].trim());
        if (!m) break;
        items.push(parseInline(m[2], isNode, tags));
        j += 1;
      }
      blocks.push({ kind: 'numbers', items });
      i = j - 1;
      continue;
    }

    const atx = ATX.exec(trimmed);
    if (atx) {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(atx[1], isNode, tags) });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    // Only a heading when something follows it. A trailing "In summary:" with
    // nothing after is the end of a sentence, not a section title.
    if (heading && lines[i + 1] !== undefined && lines[i + 1].trim() !== '') {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(heading[1], isNode, tags) });
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
