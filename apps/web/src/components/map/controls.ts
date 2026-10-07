import L from 'leaflet';
import { EXTERNAL, LOCATE, MAXIMIZE, MINIMIZE, PIN, drawn } from './icons';

/*
 * The map's own buttons: back to the site, where I am, full screen, street
 * view — and a scale.
 *
 * Each button is made the way Leaflet makes its zoom buttons: a link in a
 * bar, with a role, a name and a title. Leaflet's stylesheet then draws it
 * like them and a screen reader announces it like them, with no styling of
 * our own to keep in step. Nothing here asks the browser or anybody else for
 * anything until its button is pressed.
 */

/** Who wrote the line under the map: the three things on it that have something to report. */
export type NoteFrom = 'location' | 'screen' | 'street';

export interface SiteControlEvents {
  /** Frame the site again. */
  site: () => void;
  /** Open the street view in the map's box. Only asked for while the control is a button. */
  streetView: () => void;
  /**
   * A line for under the map, or null to take down the line this writer put
   * up. Null from one writer leaves another's line where it is.
   */
  note: (from: NoteFrom, text: string | null) => void;
  /** The map's box has entered or left full screen. */
  fullscreen: (on: boolean) => void;
}

export interface SiteControls {
  /** Given an address, the street-view control is a link to it; given none, it is a button. */
  linkStreetView: (href: string | null) => void;
  focusStreetView: () => void;
  /** Stop listening to the page. The buttons themselves go when the map does. */
  detach: () => void;
}

/*
 * Leaflet sizes a bar's links as fixed squares of text. The first of these
 * centres a drawing in one; the second lets a word set its own width.
 */
const ICON_BUTTON = '!flex items-center justify-center';
const WORD_BUTTON = '!flex !w-auto items-center gap-1 whitespace-nowrap px-2 text-[12px] font-medium';

function button(map: L.Map, className: string, onPress: () => void): HTMLAnchorElement {
  const a = L.DomUtil.create('a', className);
  a.href = '#';
  a.setAttribute('role', 'button');
  L.DomEvent.disableClickPropagation(a);
  L.DomEvent.on(a, 'click', (event) => {
    L.DomEvent.stop(event);
    onPress();
    // A mouse click hands the keyboard back to the map, as the zoom buttons do. A key press keeps its place.
    if ((event as MouseEvent).detail > 0) map.getContainer().focus();
  });
  // A link answers Enter by itself; something announced as a button is
  // expected to answer Space as well. Either key held down repeats, and a
  // repeat is not another press: it asked for the location again, or flipped
  // full screen on and off, for as long as the key was down.
  L.DomEvent.on(a, 'keydown', (event) => {
    const key = event as KeyboardEvent;
    if (key.key !== ' ' && !(key.key === 'Enter' && key.repeat)) return;
    // Stopped whether or not it counts as a press: Space would otherwise scroll the page.
    L.DomEvent.stop(key);
    if (!key.repeat) onPress();
  });
  return a;
}

/** What a button is called — read out, and shown on hover — and what is drawn on it. */
function label(a: HTMLAnchorElement, name: string, face: string): void {
  a.title = name;
  a.setAttribute('aria-label', name);
  a.innerHTML = face;
}

function mount(map: L.Map, position: L.ControlPosition, container: HTMLElement): void {
  const control = new L.Control({ position });
  control.onAdd = () => container;
  control.addTo(map);
}

/**
 * Put the buttons and the scale on the map.
 *
 * `box` is what goes full screen: the element round the map, so that the line
 * under it — where these controls report — comes along.
 */
