import L from 'leaflet';
import type { AmenityKind, GisOverlayParcel, GisOverlayRead, NearbyAmenity } from '@realytica/shared';
import { AIRPORT, EMPLOYMENT, HOSPITAL, MARKET, SCHOOL, TRANSIT, drawn } from './icons';

/*
 * The site pin, the places near it, and the number on each parcel.
 *
 * Black and white, and the same in both themes. These are drawn on imagery,
 * and imagery does not change with the theme — which is also why Leaflet's
 * buttons and the attribution strip stay light on a dark page.
 *
 * No colour by kind. Places used to be a red, an amber, a green and a blue
 * dot, and everywhere else in the product those colours are a verdict: a red
 * hospital beside a red flagged lake said the same thing twice and meant it
 * once. The drawing says what a place is.
 */

/* Nearby places, drawn from what the site reading already fetched — no new calls. */
const PLACE_LABEL: Record<AmenityKind, string> = {
  transit: 'Transit',
  school: 'School',
  hospital: 'Hospital',
  market: 'Market',
  employment: 'Employment',
  airport: 'Airport',
};

const PLACE_GLYPH: Record<AmenityKind, string> = {
  transit: TRANSIT,
  school: SCHOOL,
  hospital: HOSPITAL,
  market: MARKET,
  employment: EMPLOYMENT,
  airport: AIRPORT,
};

function placeDistance(metres: number, driving?: number): string {
  const m = driving ?? metres;
  const text = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  return driving ? `${text} by road` : `${text} away`;
}

/**
 * Words as a node.
 *
 * Leaflet reads a string as HTML. An address comes from a geocoder and a place
 * name from whoever typed it into a map, so they are set as text and never
 * parsed.
 */
export function words(text: string, className = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

/*
 * A pin, 28 by 36, with its tip at the bottom centre. The marker is anchored
 * on that tip, so the point sits on the coordinate and the head stands above
 * it — a circle centred on the spot covered the very thing it marked.
 */
const PIN_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" class="drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)]" aria-hidden="true">' +
  '<path d="M14 35C14 35 3 22.5 3 13a11 11 0 1 1 22 0c0 9.5-11 22-11 22Z" class="fill-black stroke-white" stroke-width="2" stroke-linejoin="round"/>' +
  '<circle cx="14" cy="13" r="4" class="fill-white"/>' +
  '</svg><div class="sr-only">Site pin</div>';

/** The site, where the address resolved to. Not a parcel, and its tooltip says so. */
export function siteMarker(pin: NonNullable<GisOverlayRead['pin']>): L.Marker {
  return L.marker([pin.lat, pin.lng], {
    icon: L.divIcon({ className: '', html: PIN_MARKUP, iconSize: [28, 36], iconAnchor: [14, 35], tooltipAnchor: [14, -22] }),
    // Over every place near it: the site is the one mark on this map that must never be hidden.
    zIndexOffset: 1000,
  }).bindTooltip(words(pin.resolvedAddress ? `Pin — ${pin.resolvedAddress}` : 'Geocoded pin — not a parcel'));
}

/** A parcel's label on the map, and what is needed to tell whether it fits on the outline it names. */
export interface ParcelLabel {
  marker: L.Marker;
  /** The extent of the outline the label sits on. */
  bounds: L.LatLngBounds;
  text: string;
}

/**
 * A parcel's survey number, set on its outline.
 *
 * A site on a dozen survey numbers is a dozen outlines, and without a number
 * on each there is no telling which one a warning about Sy. 42 is about. The
 * number is whatever the state's map holds, so it is set as text. The label
 * sits at the middle of the outline's extent and takes no click: it must not
 * stand between a finger and the parcel under it.
 */
export function parcelLabel(parcel: GisOverlayParcel): ParcelLabel {
  const bounds = L.latLngBounds(parcel.ring.map((p) => [p.lat, p.lng] as L.LatLngTuple));
  const text = `Sy. ${parcel.label}`;
  // The icon is a point; the words are centred on it, whatever their width.
  const face = document.createElement('div');
  face.className = 'relative';
  face.append(
    words(text, 'absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-black/80 px-1 text-[11px] font-medium leading-4 text-white'),
  );
  const marker = L.marker(bounds.getCenter(), { icon: L.divIcon({ className: '', html: face, iconSize: [0, 0] }), interactive: false, keyboard: false });
  return { marker, bounds, text };
}

/*
 * A label is 16 px tall, and about 6 px wide for each letter with a little
 * at either end. An outline smaller than that on screen cannot carry it.
 */
const LABEL_HEIGHT_PX = 16;
const LABEL_WIDTH_PX = (text: string) => text.length * 6 + 10;

/**
 * Show each label only while its outline is big enough on screen to carry it.
 *
 * Zoomed out to a whole township, sixty labels are one black smear over
 * sixty outlines a few pixels across. A label that does not fit is put away
 * until the map is zoomed to where it does; the outline's own tooltip still
 * names it.
 */
export function showLabelsThatFit(map: L.Map, labels: readonly ParcelLabel[]): void {
  for (const label of labels) {
    const a = map.latLngToContainerPoint(label.bounds.getNorthWest());
    const b = map.latLngToContainerPoint(label.bounds.getSouthEast());
    const fits = Math.abs(b.x - a.x) >= LABEL_WIDTH_PX(label.text) && Math.abs(b.y - a.y) >= LABEL_HEIGHT_PX;
    label.marker.setOpacity(fits ? 1 : 0);
  }
}

/**
 * A place near the site: a small disc with a drawing of what it is.
 *
 * Hovering names it, as before. Clicking or tapping opens the same thing as a
 * popup, because a finger cannot hover and the name was otherwise unreachable
 * on a phone.
 *
 * Not a stop for the Tab key. There can be eighteen of them, all ahead of the
 * map's own buttons, and the map moves to each as it takes the focus — to an
 * airport thirty kilometres off among them. The place card under the map is
 * where a keyboard reads names and distances.
 */
export function placeMarker(place: NearbyAmenity): L.Marker {
  const kind = PLACE_LABEL[place.kind] ?? place.kind;
  const distance = placeDistance(place.straightLineMetres, place.drivingMetres);

  const face = document.createElement('div');
  face.className = 'grid h-6 w-6 place-items-center rounded-full bg-black text-white ring-2 ring-white';
  face.innerHTML = drawn(PLACE_GLYPH[place.kind] ?? '', 14);
  face.append(words(`${kind}: ${place.name}`, 'sr-only'));

  const card = document.createElement('div');
  card.append(words(place.name, 'text-[13px] font-semibold'), words(`${kind} · ${distance}`, 'text-[12px] opacity-70'));

  const marker = L.marker([place.point.lat, place.point.lng], {
    icon: L.divIcon({ className: '', html: face, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -14], tooltipAnchor: [14, 0] }),
    keyboard: false,
  });
  // Bound in this order on purpose: a tap opens the tooltip and then the
  // popup, and the popup opening is what puts the tooltip away again.
  marker.bindTooltip(words(`${kind}: ${place.name} · ${distance}`));
  // The padding keeps an opened popup clear of the buttons in the top corners,
  // and the width is what is left between them on a phone: wider, and the
  // popup's close button is pushed off the edge of the map.
  marker.bindPopup(card, { maxWidth: 180, autoPanPaddingTopLeft: [52, 48], autoPanPaddingBottomRight: [8, 8] });
  marker.on('popupopen', () => marker.closeTooltip());
  return marker;
}
