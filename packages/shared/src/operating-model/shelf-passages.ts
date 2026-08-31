/**
 * Split a fetched official PDF into citeable passages.
 *
 * This is the shelf's retrieval unit: a heading + a short extract. It is still
 * reference, not this project's evidence. Paid works never reach here.
 */

export interface ReferencePassage {
  heading: string;
  text: string;
}

const HEADING =
  /(?:^|\n)\s*((?:CHAPTER\s+[IVXLC\d]+[^\n]{0,80})|(?:Rule\s+\d+[A-Za-z]?(?:\s*[.(][^\n]{0,80})?)|(?:Section\s+\d+[A-Za-z]?(?:\s*[.(][^\n]{0,80})?)|(?:Guideline\s+\d+[^\n]{0,80})|(?:\d+\.\s+[A-Z][^\n]{0,80}))/gi;

const WINDOW = 900;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function splitReferenceText(title: string, raw: string): ReferencePassage[] {
  const source = raw.replace(/\u0000/g, ' ').trim();
  if (!source) return [];
  const hits: Array<{ heading: string; at: number }> = [{ heading: title, at: 0 }];
  HEADING.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING.exec(source))) {
    const heading = tidy(match[1] ?? '');
    if (heading.length < 4) continue;
    const at = match.index ?? 0;
    if (at < 12 && hits.length === 1) {
      hits[0] = { heading, at };
      continue;
    }
    hits.push({ heading, at });
  }
  const passages: ReferencePassage[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i]!.at;
    const end = hits[i + 1]?.at ?? Math.min(source.length, start + WINDOW * 2);
    const slice = tidy(source.slice(start, end)).slice(0, WINDOW);
    if (slice.length < 40) continue;
    passages.push({ heading: hits[i]!.heading.slice(0, 160), text: slice });
  }
  if (passages.length === 0 && source.length > 40) {
    for (let i = 0; i < source.length && passages.length < 8; i += WINDOW) {
      passages.push({ heading: title, text: tidy(source.slice(i, i + WINDOW)) });
    }
  }
  return passages.slice(0, 48);
}

export function searchPassages(passages: ReferencePassage[], query: string, limit = 3): ReferencePassage[] {
  const needle = query.trim().toLowerCase();
  if (!needle || passages.length === 0) return passages.slice(0, limit);
  const parts = needle.split(/\s+/).filter((p) => p.length > 2);
  const ranked = passages
    .map((p) => {
      const hay = `${p.heading} ${p.text}`.toLowerCase();
      let score = 0;
      if (hay.includes(needle)) score += 8;
      for (const part of parts) if (hay.includes(part)) score += 2;
      return { p, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return (ranked.length ? ranked.map((r) => r.p) : passages).slice(0, limit);
}
