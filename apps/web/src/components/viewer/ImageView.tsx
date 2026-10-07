import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FactMarks } from '@realytica/shared';
import { MarksOverlay } from '../reading/MarksOverlay';

/**
 * A picture, shown as the one page it is.
 *
 * A scanned page has no text to search, so where a value is can only be shown
 * by the marks the reader kept for it: the same boxes the reading desk draws,
 * laid over the picture. It opens at the width it has room for and is
 * enlarged from there, since the print on a scanned deed is small.
 */
export function ImageView({ url, alt, marks }: { url: string; alt: string; marks?: { id: string } & FactMarks }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [room, setRoom] = useState(0);
  /** 1 is the width it fits in. */
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRoom(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Never enlarged to fit: a small picture stretched across the viewer is a blur.
  const width = natural && room ? Math.round(Math.min(natural.w, room) * zoom) : 0;
  const height = natural && width ? Math.round((width * natural.h) / natural.w) : 0;

  /* The marked words, brought to the middle of the viewer, across as well as down once the picture is wider than it. */
  const first = marks?.quote[0];
  const markX = first ? first.x + first.w / 2 : undefined;
  const markY = first ? first.y + first.h / 2 : undefined;
  useEffect(() => {
    const scroller = scrollRef.current;
    const page = pageRef.current;
    if (markX === undefined || markY === undefined || !scroller || !page || !width) return;
    const at = page.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      top: Math.max(0, scroller.scrollTop + at.top - box.top + markY * height - scroller.clientHeight / 2),
      left: Math.max(0, scroller.scrollLeft + at.left - box.left + markX * width - scroller.clientWidth / 2),
      behavior: calm ? 'auto' : 'smooth',
    });
  }, [marks?.id, markX, markY, width, height]);

  if (failed) {
    return <div className="p-6 text-[13px] text-ink-secondary">This browser cannot draw this picture. Download it to see it.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline bg-raised px-3 py-1.5">
        <div className="flex-grow" />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded px-2 py-0.5 text-mini text-ink-secondary">
          −
        </button>
        <button type="button" onClick={() => setZoom(1)} className="rounded px-2 py-0.5 text-mini text-ink-secondary">
          Fit
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} className="rounded px-2 py-0.5 text-mini text-ink-secondary">
          +
        </button>
      </div>
      {/* The scrollbar's room is kept whether or not it shows. The picture is sized by the width measured here, and a bar that came and went with that size would change the measure each time. */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-sunken p-3 [scrollbar-gutter:stable]">
        <div ref={pageRef} className="relative mx-auto w-fit">
          <img
            src={url}
            alt={alt}
            style={width ? { width, height } : undefined}
            className={width ? 'block max-w-none bg-white shadow' : 'block max-w-full bg-white shadow'}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
          {width && marks?.quote.length ? <MarksOverlay marks={marks} markId={marks.id} /> : null}
        </div>
      </div>
    </div>
  );
}
