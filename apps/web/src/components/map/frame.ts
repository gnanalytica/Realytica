import L from 'leaflet';
import { siteFrame, type GeoPoint, type GisOverlayRead } from '@realytica/shared';

/*
 * Where the map opens, and when it is allowed to move there by itself.
 *
 * The rules — outline before pin, the margin, the room round a large outline,
 * how far a street view may be looked for — are `siteFrame` in the shared
 * package, as plain numbers with tests. This file hands them to Leaflet.
 */

/** The one point that stands for the site, what to call it, and how far from it a street view may be looked for. */
export interface SitePoint extends GeoPoint {
  name: string;
  reachM: number;
}

/** The site as the map needs it: the box to open on, and the point. */
export interface Site {
  bounds: L.LatLngBounds;
  point: SitePoint;
}

/** What the map holds about the site: its frame, its point, and the frame the map last opened on. */
export interface SiteView {
  frame: L.LatLngBounds | null;
  point: SitePoint | null;
  opened: string | null;
}

/** The site in a read, or null when the read has neither an outline nor a pin to stand for it. */
export function siteOf(read: GisOverlayRead): Site | null {
  const frame = siteFrame(read);
  if (!frame) return null;
  return {
    bounds: L.latLngBounds([frame.south, frame.west], [frame.north, frame.east]),
    point: { ...frame.point, name: frame.from === 'outline' ? 'the outline centre' : 'the pin', reachM: frame.reachM },
  };
}

/*
 * A box narrower or shorter than this has not been laid out yet: a panel
 * still opening, a column being dragged out from nothing. It has a size, but
 * not its size.
 */
const SETTLED_PX = 120;

/**
 * Frame the site — once for each frame, unless somebody asks to go back to it.
 *
 * The same read fetched again, or a layer switched off, leaves the reader's
 * view where they put it; only a site that has moved brings the map back.
 *
 * A box that has not settled is left alone and tried again when it has been
 * measured. With no size at all the zoom comes out as the closest there is;
 * in a sliver it comes out several levels too far, and because the fit
 * counted as made, the map then stayed there when the box reached full size.
 * A press of the button is somebody looking at the box as it is, and is
 * honoured at any size it can be.
 */
export function openOnSite(map: L.Map, view: SiteView, again = false): void {
  const size = map.getSize();
  if (!view.frame || !size.x || !size.y) return;
  if (!again && (size.x < SETTLED_PX || size.y < SETTLED_PX)) return;
  const frame = view.frame.toBBoxString();
  if (!again && frame === view.opened) return;
  map.fitBounds(view.frame);
  view.opened = frame;
}
