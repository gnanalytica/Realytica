import L from 'leaflet';
import type { AmenityKind, GisOverlayRead, NearbyAmenity } from '@realytica/shared';
import { AIRPORT, EMPLOYMENT, HOSPITAL, MARKET, SCHOOL, TRANSIT, drawn } from './icons';

/*
 * The site pin and the places near it.
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

/**
 * A place near the site: a small disc with a drawing of what it is.
 *
 * Hovering names it, as before. Clicking or tapping opens the same thing as a
 * popup, because a finger cannot hover and the name was otherwise unreachable
 * on a phone.
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