export function addSiteControls(map: L.Map, box: HTMLElement, on: SiteControlEvents): SiteControls {
  /*
   * Under the zoom buttons, as Leaflet stacks a corner — except on a phone
   * held sideways, where the map is about 200 px tall and the stack of five
   * would run to within a few pixels of Google's logo in the corner below.
   * There this bar sits beside the zoom buttons instead of under them.
   */
  const bar = L.DomUtil.create('div', 'leaflet-bar short:!clear-none');

  const site = button(map, ICON_BUTTON, on.site);
  label(site, 'Back to the site', drawn(PIN, 16));
  bar.append(site);

  /*
   * Where I am. Asked once, on the press, and never before: a page that asks
   * for a location on arrival is refused on arrival. The dot is the reading
   * and the ring round it is how far off the reading may be — black and
   * white, like the other marks on the imagery.
   */
  const me = L.layerGroup().addTo(map);
  map.on('locationfound', (found) => {
    me.clearLayers();
    L.circle(found.latlng, {
      radius: found.accuracy,
      interactive: false,
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#000000',
      fillOpacity: 0.15,
    }).addTo(me);
    L.circleMarker(found.latlng, { radius: 7, color: '#ffffff', weight: 3, fillColor: '#000000', fillOpacity: 1 })
      .bindTooltip(`Your location, within ${Math.round(found.accuracy)} m`)
      .addTo(me);
    on.note('location', null);
  });
  map.on('locationerror', (failed) => {
    // 1 is the browser's code for "the person, or their settings, said no".
    on.note('location', failed.code === 1 ? 'Location is blocked for this site.' : 'Your location is not available.');
  });
  const locate = button(map, ICON_BUTTON, () => {
    on.note('location', 'Locating…');
    map.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true });
  });
  label(locate, 'Where I am', drawn(LOCATE, 16));
  bar.append(locate);

  /*
   * Full screen. An iPhone has none for anything but video, and a frame can
   * be denied it; where the browser says it cannot, there is no button rather
   * than one that does nothing.
   */
  const full = document.fullscreenEnabled
    ? button(map, ICON_BUTTON, () => {
        const change = document.fullscreenElement === box ? document.exitFullscreen() : box.requestFullscreen();
        change.catch(() => on.note('screen', 'Full screen is not available here.'));
      })
    : null;
  const fullscreenChanged = () => {
    const isFull = document.fullscreenElement === box;
    if (full) label(full, isFull ? 'Exit full screen' : 'Full screen', drawn(isFull ? MINIMIZE : MAXIMIZE, 16));
    on.fullscreen(isFull);
  };
  if (full) {
    label(full, 'Full screen', drawn(MAXIMIZE, 16));
    bar.append(full);
    document.addEventListener('fullscreenchange', fullscreenChanged);
  }
  mount(map, 'topleft', bar);

  /* Street view: a button that opens it here, or — with no key to draw it — a link that opens it on Google Maps. */
  const streetBar = L.DomUtil.create('div', 'leaflet-bar');
  const streetButton = button(map, WORD_BUTTON, on.streetView);
  label(streetButton, 'Street view', 'Street view');
  const streetLink = L.DomUtil.create('a', WORD_BUTTON);
  streetLink.target = '_blank';
  streetLink.rel = 'noreferrer';
  L.DomEvent.disableClickPropagation(streetLink);
  label(streetLink, 'Street view in Google Maps (new tab)', `Street view${drawn(EXTERNAL, 12)}`);
  streetBar.append(streetButton);
  mount(map, 'topright', streetBar);

  // Metric, and above the attribution: the bottom-left corner is where Google's basemap puts its logo.
  // Its type is a whole pixel on every pointer; the small-type tokens add half a pixel under a finger.
  const scale = L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
  scale.getContainer()?.classList.add('text-[12px]');

  return {
    linkStreetView: (href) => {
      if (href) streetLink.href = href;
      const wanted = href ? streetLink : streetButton;
      const shown = streetBar.firstElementChild;
      // Every read comes through here, and putting the same control back took
      // the keyboard's focus off it each time. Only a different one is put in,
      // and it takes the focus the other was holding.
      if (shown === wanted) return;
      const held = document.activeElement === shown;
      streetBar.replaceChildren(wanted);
      if (held) wanted.focus();
    },
    focusStreetView: () => (streetBar.firstElementChild as HTMLElement | null)?.focus(),
    detach: () => document.removeEventListener('fullscreenchange', fullscreenChanged),
  };
}
