import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { FactMarks } from '@realytica/shared';
import { evidenceFileUrl, fetchWithAuth, proposalFileUrl } from '../../lib/api';
import type { ReadingSource } from '../../lib/reading';
import { Button, cn } from '../ui/kit';
import { MarksOverlay } from './MarksOverlay';
import { noPageSaid, type NoPage } from './said';

/* Same worker as the document viewer: served from this origin, never a CDN. */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** What became of a file asked for: a page to draw, nothing to draw, or what is said in its place. */
type Loaded =
  | { kind: 'pdf'; doc: PDFDocumentProxy }
  | { kind: 'image'; url: string }
  | { kind: 'none' }
  | { kind: 'failed'; said: string; again: boolean };

const failed = (no: NoPage): Loaded => ({ kind: 'failed', ...noPageSaid(no) });

/*
 * One load per file for the life of the page.
 *
 * The desk shows the same file again and again — every page the reader
 * reaches, every fact a person points at — and fetching and parsing it each
 * time would make the scan line wait on the network. Keyed by where the bytes
 * come from, so the same file reached two ways is still one load. Only a load
 * that drew something is kept: one that failed is asked for afresh the next
 * time, or a dropped connection would blank the file until the tab is closed.
 */
const loads = new Map<string, Promise<Loaded>>();

function sourceKey(projectId: string, source: ReadingSource): string {
  switch (source.kind) {
    case 'local':
      return `local:${source.file.name}:${source.file.size}:${source.file.lastModified}`;
    case 'evidence':
      return `ev:${projectId}:${source.evidenceId}:${source.fileId}`;
    case 'proposal':
      return `card:${projectId}:${source.proposalId}`;
  }
}

async function bytesOf(projectId: string, source: ReadingSource): Promise<{ data: ArrayBuffer; type: string } | { refused: number }> {
  if (source.kind === 'local') return { data: await source.file.arrayBuffer(), type: source.file.type };
  const url =
    source.kind === 'evidence'
      ? // Asked for as the viewer asks: the type is then the one the server read off the bytes, not the download's.
        evidenceFileUrl(projectId, source.evidenceId, source.fileId, { inline: true })
      : proposalFileUrl(projectId, source.proposalId);
  const res = await fetchWithAuth(url);
  if (!res.ok) return { refused: res.status };
  const type = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  return { data: await res.arrayBuffer(), type };
}

async function read(projectId: string, source: ReadingSource, mimeType: string): Promise<Loaded> {
  let got: Awaited<ReturnType<typeof bytesOf>>;
  try {
    got = await bytesOf(projectId, source);
  } catch {
    return failed({ why: 'unreached', local: source.kind === 'local' });
  }
  if ('refused' in got) return failed({ why: 'refused', status: got.refused });
  // A file the server could not name by its bytes is taken for what it was filed as.
  const type = got.type && got.type !== 'application/octet-stream' ? got.type : mimeType;
  if (type.startsWith('image/')) return { kind: 'image', url: URL.createObjectURL(new Blob([got.data], { type })) };
  if (type === 'application/pdf' || /\.pdf$/i.test(mimeType) || mimeType === 'application/pdf') {
    try {
      return { kind: 'pdf', doc: await pdfjs.getDocument({ data: new Uint8Array(got.data) }).promise };
    } catch {
      return failed({ why: 'broken' });
    }
  }
  return failed({ why: 'pageless' });
}

