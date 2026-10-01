import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { FactMarks } from '@realytica/shared';
import { evidenceFileUrl, fetchWithAuth, proposalFileUrl, sampleDocumentUrl } from '../../lib/api';
import type { ReadingSource } from '../../lib/reading';
import { cn } from '../ui/kit';
import { MarksOverlay } from './MarksOverlay';

/* Same worker as the document viewer: served from this origin, never a CDN. */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Loaded {
  kind: 'pdf' | 'image' | 'none';
  doc?: PDFDocumentProxy;
  url?: string;
}

/*
 * One load per file for the life of the page.
 *
 * The desk shows the same file again and again — every page the reader
 * reaches, every fact a person points at — and fetching and parsing it each
 * time would make the scan line wait on the network. Keyed by where the bytes
 * come from, so the same file reached two ways is still one load.
 */
const loads = new Map<string, Promise<Loaded>>();

function sourceKey(projectId: string, source: ReadingSource): string {
  switch (source.kind) {
    case 'local':
      return `local:${source.file.name}:${source.file.size}:${source.file.lastModified}`;
    case 'evidence':
      return `ev:${projectId}:${source.evidenceId}:${source.fileId}`;
    case 'sample':
      return `sample:${projectId}:${source.name}`;
    case 'proposal':
      return `card:${projectId}:${source.proposalId}`;
  }
}

async function bytesOf(projectId: string, source: ReadingSource): Promise<{ data: ArrayBuffer; type: string } | null> {
  if (source.kind === 'local') return { data: await source.file.arrayBuffer(), type: source.file.type };
  const url =
    source.kind === 'evidence'
      ? evidenceFileUrl(projectId, source.evidenceId, source.fileId)
      : source.kind === 'sample'
        ? sampleDocumentUrl(projectId, source.name)
        : proposalFileUrl(projectId, source.proposalId);
  const res = await fetchWithAuth(url);
  if (!res.ok) return null;
  const type = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  return { data: await res.arrayBuffer(), type };
}

function load(projectId: string, source: ReadingSource, mimeType: string): Promise<Loaded> {
  const key = sourceKey(projectId, source);
  let pending = loads.get(key);
  if (!pending) {
    pending = (async (): Promise<Loaded> => {
      const got = await bytesOf(projectId, source);
      if (!got) return { kind: 'none' };
      const type = got.type || mimeType;
      if (type.startsWith('image/')) return { kind: 'image', url: URL.createObjectURL(new Blob([got.data], { type })) };
      if (type === 'application/pdf' || /\.pdf$/i.test(mimeType) || mimeType === 'application/pdf') {
        const doc = await pdfjs.getDocument({ data: new Uint8Array(got.data) }).promise;
        return { kind: 'pdf', doc };
      }
      return { kind: 'none' };
    })().catch(() => ({ kind: 'none' }) as Loaded);
    loads.set(key, pending);
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
  className?: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
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
  }, [projectId, source, mimeType]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageNumber = loaded?.doc ? Math.min(Math.max(1, page), loaded.doc.numPages) : page;

  useEffect(() => {
    const doc = loaded?.doc;
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
  }, [loaded, pageNumber, width]);

  const quote = marks?.quote ?? [];

  /* Bring the marked words into view, centred, when the page is taller than the panel. */
  useEffect(() => {
    const scroller = scrollRef.current;
    const first = quote[0];
    if (!scroller || !first) return;
    const pageHeight = width * aspect;
    const target = first.y * pageHeight - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: reducedMotion() ? 'auto' : 'smooth' });
    // Re-centre only when a different fact is pointed at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markId, width, aspect]);

  const paper = loaded?.kind !== 'pdf' && loaded?.kind !== 'image';

  return (
    <div ref={scrollRef} className={cn('relative overflow-y-auto overflow-x-hidden rounded-lg bg-sunken', className)}>
      <div ref={boxRef} className="relative w-full">
        <div className="relative w-full overflow-hidden bg-white shadow-raised" style={{ aspectRatio: paper ? '1 / 1.3' : `1 / ${aspect}` }}>
          {loaded?.kind === 'pdf' ? <canvas ref={canvasRef} className="block h-full w-full" aria-hidden /> : null}
          {loaded?.kind === 'image' && loaded.url ? (
            <img
              src={loaded.url}
              alt=""
              className="block h-full w-full object-contain"
              onLoad={(e) => setAspect(e.currentTarget.naturalHeight / Math.max(1, e.currentTarget.naturalWidth))}
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

          {marks?.quote.length ? <MarksOverlay marks={marks} markId={markId} /> : null}
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
