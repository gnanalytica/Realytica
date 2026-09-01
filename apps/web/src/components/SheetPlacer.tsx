/**
 * Pairing a spot on a scanned sheet with a spot on the ground.
 *
 * The whole interaction is: click something you recognise on the sheet, then
 * say where it is. Everything else — the transform, the bounds, the residuals
 * — falls out of those pairs, and none of it is stored, so a sheet can never
 * carry a placement from control points that were since moved.
 *
 * ## Why clicks are stored as fractions
 *
 * A click gives pixels, and pixels depend on how the browser happened to scale
 * the image. Storing them would mean a sheet re-scanned at a different
 * resolution, or served downsampled, silently lands somewhere else. So a click
 * is divided by the rendered box before it leaves this component and the
 * server never sees a pixel.
 *
 * ## Why the fit is shown before it is trusted
 *
 * The residual per point is the only thing standing between a plausible-looking
 * overlay and a boundary read off the wrong place. Two points always fit
 * exactly — that is arithmetic, not accuracy — so the panel says "unchecked"
 * rather than "0 m", and a rotated sheet is called out as rotated rather than
 * squeezed into a north-up box that cannot hold it.
 */

import { useMemo, useRef, useState } from 'react';
import { readSheetFit, type SheetPlacement } from '@realytica/shared';
import { api } from '../lib/api';
import { Button, Field, Input, Modal, useToast } from './ui/kit';

/**
 * A blank box is not zero.
 *
 * `Number('')` is 0 and `Number.isFinite(0)` is true, so filtering half-typed
 * control points with a bare `Number()` let every empty one through as
 * 0°N 0°E — a spot in the Gulf of Guinea — which dragged the live fit into
 * nonsense the moment somebody clicked a fourth point before typing its
 * coordinates. Exactly the blank-is-not-zero rule the check fields already
 * run on, in the one place it was missed.
 */
function coordinate(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  return Number(trimmed);
}

interface Draft {
  u: number;
  v: number;
  lat: string;
  lng: string;
  label: string;
}

