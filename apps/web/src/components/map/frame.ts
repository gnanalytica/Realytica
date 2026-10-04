import L from 'leaflet';
import { GIS_OVERLAY_RADIUS_M, type GeoPoint, type GisOverlayRead } from '@realytica/shared';

/*
 * Where the map opens, and when it is allowed to move there by itself.
 */

/** No closer than this either side of the centre: a small plot keeps the roads and neighbours that place it. */
const SITE_MARGIN_M = 150;

/** The one point that stands for the site, and what to call it: "the pin", or "the outline centre". */
export interface SitePoint extends GeoPoint {
  name: string;
}

/** What the map holds about the site: its frame, its point, and the frame the map last opened on. */
export interface SiteView {
  frame: L.LatLngBounds | null;
  point: SitePoint | null;
  opened: string | null;
}

function outlineOf(read: GisOverlayRead): L.LatLngBounds | null {
  return read.survey?.ring.length ? L.latLngBounds(read.survey.ring.map((p) => L.latLng(p.lat, p.lng))) : null;
}

/**
 * Where the map opens: on the site, and on nothing else.
 *
 * The outline when one is on file; otherwise the pin, with the distance the
 * overlay reads context for around it. Wards, lakes and the state's layers
 * are context and never widen the frame — a ward is kilometres across, and
 * framing one left a 40 m plot seven pixels wide.
 *
 * The room round a large outline is a tenth of its own size, and it is part
 * of the frame rather than padding added in pixels when the map is fitted. A
 * map only has whole zoom levels, and on a narrow phone a few pixels of
 * padding were enough to tip a small plot out to the next one, twice as wide.
 */
export function siteFrame(read: GisOverlayRead): L.LatLngBounds | null {
  const outline = outlineOf(read);
  if (outline) return outline.pad(0.1).extend(outline.getCenter().toBounds(2 * SITE_MARGIN_M));
  return read.pin ? L.latLng(read.pin.lat, read.pin.lng).toBounds(2 * GIS_OVERLAY_RADIUS_M) : null;
}

/** The pin, or the middle of the outline when there is no pin. */
export function sitePoint(read: GisOverlayRead): SitePoint | null {
  if (read.pin) return { lat: read.pin.lat, lng: read.pin.lng, name: 'the pin' };
  const centre = outlineOf(read)?.getCenter();
  return centre ? { lat: centre.lat, lng: centre.lng, name: 'the outline centre' } : null;
}

/**
 * Frame the site — once for each frame, unless somebody asks to go back to it.
 *
 * The same read fetched again, or a layer switched off, leaves the reader's
 * view where they put it; only a site that has moved brings the map back. A
 * box with no size yet cannot be framed (the zoom comes out as the closest
 * there is), so it is left alone and tried again once it has been measured.
 */
export function openOnSite(map: L.Map, view: SiteView, again = false): void {
  const size = map.getSize();
  if (!view.frame || !size.x || !size.y) return;
  const frame = view.frame.toBBoxString();
  if (!again && frame === view.opened) return;
  map.fitBounds(view.frame);
  view.opened = frame;
}
