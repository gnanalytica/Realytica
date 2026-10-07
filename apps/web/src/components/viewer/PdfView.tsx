import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { FactMarks } from '@realytica/shared';
import { MarksOverlay } from '../reading/MarksOverlay';

/*
 * pdf.js is pinned to 4.x deliberately. 6.x calls
 * `Map.prototype.getOrInsertComputed`, a 2025 proposal that Chromium 141 does
 * not have — so every page rendered blank white while the page count, the
 * text search and the highlights all worked, which is the worst shape a
 * failure can take here: the viewer looks like it is showing you a document.
 * Do not bump the major without opening a real PDF in the oldest browser we
 * mean to support; a typecheck cannot see this.
 *
 * pdf.js does its parsing in a worker. Vite's `?url` import hands us the
 * hashed asset path for both dev and the built bundle, so the worker is never
 * loaded from a CDN — a document under diligence must not leave the origin it
 * was uploaded to, and a third-party script that can read every page is the
 * same problem wearing a different hat.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfHighlight {
  /** 1-based. */
  page: number;
  /** The text to find on that page — normally the extracted value itself. */
  term: string;
}

interface Match {
  page: number;
  /** Viewport-space rectangles at scale 1, so they survive a zoom change. */
  rects: { x: number; y: number; w: number; h: number }[];
}

/** Comparison form: case and whitespace are not differences worth failing on. */
function fold(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Where a term appears on a page.
 *
 * Whole text ITEMS are returned, not character ranges. pdf.js gives each item
 * one transform and one width, so a sub-string's rectangle can only be
 * estimated by assuming a monospaced advance — which is wrong for every font
 * a deed is set in, and would draw the box beside the words rather than round
 * them. A slightly generous highlight that is certainly over the right words
 * beats a tight one that is sometimes over the wrong ones.
 */
async function findOnPage(page: PDFPageProxy, term: string): Promise<Match['rects']> {
  const needle = fold(term);
  if (needle.length < 2) return [];
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const rects: Match['rects'] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    if (!fold(item.str).includes(needle)) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    // After the viewport transform, t[5] is the text baseline in CSS space;
    // the glyph box rises above it by the item's height.
    const height = Math.abs(item.height) || Math.abs(t[3]) || 10;
    rects.push({ x: t[4], y: t[5] - height, w: item.width, h: height });
  }
  return rects;
}