export function SheetPlacer({
  projectId,
  placement,
  onClose,
  onSaved,
}: {
  projectId: string;
  placement: SheetPlacement;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState<Draft[]>(() =>
    placement.sheet.controlPoints.map((p) => ({ u: p.u, v: p.v, lat: String(p.lat), lng: String(p.lng), label: p.label ?? '' })),
  );

  const src = placement.sheet.attachmentId
    ? `/api/projects/${projectId}/evidence/${placement.sheet.evidenceId}/files/${placement.sheet.attachmentId}?inline=1`
    : undefined;

  /**
   * The fit as it stands under the current, possibly half-typed, points.
   *
   * Recomputed on every keystroke from the same function the server uses, so
   * the verdict somebody is reading while they work is the verdict they will
   * get when they save. A separate client-side approximation would eventually
   * disagree with the stored one, and this is a screen whose entire job is
   * telling you whether to believe it.
   */
  const live = useMemo(() => {
    const usable = points
      .map((p, i) => ({ id: `draft-${i}`, u: p.u, v: p.v, lat: coordinate(p.lat), lng: coordinate(p.lng), label: p.label || undefined }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return readSheetFit(usable);
  }, [points]);

  const residualFor = (index: number): number | undefined =>
    live.fit?.residuals.find((r) => r.pointId === `draft-${index}`)?.metres;

  function addPointAt(event: React.MouseEvent<HTMLImageElement>) {
    const el = imgRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    // Fractions of the rendered box, so the stored point survives a rescan.
    const u = (event.clientX - box.left) / box.width;
    const v = (event.clientY - box.top) / box.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    setPoints((prev) => [...prev, { u, v, lat: '', lng: '', label: '' }]);
  }

  async function save() {
    setBusy(true);
    try {
      const usable = points
        .map((p) => ({ u: p.u, v: p.v, lat: coordinate(p.lat), lng: coordinate(p.lng), label: p.label.trim() || undefined }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      await api.setControlPoints(projectId, placement.sheet.id, usable);
      await onSaved();
      toast('Sheet placed', 'good');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not place the sheet', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const tone =
    live.verdict === 'good'
      ? 'text-status-good-text'
      : live.verdict === 'rotated' || live.verdict === 'unusable'
        ? 'text-status-critical'
        : 'text-status-warning';

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={`Place “${placement.sheet.title}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Save control points</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[12.5px] text-ink-secondary">
          Click something you can recognise on the sheet — a road junction, a survey corner, a lake edge — then say where it is. Two points
          place it; a third is what first lets the fit disagree with you.
        </p>

        {src ? (
          /*
           * `w-full` with the height left to follow, and NO `object-contain`.
           *
           * The first version had both, and it put every marker in the wrong
           * place. `object-contain` letterboxes the painted image inside a
           * wider element box, but a click reads `getBoundingClientRect()` —
           * the ELEMENT box — so a fraction was measured against the grey
           * bars as well as the sheet. Two consequences: the numbered markers
           * drew outside the image, and worse, a stored `u` meant a different
           * spot on the sheet depending on how the browser had sized the box
           * that day. Fractions only survive a rescan if they are fractions of
           * the image itself.
           *
           * With the height following the width, the element box IS the
           * painted image, so the click, the marker and the stored fraction
           * are all measuring the same rectangle. A tall sheet scrolls in the
           * modal body rather than being squashed to fit.
           */
          <div className="flex justify-center overflow-hidden rounded-lg border border-hairline bg-sunken">
            {/* The inner box shrink-wraps the image, so the positioned parent
                of every marker is exactly the rectangle a click is measured
                against. Capping the height rather than the width keeps the
                control-point rows reachable without scrolling past the sheet. */}
            <div className="relative">
              <img
                ref={imgRef}
                src={src}
                alt={placement.sheet.title}
                className="block max-h-[46vh] max-w-full cursor-crosshair"
                onClick={addPointAt}
              />
              {points.map((p, i) => (
                <span
                  key={i}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand px-1.5 text-[10px] font-semibold text-white shadow"
                  style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%` }}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
        ) : (
          // A sheet whose evidence row has no file cannot be placed by
          // clicking. Said plainly rather than rendering a broken image.
          <p className="rounded-lg border border-dashed border-hairline p-4 text-[12px] text-ink-muted">
            This sheet names an evidence row with no file attached to it. Upload the scan on the evidence register first, then come back.
          </p>
        )}

        <p className={`text-[12px] ${tone}`}>{live.say}</p>

        {points.length ? (
          <div className="space-y-2">
            {points.map((p, i) => {
              const residual = residualFor(i);
              return (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-hairline p-2">
                  <span className="pb-1.5 text-[11px] font-semibold text-ink-muted">{i + 1}</span>
                  <Field label="Latitude" className="w-32">
                    <Input
                      value={p.lat}
                      inputMode="decimal"
                      onChange={(e) => setPoints(points.map((q, j) => (j === i ? { ...q, lat: e.target.value } : q)))}
                    />
                  </Field>
                  <Field label="Longitude" className="w-32">
                    <Input
                      value={p.lng}
                      inputMode="decimal"
                      onChange={(e) => setPoints(points.map((q, j) => (j === i ? { ...q, lng: e.target.value } : q)))}
                    />
                  </Field>
                  <Field label="What it is" className="min-w-[10rem] flex-1" hint={i === 0 ? 'The only thing that lets somebody else check this pairing later.' : undefined}>
                    <Input
                      value={p.label}
                      placeholder="Kanakapura Rd / Ring Rd junction"
                      onChange={(e) => setPoints(points.map((q, j) => (j === i ? { ...q, label: e.target.value } : q)))}
                    />
                  </Field>
                  {residual !== undefined ? (
                    <span className="pb-1.5 text-[11px] tabular-nums text-ink-muted" title="How far the fit puts this point from where you said it is.">
                      {Math.round(residual)} m
                    </span>
                  ) : null}
                  <button type="button" className="pb-1.5 text-[12px] text-ink-muted hover:text-ink" onClick={() => setPoints(points.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
