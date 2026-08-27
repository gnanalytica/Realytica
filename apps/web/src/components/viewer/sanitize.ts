/**
 * An allowlist sanitizer for converted document HTML.
 *
 * Mammoth builds this HTML from a .docx someone uploaded, so it is
 * attacker-influenced markup about to be inserted into our own origin. Its
 * output is normally a small, tame tag set — but "normally" is not a security
 * property, and the whole point of the viewer is to open files nobody has
 * vetted.
 *
 * So: parse in an inert document, keep only the tags and attributes named
 * here, and drop everything else including its subtree for the tags that
 * carry script. Anything unrecognised is unwrapped rather than deleted, so an
 * unexpected wrapper costs formatting, never the text of the clause.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'SPAN', 'DIV',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COL', 'COLGROUP',
  'IMG', 'A',
]);

/** Tags whose content is code, not prose: removed with their subtree. */
const DROP_WITH_SUBTREE = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'SVG', 'MATH']);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  IMG: new Set(['src', 'alt', 'width', 'height']),
  A: new Set(['href', 'title']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan', 'scope']),
};

/**
 * Mammoth embeds images as `data:` URIs, which is the only image source a
 * converted document should have — it means the bytes came out of the file
 * rather than being fetched from wherever the document points. `http(s)` is
 * allowed on links only, and every link is forced to open detached.
 */
function safeUrl(value: string, allowData: boolean): string | null {
  const v = value.trim();
  if (allowData && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('#')) return v;
  return null;
}

export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = parsed.body;

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toUpperCase();

      if (DROP_WITH_SUBTREE.has(tag)) {
        child.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Keep the words, lose the wrapper.
        walk(child);
        while (child.firstChild) child.parentNode?.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }

      const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allowed.has(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'src' || name === 'href') {
          const url = safeUrl(attr.value, name === 'src');
          if (url === null) child.removeAttribute(attr.name);
          else child.setAttribute(name, url);
        }
      }
      if (tag === 'A' && child.getAttribute('href')) {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      walk(child);
    }
  };

  walk(body);
  return body.innerHTML;
}
