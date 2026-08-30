import { useEffect, useMemo, useState } from 'react';
import { sanitizeHtml } from './sanitize';

/**
 * A Word file, converted and shown.
 *
 * `.docx` has no page geometry until something lays it out — pagination is
 * produced by the word processor, not stored in the file — so a converted
 * document has no page 4 to jump to. The viewer says that rather than
 * pretending, and offers the term search instead, which is the anchor that
 * does survive conversion.
 */
export function DocxView({ blob, highlightTerm }: { blob: Blob; highlightTerm?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        // Loaded on demand: mammoth is only needed by the small share of
        // sessions that open a Word file, and it is not small.
        const mammoth = await import('mammoth');
        const arrayBuffer = await blob.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setWarnings(result.messages.length);
        setHtml(sanitizeHtml(result.value));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const marked = useMemo(() => {
    if (!html || !highlightTerm || highlightTerm.trim().length < 2) return html;
    return highlightInHtml(html, highlightTerm.trim());
  }, [html, highlightTerm]);

  if (error) return <div className="p-6 text-[12.5px] text-ink-secondary">This Word file could not be converted: {error}</div>;
  if (!marked) return <div className="p-6 text-[12.5px] text-ink-muted">Converting the document…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-hairline bg-surface-2 px-4 py-1.5 text-mini text-ink-muted">
        Converted from Word. Page numbers do not exist in a .docx — the layout is produced when it is printed
        {warnings > 0 ? `, and ${warnings} formatting detail${warnings === 1 ? '' : 's'} did not survive the conversion` : ''}.
      </div>
      <div className="flex-1 overflow-auto bg-surface-3 px-4 py-4">
        <article
          className="docx-render mx-auto max-w-[820px] bg-white px-10 py-10 shadow"
          // Sanitised above: an allowlist of tags and attributes, parsed in an
          // inert document, with script-bearing elements removed entirely.
          dangerouslySetInnerHTML={{ __html: marked }}
        />
      </div>
    </div>
  );
}

/**
 * Wrap occurrences of `term` in a `<mark>`, in TEXT nodes only.
 *
 * Doing this with a string replace over the HTML would happily rewrite a tag
 * name or an attribute value that happened to contain the term — which is
 * both a rendering bug and a way to reintroduce markup after sanitising. So
 * it walks the parsed tree and only ever touches text.
 */
function highlightInHtml(html: string, term: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const needle = term.toLowerCase();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.toLowerCase().includes(needle)) targets.push(node);
  }
  for (const node of targets) {
    const frag = doc.createDocumentFragment();
    let rest = node.data;
    let idx = rest.toLowerCase().indexOf(needle);
    while (idx !== -1) {
      if (idx > 0) frag.appendChild(doc.createTextNode(rest.slice(0, idx)));
      const mark = doc.createElement('mark');
      mark.textContent = rest.slice(idx, idx + term.length);
      frag.appendChild(mark);
      rest = rest.slice(idx + term.length);
      idx = rest.toLowerCase().indexOf(needle);
    }
    if (rest) frag.appendChild(doc.createTextNode(rest));
    node.parentNode?.replaceChild(frag, node);
  }
  return doc.body.innerHTML;
}
