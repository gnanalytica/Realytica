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
 * closed: headings, bullets, numbers, tables, and inline emphasis/code.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  /** `[ev:xyz]` — an evidence id the answer cited in the flow of a sentence. */
  | { kind: 'evidence'; id: string }
  /** `[dd-risk-…]` — a graph node id, rendered with its real label. */
  | { kind: 'node'; id: string }
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
  | { kind: 'rule' };

const EVIDENCE_TOKEN = /\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/;
const NODE_TOKEN = /\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/;
const BOLD = /\*\*([^*]+)\*\*/;
const CODE = /`([^`]+)`/;

/**
 * A bracketed id of the project graph's frame: a stage, a department or a
 * function, written `<project>::stage::<key>`, `::dept::<key>` or
 * `::ws::<key>`.
 *
 * It is the one id that is taken out of the sentence when it resolves to
 * nothing, where a record's id is kept and marked. The difference is what
 * each is. A record's id is a reference the answer made, and hiding one we
 * cannot follow would present an unsupported claim as a clean one. A frame
 * id supports nothing: it names where in the project the sentence is
 * talking about, and the sentence has already said so in words.
 *
 * And they do stop resolving, without anything being wrong. The frame was
 * redrawn to match the menu: twelve steps became four stages, and Design
 * became one function of Engineering. An answer written before quotes
 * `…::stage::acquisition` or `…::ws::design.drawings`, which is no longer
 * anything. Printed, that is a key nobody can read in the middle of a
 * sentence about the Acquisition step.
 */
const FRAME_TOKEN = /\[([A-Za-z0-9][A-Za-z0-9_-]*::(?:stage|dept|ws)::[A-Za-z0-9_.-]+)\]/;

/**
 * The stretch to take out with an id that is gone: the token, the round
 * brackets when it stood alone in them, and the space before, so that
 * "the Acquisition step ([…]) is done" closes up as a sentence.
 */
function stretchOf(text: string, at: number, len: number): { at: number; len: number } {
  let from = at;
  let to = at + len;
  if (text[from - 1] === '(' && text[to] === ')') {
    from -= 1;
    to += 1;
  }
  while (from > 0 && text[from - 1] === ' ') from -= 1;
  return { at: from, len: to - from };
}

/**
 * Split one line into spans.
 *
 * `isNode` decides whether a bracketed token is a real graph node or just
 * prose in brackets. It is a lookup against the case's own graph, not a
 * pattern — a model writing "[see above]" must not produce a chip that opens
 * nothing, and no regex can tell the two apart.
 */
export function parseInline(text: string, isNode: (id: string) => boolean): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  // Text joins the text before it, so a sentence an id was taken out of is
  // one run of words again and not two with a seam.
  const say = (words: string): void => {
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += words;
    else out.push({ kind: 'text', text: words });
  };

  while (rest.length > 0) {
    const candidates: { at: number; len: number; span: Inline | null }[] = [];

    const ev = EVIDENCE_TOKEN.exec(rest);
    if (ev) candidates.push({ at: ev.index, len: ev[0].length, span: { kind: 'evidence', id: ev[1] } });

    const bold = BOLD.exec(rest);
    if (bold) candidates.push({ at: bold.index, len: bold[0].length, span: { kind: 'bold', text: bold[1] } });

    const code = CODE.exec(rest);
    if (code) candidates.push({ at: code.index, len: code[0].length, span: { kind: 'code', text: code[1] } });

    // A frame id is looked for by its own shape, wherever it stands on the
    // line. One the graph has is a node like any other; one it no longer has
    // leaves the sentence, with nothing in its place.
    const frame = FRAME_TOKEN.exec(rest);
    if (frame) {
      candidates.push(
        isNode(frame[1])
          ? { at: frame.index, len: frame[0].length, span: { kind: 'node', id: frame[1] } }
          : { ...stretchOf(rest, frame.index, frame[0].length), span: null },
      );
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
    if (first.span) out.push(first.span);
    rest = rest.slice(first.at + first.len);
  }

  if (rest.length > 0) say(rest);
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

export function parseAnswer(text: string, isNode: (id: string) => boolean): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ').trim(), isNode) });
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
        rows.push(splitRow(lines[j].trim()).map(c => parseInline(c, isNode)));
        j += 1;
      }
      if (rows.length > 0) {
        flush();
        blocks.push({ kind: 'table', head: head.map(c => parseInline(c, isNode)), rows });
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

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      const items: Inline[][] = [parseInline(bullet[1], isNode)];
      let j = i + 1;
      while (j < lines.length) {
        const m = /^[-*•]\s+(.*)$/.exec(lines[j].trim());
        if (!m) break;
        items.push(parseInline(m[1], isNode));
        j += 1;
      }
      blocks.push({ kind: 'bullets', items });
      i = j - 1;
      continue;
    }

    const numbered = /^(\d{1,2})[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flush();
      const items: Inline[][] = [parseInline(numbered[2], isNode)];
      let j = i + 1;
      while (j < lines.length) {
        const m = /^(\d{1,2})[.)]\s+(.*)$/.exec(lines[j].trim());
        if (!m) break;
        items.push(parseInline(m[2], isNode));
        j += 1;
      }
      blocks.push({ kind: 'numbers', items });
      i = j - 1;
      continue;
    }

    const atx = ATX.exec(trimmed);
    if (atx) {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(atx[1], isNode) });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    // Only a heading when something follows it. A trailing "In summary:" with
    // nothing after is the end of a sentence, not a section title.
    if (heading && lines[i + 1] !== undefined && lines[i + 1].trim() !== '') {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(heading[1], isNode) });
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