function load(projectId: string, source: ReadingSource, mimeType: string): Promise<Loaded> {
  const key = sourceKey(projectId, source);
  let pending = loads.get(key);
  if (!pending) {
    pending = read(projectId, source, mimeType);
    loads.set(key, pending);
    void pending.then((loaded) => {
      if (loaded.kind === 'failed' && loads.get(key) === pending) loads.delete(key);
    });
  }
  return pending;
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One page of a document, with the reading drawn over it.
 *
 * While a page is being read a scan line travels down it. When a person
 * points at a fact, the page is the fact's page and its words are marked the
 * way a person would mark them: the quote highlighted line by line, and the
 * value itself ringed. The marks are the boxes the reader found the words in,
 * so they sit over the words rather than near them.
 *
 * A file that cannot be drawn is a blank ruled sheet that says why, and
 * offers another try where trying again can end differently.
 */
export function PagePreview({
  projectId,
  source,
  mimeType,
  page,
  scanning,
  scanMs,
  marks,
  markId,
  zoom = 1,
  className,
}: {
  projectId: string;
  source: ReadingSource | null;
  mimeType: string;
  /** 1-based. */
  page: number;
  scanning?: boolean;
  /** One pass of the scan line, when it should match a page being stepped through. */
  scanMs?: number;
  marks?: FactMarks | null;
  /** Changes whenever a different fact is pointed at, so its marks draw afresh. */
  markId?: string;
  /** How many times the width there is room for. At 1 the page fits the panel; past it the panel scrolls sideways too. */
  zoom?: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [aspect, setAspect] = useState(1.414);
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    if (!source) {
      setLoaded({ kind: 'none' });
      return;
    }
    void load(projectId, source, mimeType).then((l) => {
      if (live) setLoaded(l);
    });
    return () => {
      live = false;
    };
  }, [projectId, source, mimeType, attempt]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = loaded?.kind === 'pdf' ? loaded.doc : undefined;
  const pageNumber = doc ? Math.min(Math.max(1, page), doc.numPages) : page;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || width < 40) return;
    let task: RenderTask | null = null;
    let live = true;
    void doc.getPage(pageNumber).then((p) => {
      if (!live) return;
      const base = p.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: (width / base.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);

  const quote = marks?.quote ?? [];
  /* A blank sheet stands in for the page until it is drawn, and for good when it cannot be. Nothing is marked on it. */
  const paper = loaded?.kind !== 'pdf' && loaded?.kind !== 'image';

  /* Bring the marked words into view, centred, when the page is taller than the panel, or enlarged past its width. */
  useEffect(() => {
    const scroller = scrollRef.current;
    const first = quote[0];
    if (!scroller || !first || paper) return;
    const pageHeight = width * aspect;
    scroller.scrollTo({
      top: Math.max(0, first.y * pageHeight - scroller.clientHeight / 2),
      left: Math.max(0, (first.x + first.w / 2) * width - scroller.clientWidth / 2),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    // Re-centre only when a different fact is pointed at, or its page is drawn at last.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markId, width, aspect, paper]);

  return (
    <div ref={scrollRef} className={cn('relative rounded-lg bg-sunken', zoom > 1 ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden', className)}>
      <div ref={boxRef} className="relative" style={{ width: `${(paper ? 1 : zoom) * 100}%` }}>
        {loaded?.kind === 'failed' ? (
          /*
           * Held at the top of the panel, wherever the sheet is scrolled to.
           * Stacked under the list, the sheet is taller than its panel, and
           * a place down the sheet is below the fold. On a card of the
           * theme's own, so it reads on the white sheet in the dark theme too.
           * The button stands beside the sentence, not under it: the panel
           * is as short as 70px where a value's words are quoted below it.
           */
          <div role="status" className="sticky top-1.5 z-[1] flex h-0 items-start justify-center px-4">
            <div className="flex max-w-[20rem] items-center gap-2.5 rounded-lg bg-surface px-3 py-2 shadow-raised ring-1 ring-[var(--ring)]">
              <p className="min-w-0 text-[13px] leading-snug text-ink">{loaded.said}</p>
              {loaded.again ? (
                <Button size="sm" className="shrink-0" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="relative w-full overflow-hidden bg-white shadow-raised" style={{ aspectRatio: paper ? '1 / 1.3' : `1 / ${aspect}` }}>
          {loaded?.kind === 'pdf' ? <canvas ref={canvasRef} className="block h-full w-full" aria-hidden /> : null}
          {loaded?.kind === 'image' ? (
            <img
              src={loaded.url}
              alt=""
              className="block h-full w-full object-contain"
              onLoad={(e) => setAspect(e.currentTarget.naturalHeight / Math.max(1, e.currentTarget.naturalWidth))}
              // Loaded, and still not a picture this browser can draw.
              onError={() => setLoaded(failed({ why: 'undrawable' }))}
            />
          ) : null}
          {paper ? <PaperSkeleton busy={loaded === null} /> : null}
          {scanning ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              {/* Keyed by page, so each page gets its own pass from the top. */}
              <div key={page} className="absolute inset-x-0 top-0 h-full animate-scan" style={scanMs ? { animationDuration: `${scanMs}ms` } : undefined}>
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-brand/15" />
                <div className="absolute inset-x-0 bottom-0 h-[2px] bg-brand shadow-[0_0_14px_3px_rgb(var(--brand-rgb)/0.55)]" />
              </div>
            </div>
          ) : null}

          {!paper && marks?.quote.length ? <MarksOverlay marks={marks} markId={markId} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Ruled lines on a blank sheet, where the file itself cannot be drawn. */
function PaperSkeleton({ busy }: { busy: boolean }) {
  const widths = ['86%', '92%', '78%', '90%', '64%', '88%', '93%', '71%', '84%', '58%', '90%', '76%'];
  return (
    <div className="absolute inset-0 flex flex-col gap-[3.2%] px-[9%] py-[10%]" aria-hidden>
      <div className={cn('h-[2.2%] w-[42%] rounded-sm bg-[#e7e5df]', busy && 'animate-pulse')} />
      {widths.map((w, i) => (
        <div key={i} className={cn('h-[1.3%] rounded-sm bg-[#efede8]', busy && 'animate-pulse')} style={{ width: w }} />
      ))}
    </div>
  );
}