export function PdfView({
  url,
  citedPage,
  highlight,
  marks,
  onPagesResolved,
}: {
  url: string;
  /** 1-based page the caller wants shown first. */
  citedPage?: number;
  highlight?: PdfHighlight;
  /** A fact's words where the reader found them: drawn on its page, and scrolled to. */
  marks?: { page: number; id: string } & FactMarks;
  onPagesResolved?: (pages: number) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [matches, setMatches] = useState<Match[]>([]);
  /** Counts each time the view is sent to the words a search found. The page they are on brings them to the middle. */
  const [seek, setSeek] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (d) => {
        if (cancelled) return;
        setDoc(d);
        setPageCount(d.numPages);
        onPagesResolved?.(d.numPages);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
      // Destroying the loading task tears down the worker and the document
      // with it; the proxy has no destroy of its own in this version.
      void task.destroy();
    };
    // onPagesResolved is a reporting callback; re-loading the document because
    // the parent re-created it would re-parse the file on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  /* Find the highlight term once per document, not once per render. */
  useEffect(() => {
    if (!doc || !highlight?.term) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const found: Match[] = [];
      // The cited page first: it is the one the caller believes the value is
      // on, and a document of 200 pages should not be scanned to confirm it.
      const order = [highlight.page, ...Array.from({ length: doc.numPages }, (_, i) => i + 1)]
        .filter((p, i, all) => p >= 1 && p <= doc.numPages && all.indexOf(p) === i);
      for (const n of order) {
        if (cancelled) return;
        const page = await doc.getPage(n);
        const rects = await findOnPage(page, highlight.term);
        if (rects.length) found.push({ page: n, rects });
        // One page's worth of hits is enough to point at the proof; scanning
        // the rest would spend a second of main-thread time to decorate pages
        // nobody is looking at.
        if (found.length >= 1 && n === highlight.page) break;
      }
      if (!cancelled) setMatches(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, highlight?.term, highlight?.page]);

  const scrollToPage = useCallback((n: number) => {
    const el = pageRefs.current.get(n);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  /*
   * Open on the cited page: at its top, unless a fact's words are marked on
   * it. Then the page brings those words to the middle by itself, and a
   * second scroll to the top of the page, started a moment later, would take
   * the view off them whenever they sit lower than the viewer is tall.
   */
  const openedAt = useRef<number | null>(null);
  const markedPage = marks?.page;
  useEffect(() => {
    if (!doc || !citedPage) return;
    if (openedAt.current === citedPage) return;
    if (markedPage === citedPage) {
      setCurrent(citedPage);
      openedAt.current = citedPage;
      return;
    }
    const t = window.setTimeout(() => {
      scrollToPage(citedPage);
      setCurrent(citedPage);
      openedAt.current = citedPage;
    }, 60);
    return () => window.clearTimeout(t);
  }, [doc, citedPage, markedPage, scrollToPage]);

  /*
   * Where the words actually are beats where the record says they are.
   *
   * The extraction stores one page per field and it can be wrong — in the
   * seeded case every field claims page 1 — so once the value has been FOUND
   * on a page, that is the page to show. The recorded page is a claim; a
   * match is evidence. The chip keeps naming the page it went to, so the jump
   * is never silent.
   *
   * It goes to the words, not to the top of their page: a page is often
   * taller than the viewer, and its top would leave them below the fold. The
   * wait puts this after the move to the cited page, which it replaces.
   */
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!matches.length || !highlight?.term) return;
    const token = `${highlight.term}:${matches[0].page}`;
    if (jumpedTo.current === token) return;
    jumpedTo.current = token;
    const t = window.setTimeout(() => {
      setCurrent(matches[0].page);
      setSeek((n) => n + 1);
    }, 60);
    return () => window.clearTimeout(t);
  }, [matches, highlight?.term]);

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount]);
  const matchByPage = useMemo(() => new Map(matches.map((m) => [m.page, m.rects])), [matches]);

  if (error) {
    return (
      <div className="p-6 text-[13px] text-ink-secondary">
        This PDF could not be opened: {error}
      </div>
    );
  }
  if (!doc) {
    return <div className="p-6 text-[13px] text-ink-muted">Opening the document…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline bg-raised px-3 py-1.5">
        <button
          type="button"
          onClick={() => { const n = Math.max(1, current - 1); setCurrent(n); scrollToPage(n); }}
          disabled={current <= 1}
          className="rounded px-2 py-0.5 text-mini text-ink-secondary disabled:text-ink-muted"
        >
          Previous
        </button>
        <span className="tabular text-mini text-ink-secondary">
          Page {current} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => { const n = Math.min(pageCount, current + 1); setCurrent(n); scrollToPage(n); }}
          disabled={current >= pageCount}
          className="rounded px-2 py-0.5 text-mini text-ink-secondary disabled:text-ink-muted"
        >
          Next
        </button>
        <div className="flex-grow" />
        {matches.length > 0 ? (
          <button
            type="button"
            onClick={() => { setCurrent(matches[0].page); setSeek((n) => n + 1); }}
            className="rounded-full bg-warning/25 px-2 py-0.5 text-mini text-ink"
          >
            Found on page {matches[0].page}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => { setFitWidth(false); setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2))); }}
          className="rounded px-2 py-0.5 text-mini text-ink-secondary"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setFitWidth(true)}
          className="rounded px-2 py-0.5 text-mini text-ink-secondary"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => { setFitWidth(false); setScale((s) => Math.min(4, +(s + 0.25).toFixed(2))); }}
          className="rounded px-2 py-0.5 text-mini text-ink-secondary"
        >
          +
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto bg-sunken px-3 py-3">
        <div className="mx-auto flex w-fit flex-col gap-3">
          {pages.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              pageNumber={n}
              scale={scale}
              fitWidth={fitWidth}
              container={scrollRef}
              cited={citedPage === n}
              highlights={matchByPage.get(n) ?? []}
              seek={matches[0]?.page === n ? seek : 0}
              marks={marks && marks.page === n ? marks : undefined}
              onVisible={() => setCurrent(n)}
              register={(el) => {
                if (el) pageRefs.current.set(n, el);
                else pageRefs.current.delete(n);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  fitWidth,
  container,
  cited,
  highlights,
  seek,
  marks,
  onVisible,
  register,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  fitWidth: boolean;
  container: React.RefObject<HTMLDivElement | null>;
  cited: boolean;
  highlights: Match['rects'];
  /** Not zero on the page whose found words the view is sent to; a new number sends it again. */
  seek: number;
  marks?: { page: number; id: string } & FactMarks;
  onVisible: () => void;
  register: (el: HTMLDivElement | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; applied: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A render task that is still running when its canvas is re-rendered
    // throws "Cannot use the same canvas"; cancelling on cleanup is what makes
    // a zoom change mid-render safe.
    let task: pdfjs.RenderTask | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const available = (container.current?.clientWidth ?? 900) - 40;
      const applied = fitWidth ? Math.max(0.3, available / base.width) : scale;
      const viewport = page.getViewport({ scale: applied });
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      // Render at device resolution and scale down in CSS, or a deed's small
      // print is unreadable on the display it is being read on.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      setSize({ w: viewport.width, h: viewport.height, applied });

      task = page.render({ canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      try {
        await task.promise;
      } catch {
        /* cancelled by a zoom change or unmount */
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale, fitWidth, container]);

  /*
   * A point of the page, in its own pixels as drawn, brought to the middle of
   * the viewer: across as well as down, since an enlarged page is wider than
   * the viewer. Measured from where the page is drawn, not from its offset,
   * which is counted from whatever positioned box holds the viewer.
   */
  const centre = useCallback(
    (x: number, y: number) => {
      const host = hostRef.current;
      const scroller = container.current;
      if (!host || !scroller) return;
      const at = host.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop + at.top - box.top + y - scroller.clientHeight / 2),
        left: Math.max(0, scroller.scrollLeft + at.left - box.left + x - scroller.clientWidth / 2),
        behavior: reduced ? 'auto' : 'smooth',
      });
    },
    [container],
  );

  /*
   * The marked words come to the middle once the page has its size. By where
   * the words are, not by the fact's object: the project is a new object
   * after any change to it, and that must not scroll the page again.
   */
  const first = marks?.quote[0];
  const markX = first ? first.x + first.w / 2 : undefined;
  const markY = first ? first.y + first.h / 2 : undefined;
  useEffect(() => {
    if (markX === undefined || markY === undefined || !size) return;
    centre(markX * size.w, markY * size.h);
  }, [marks?.id, markX, markY, size, centre]);

  /* Words a search found come to the middle the same way, each time the viewer sends the view to them. */
  const found = highlights[0];
  const foundX = found ? found.x + found.w / 2 : undefined;
  const foundY = found ? found.y + found.h / 2 : undefined;
  useEffect(() => {
    if (!seek || foundX === undefined || foundY === undefined || !size) return;
    centre(foundX * size.applied, foundY * size.applied);
  }, [seek, foundX, foundY, size, centre]);

  /*
   * The page in view is the one across the middle of the viewer. Counting a
   * page once half of it shows never counted one taller than twice the
   * viewer: any page once enlarged, and every page in a short viewer.
   */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) onVisible();
      },
      { root: container.current, rootMargin: '-50% 0px -50% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible, container]);

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
        register(el);
      }}
      data-page={pageNumber}
      className="relative"
    >
      <canvas
        ref={canvasRef}
        style={size ? { width: size.w, height: size.h } : undefined}
        className={cited ? 'block bg-white shadow ring-2 ring-brand' : 'block bg-white shadow'}
      />
      {size
        ? highlights.map((r, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute rounded-[2px] bg-warning/40 mix-blend-multiply"
              style={{
                left: r.x * size.applied,
                top: r.y * size.applied,
                width: r.w * size.applied,
                height: r.h * size.applied,
              }}
            />
          ))
        : null}
      {size && marks?.quote.length ? (
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: size.w, height: size.h }}>
          <MarksOverlay marks={marks} markId={marks.id} />
        </div>
      ) : null}
      <span className="tabular absolute -top-0.5 right-1 rounded-b bg-ink/60 px-1.5 text-micro text-white">
        {pageNumber}
      </span>
    </div>
  );
}
