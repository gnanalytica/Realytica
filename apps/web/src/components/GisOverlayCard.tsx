import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Layers, MapPinned, RefreshCw, Upload } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  isHttpsUrl,
  revenueReads,
  sheetIsPlaceable,
  type DdProject,
  type GisContextFeature,
  type GisOverlayHit,
  type GisOverlayRead,
  type SheetPlacement,
} from '@realytica/shared';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Disclosure, cn } from './ui/kit';
import { api } from '../lib/api';
import { useAuthedUrl } from '../lib/useAuthedUrl';
import { googleMapsKey, googleMapsRefused, loadGoogleMaps, streetViewUrl } from '../lib/google-maps';
import { addSiteControls, type NoteFrom, type SiteControls } from './map/controls';
import { openOnSite, siteOf, type SiteView } from './map/frame';
import { parcelLabel, placeMarker, showLabelsThatFit, siteMarker, words, type ParcelLabel } from './map/markers';
import { StreetViewPane, findStreetScene, noStreetView, type StreetScene } from './map/StreetView';
import { RevenueMapPicker } from './RevenueMapPicker';
import { RevenueMapBrief } from './RevenueMapBrief';

/**
 * Pin + optional survey sketch + OSM + OpenCity civic clips.
 *
 * OSM and OpenCity lakes/wards are volunteer or civic geometry. They are not
 * the RMP hatch and not a classified drain. The card is the showcase; it
 * never files what it draws.
 */

type Basemap = 'satellite' | 'streets';
type Tiles = Record<Basemap, L.GridLayer>;

/** The line under the map, and which of the map's controls wrote it. */
interface Note {
  from: NoteFrom;
  text: string;
}

/**
 * One line, three writers: where I am, street view, full screen. The latest
 * to speak has the line. One with nothing more to say takes down its own and
 * leaves another's alone — a location arriving used to wipe a "no street
 * view" that had been written in the meantime.
 */
function noted(now: Note | null, from: NoteFrom, text: string | null): Note | null {
  if (text) return { from, text };
  return now?.from === from ? null : now;
}

const WATER_STYLE: L.PathOptions = { color: '#1d4ed8', weight: 2, fillColor: '#3b82c4', fillOpacity: 0.38 };
const WATER_FLAG_STYLE: L.PathOptions = { color: '#b91c1c', weight: 3, fillColor: '#ef4444', fillOpacity: 0.28 };
const WATERWAY_STYLE: L.PathOptions = { color: '#1d4ed8', weight: 2.5, opacity: 0.9 };
const LANDUSE_STYLE: L.PathOptions = { color: '#a16207', weight: 1, dashArray: '4 3', fillColor: '#fbbf24', fillOpacity: 0.18 };
const SURVEY_STYLE: L.PathOptions = { color: '#c2410c', weight: 2.5, fillColor: '#fb923c', fillOpacity: 0.12 };
/*
 * A parcel off the state's map is drawn as the outline always was. Beside an
 * outline a person supplied it is broken instead, so the two can be told
 * apart where they lie on the same land: the solid line is the surveyor's.
 */
const PARCEL_BESIDE_OUTLINE_STYLE: L.PathOptions = { ...SURVEY_STYLE, weight: 2, dashArray: '6 4', fillOpacity: 0.06 };

function latlngs(points: { lat: number; lng: number }[]): L.LatLngExpression[] {
  const closed =
    points.length > 1 &&
    points[0].lat === points[points.length - 1].lat &&
    points[0].lng === points[points.length - 1].lng;
  const ring = closed ? points.slice(0, -1) : points;
  return ring.map((p) => [p.lat, p.lng]);
}

function flaggedIds(hits: GisOverlayHit[]): Set<string> {
  return new Set(hits.filter((h) => h.severity === 'flag' && h.featureId).map((h) => h.featureId as string));
}

const WARD_STYLE: L.PathOptions = { color: '#6d28d9', weight: 2, dashArray: '5 4', fillColor: '#c4b5fd', fillOpacity: 0.12 };
const CIVIC_LAKE_STYLE: L.PathOptions = { color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 0.28 };

/*
 * The state's own layers, read for the survey number on file. Drawn heavier
 * than OSM because they are a government record, and hatched rather than
 * filled so they never read as the parcel.
 */
const REVENUE_STYLE: Record<string, L.PathOptions> = {
  state_water: { color: '#0369a1', weight: 2.5, fillColor: '#0ea5e9', fillOpacity: 0.3 },
  state_drain: { color: '#0369a1', weight: 3, dashArray: '6 4', opacity: 0.95 },
  state_flood: { color: '#7c2d12', weight: 1.5, dashArray: '3 3', fillColor: '#fb923c', fillOpacity: 0.16 },
  state_alignment: { color: '#9f1239', weight: 3, dashArray: '8 4', opacity: 0.95 },
  state_landuse: { color: '#6b21a8', weight: 1.5, dashArray: '4 3', fillColor: '#a855f7', fillOpacity: 0.14 },
  state_transport: { color: '#166534', weight: 2, fillColor: '#22c55e', fillOpacity: 0.9 },
  state_prohibited: { color: '#b91c1c', weight: 2.5, fillColor: '#ef4444', fillOpacity: 0.2 },
};

const REVENUE_KINDS = new Set(Object.keys(REVENUE_STYLE));

/** Hit codes the brief under the map already says, as points. */
const BRIEF_COVERS = new Set<GisOverlayHit['code']>([
  'revenue_parcel',
  'revenue_documents_extent',
  'revenue_prohibited',
  'revenue_register_unjoined',
  'revenue_factor',
  'revenue_insight',
  'revenue_anchor',
  'revenue_unread',
]);

function isRevenue(feature: GisContextFeature): boolean {
  return REVENUE_KINDS.has(feature.kind);
}

/**
 * The outline on file that is drawn as itself: a person's, or — from an
 * overlay that lists no parcels — the one the revenue map supplied. Where the
 * parcels are listed, an outline the revenue map supplied is one of them.
 */
function ownOutline(read: GisOverlayRead): GisOverlayRead['survey'] {
  if (!read.survey?.ring.length) return null;
  return read.survey.source === 'revenue_map' && read.parcels?.length ? null : read.survey;
}

function addFeature(group: L.LayerGroup, feature: GisContextFeature, flagged: boolean): void {
  // A feature's name is whatever a mapper or a state layer holds, and Leaflet
  // reads a string as HTML: every tooltip here is set as text.
  if (isRevenue(feature)) {
    const style = REVENUE_STYLE[feature.kind];
    // With several parcels read, the distance is from the nearest of them, and says which.
    const label = `${feature.name ?? feature.kind.replace('state_', '').replace(/_/g, ' ')} — ${feature.layerKey ?? 'state layer'}${
      feature.distanceM !== undefined ? `, ${Math.round(feature.distanceM)} m${feature.nearestSurveyNo ? ` from Sy. ${feature.nearestSurveyNo}` : ''}` : ''
    } (revenue map, not evidence)`;
    if (feature.ring) L.polygon(latlngs(feature.ring), style).bindTooltip(words(label)).addTo(group);
    else if (feature.line) L.polyline(feature.line.map((p) => [p.lat, p.lng] as L.LatLngExpression), style).bindTooltip(words(label)).addTo(group);
    else if (feature.point) L.circleMarker([feature.point.lat, feature.point.lng], { ...style, radius: 6 }).bindTooltip(words(label)).addTo(group);
    return;
  }
  const water = feature.kind === 'osm_water' || feature.kind === 'osm_waterway';
  const style =
    feature.kind === 'civic_ward'
      ? WARD_STYLE
      : feature.kind === 'civic_lake'
        ? CIVIC_LAKE_STYLE
        : water
          ? flagged
            ? feature.ring
              ? WATER_FLAG_STYLE
              : WATERWAY_STYLE
            : feature.ring
              ? WATER_STYLE
              : WATERWAY_STYLE
          : LANDUSE_STYLE;
  const tooltip = [
    feature.kind === 'osm_landuse'
      ? 'OSM landuse (not RMP)'
      : feature.kind === 'civic_ward'
        ? 'GBA ward (OpenCity, civic — not RMP)'
        : feature.kind === 'civic_lake'
          ? 'BBMP lake (OpenCity — CONTEXT, not drain class)'
          : 'OSM water (CONTEXT, not drain class)',
    feature.name,
  ]
    .filter(Boolean)
    .join(' — ');
  if (feature.ring) {
    L.polygon(latlngs(feature.ring), style).bindTooltip(words(tooltip)).addTo(group);
  } else if (feature.line) {
    L.polyline(latlngs(feature.line), water ? WATERWAY_STYLE : LANDUSE_STYLE)
      .bindTooltip(words(tooltip))
      .addTo(group);
  }
}

export function GisOverlayCard({
  project,
  onChanged,
}: {
  project: DdProject;
  onChanged: () => Promise<void>;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  /* The box round the map: what goes full screen, with the line that reports on the map's controls inside it. */
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const controlsRef = useRef<SiteControls | null>(null);
  const siteView = useRef<SiteView>({ frame: null, point: null, opened: null });
  const layersRef = useRef<{
    water?: L.LayerGroup;
    landuse?: L.LayerGroup;
    survey?: L.LayerGroup;
    parcels?: L.LayerGroup;
    pin?: L.Layer;
    lakes?: L.LayerGroup;
    wards?: L.LayerGroup;
    revenue?: L.LayerGroup;
    places?: L.LayerGroup;
  }>({});
  /* The survey number on each parcel, kept so that each can be shown or put away as the zoom changes. */
  const labelsRef = useRef<ParcelLabel[]>([]);
  /* The map's own imagery, Google's once its script has loaded, and which of Google's layers have drawn at least once. */
  const tilesRef = useRef<{ own?: Tiles; google?: Tiles; drawn?: Set<L.GridLayer> }>({});
  const [googleTiles, setGoogleTiles] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  /* One line under the map, for what its controls have to report: looking, not found, refused. */
  const [note, setNote] = useState<Note | null>(null);
  const [scene, setScene] = useState<StreetScene | null>(null);
  /* Street-view lookups, counted, so that an answer to one that has been overtaken is dropped. */
  const lookups = useRef(0);
  /* Set by "Back to map", and by nothing else that closes the street view. */
  const handBack = useRef(false);
  const wmsRef = useRef<L.TileLayer.WMS | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [read, setRead] = useState<GisOverlayRead | null>(null);
  /* The site in this read: the box the map opens on, and the point that stands for it. */
  const site = useMemo(() => (read ? siteOf(read) : null), [read]);
  /**
   * Whether there is a site to draw a map of. It is the rule that frames the
   * map, asked again, so the two cannot disagree: an outline on file with an
   * empty ring and no pin used to count as something to draw, and gave a map
   * of the world with a street-view button that did nothing. Declared here
   * because the map effect reads it.
   */
  const canMap = site !== null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('satellite');
  const [showWater, setShowWater] = useState(true);
  const [showLanduse, setShowLanduse] = useState(true);
  const [showSurvey, setShowSurvey] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  const [showBbmp, setShowBbmp] = useState(true);
  const [showLakes, setShowLakes] = useState(true);
  const [showWards, setShowWards] = useState(true);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [sheets, setSheets] = useState<SheetPlacement[]>([]);
  const [showSheet, setShowSheet] = useState(true);
  const [sheetOpacity, setSheetOpacity] = useState(0.6);
  const sheetRef = useRef<L.ImageOverlay | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      setRead(await api.gisOverlay(project.id, { force }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The overlay could not be built.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Overlay is fetched by project id; survey changes go through onChanged + remount key.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on project identity, not every parent render
  }, [project.id, project.surveyBoundary?.suppliedAt, project.siteContext?.builtAt]);

  /*
   * Another project in the same card: Back and Forward move between two
   * projects without the page being made again. What the map was showing for
   * the one before goes with it — its street view, the line under the map,
   * and the answer to a lookup that is still on its way.
   */
  useEffect(() => {
    lookups.current += 1;
    setScene(null);
    setNote(null);
  }, [project.id]);

  useEffect(() => {
    const el = mapEl.current;
    const box = boxRef.current;
    if (!el || !box) return undefined;
    const map = L.map(el, { scrollWheelZoom: true, attributionControl: true, zoomControl: true });
    mapRef.current = map;
    const view = siteView.current;
    // Made here, put on the map by the basemap effect below. Their tiles stop
    // at 19 and are stretched from there to 21, which is as far as Google's
    // go: see that effect for why the two must allow the same zoom.
    tilesRef.current = {
      own: {
        satellite: L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Tiles © Esri', maxNativeZoom: 19, maxZoom: 21 },
        ),
        streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxNativeZoom: 19,
          maxZoom: 21,
        }),
      },
    };
    map.setView([20, 0], 2);

    /*
     * The map measures its box when it is made, and the box changes after:
     * the conversation is dragged wider, a phone's work tab is shown. An
     * unmeasured map paints grey or blank until somebody zooms. It measures
     * again whenever the box does — and frames the site then, if it was made
     * before it had a size to frame it in.
     */
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      openOnSite(map, view);
    });
    ro.observe(el);
    // A parcel's number is shown only while its outline is big enough on screen to carry it.
    map.on('zoomend', () => showLabelsThatFit(map, labelsRef.current));

    /*
     * The buttons on the map. The street view is looked for when it is asked
     * for and not before; a second press, another project, or the map going
     * away drops the answer to the first.
     */
    const say = (from: NoteFrom, text: string | null) => setNote((now) => noted(now, from, text));
    const controls = addSiteControls(map, box, {
      site: () => openOnSite(map, view, true),
      note: say,
      fullscreen: setFullscreen,
      streetView: () => {
        const at = view.point;
        if (!at) return;
        lookups.current += 1;
        const mine = lookups.current;
        say('street', 'Looking for street view…');
        void findStreetScene(at)
          .then((found) => {
            if (mine !== lookups.current) return;
            setScene(found);
            say('street', found ? null : noStreetView(at));
          })
          .catch(() => {
            if (mine === lookups.current) say('street', 'Street view did not load.');
          });
      },
    });
    controlsRef.current = controls;

    /*
     * Google's map, when a browser key is set: satellite with its road and
     * place labels, and its street map with the places it marks. Only the
     * imagery underneath changes — every layer above is drawn the same. If
     * Google turns the key away, the imagery goes back to what it was, and a
     * street view that was open closes with it.
     */
    let cancelled = false;
    const backToOwn = () => {
      if (mapRef.current !== map) return;
      const { own, google } = tilesRef.current;
      // The refusal can come before Google's layers are made. There is then
      // nothing to take off the map, and below they are never made.
      for (const layer of google ? Object.values(google) : []) if (map.hasLayer(layer)) map.removeLayer(layer);
      tilesRef.current = { own };
      setGoogleTiles(false);
      setScene(null);
    };
    if (googleMapsKey()) {
      void loadGoogleMaps(backToOwn)
        .then(() => import('leaflet.gridlayer.googlemutant'))
        .then(({ default: GoogleMutant }) => {
          if (cancelled || mapRef.current !== map || googleMapsRefused()) return;
          tilesRef.current.google = {
            satellite: new GoogleMutant({ type: 'hybrid', maxZoom: 21 }),
            streets: new GoogleMutant({ type: 'roadmap', maxZoom: 21 }),
          };
          setGoogleTiles(true);
        })
        .catch(() => {
          /* the map keeps its own imagery */
        });
    }
    return () => {
      cancelled = true;
      lookups.current += 1;
      ro.disconnect();
      controls.detach();
      map.remove();
      mapRef.current = null;
      controlsRef.current = null;
      layersRef.current = {};
      labelsRef.current = [];
      tilesRef.current = {};
      view.opened = null;
      setGoogleTiles(false);
      setFullscreen(false);
      setNote(null);
      setScene(null);
    };
    // Re-runs when the canvas appears, because a project with no pin and no
    // survey does not render one — see the map block below.
  }, [canMap]);

  /*
   * One basemap at a time, with the map's own imagery left under Google's
   * until Google's has drawn.
   *
   * Google's layer exists the moment it is made and draws some time after:
   * it starts a hidden map of its own and copies that map's tiles across as
   * they arrive, which on the deployed app took seconds. Taking the map's
   * imagery away when the layer was made left a black box with the overlay
   * shapes floating on it, which read as a broken map. So the two overlap.
   * Google's goes on top, and what is under it is removed once every tile in
   * view has arrived. If Google never draws, the map's own imagery is simply
   * still there. A Google layer that has drawn once has its tiles to hand, so
   * the map's own is not fetched under it a second time.
   *
   * What comes on is added before what goes off is taken away, and Google's
   * before the map's own. Leaflet lowers the zoom the moment the layers left
   * on the map allow less than the view shows, and taking the old pair off
   * first dropped a view at zoom 20 to 19 on every switch of basemap. For the
   * same reason the map's own layers allow as much zoom as Google's do.
   */
  useEffect(() => {
    const map = mapRef.current;
    const tiles = tilesRef.current;
    const { own, google } = tiles;
    if (!map || !own) return undefined;
    const other: Basemap = basemap === 'satellite' ? 'streets' : 'satellite';
    const mine = own[basemap];
    const theirs = google?.[basemap];
    const drewBefore = Boolean(theirs && tiles.drawn?.has(theirs));
    if (theirs && !map.hasLayer(theirs)) theirs.addTo(map);
    if (!drewBefore && !map.hasLayer(mine)) mine.addTo(map);
    for (const layer of [own[other], google?.[other], drewBefore ? mine : undefined]) {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    }
    // The imagery sits under everything drawn on it, and the map's own under Google's.
    theirs?.bringToBack();
    if (map.hasLayer(mine)) mine.bringToBack();
    if (!theirs || drewBefore) return undefined;
    let faded: number | undefined;
    const drawn = () => {
      (tiles.drawn ??= new Set()).add(theirs);
      // A tile fades in over a fifth of a second; what is under it goes once the last has.
      faded = window.setTimeout(() => map.removeLayer(mine), 250);
    };
    theirs.once('load', drawn);
    return () => {
      theirs.off('load', drawn);
      window.clearTimeout(faded);
    };
    // `canMap` because the map, and with it these layers, is made anew when the canvas appears.
  }, [basemap, googleTiles, canMap]);

  /* Going full screen and coming back changes the box; the map is told, so that it fills the new one. */
  useEffect(() => {
    mapRef.current?.invalidateSize();
  }, [fullscreen]);

  /*
   * The site, as the map holds it: the frame it opens on and the point its
   * street view looks from, which are the same place by construction — see
   * `siteFrame` in the shared package. Nothing drawn on the map widens the
   * frame, and the map moves to it only when it has changed.
   *
   * The street view is drawn here while Google's map is in use. Without a
   * key, or with one Google has turned away, the control is a link that opens
   * Google Maps' own street view at the same point instead.
   */
  useEffect(() => {
    const view = siteView.current;
    view.frame = site?.bounds ?? null;
    view.point = site?.point ?? null;
    controlsRef.current?.linkStreetView(googleTiles || !site ? null : streetViewUrl(site.point));
    if (mapRef.current) openOnSite(mapRef.current, view);
  }, [site, googleTiles]);

  /*
   * "Back to map" hands the keyboard back to the control that opened the
   * street view, once the map is on screen again to take it. A street view
   * closed by anything else — another project, Google turning the key away —
   * moves no focus: nobody asked to be taken to the map.
   */
  useEffect(() => {
    if (scene || !handBack.current) return;
    handBack.current = false;
    controlsRef.current?.focusStreetView();
  }, [scene]);

  /* Nearby places from the site reading, each with what it is and how far. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const old = layersRef.current.places;
    if (old) map.removeLayer(old);
    layersRef.current.places = undefined;
    const amenities = (project.siteContext?.amenities ?? []).filter((a) => a.point);
    if (!amenities.length) return;
    const group = L.layerGroup();
    for (const a of amenities) placeMarker(a).addTo(group);
    layersRef.current.places = group;
    if (showPlaces) group.addTo(map);
    // Rebuilt when the reading changes or the canvas is made; shown or hidden below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.siteContext?.builtAt, canMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !read) return;

    for (const key of ['water', 'landuse', 'survey', 'parcels', 'pin', 'lakes', 'wards', 'revenue'] as const) {
      const layer = layersRef.current[key];
      if (layer) {
        map.removeLayer(layer);
        layersRef.current[key] = undefined;
      }
    }

    const flagged = flaggedIds(read.hits);
    const water = L.layerGroup();
    const landuse = L.layerGroup();
    const lakes = L.layerGroup();
    const wards = L.layerGroup();
    const survey = L.layerGroup();
    const parcels = L.layerGroup();
    const revenue = L.layerGroup();

    for (const feature of read.features) {
      const group = isRevenue(feature)
        ? revenue
        : feature.kind === 'osm_landuse'
          ? landuse
          : feature.kind === 'civic_lake'
            ? lakes
            : feature.kind === 'civic_ward'
              ? wards
              : water;
      addFeature(group, feature, flagged.has(feature.id));
    }

    /*
     * Every parcel read from the state's map, each with its survey number on
     * it. The outline on file is drawn too when it is a person's; when the
     * revenue map supplied it, it is the first of the parcels and is not
     * drawn a second time under them.
     */
    const own = ownOutline(read);
    if (own) {
      L.polygon(latlngs(own.ring), SURVEY_STYLE)
        .bindTooltip('Supplied survey outline — not product-drawn, not RMP')
        .addTo(survey);
    }
    const labels: ParcelLabel[] = [];
    for (const parcel of read.parcels ?? []) {
      // An overlay built before parcels were told apart by village carries the number alone.
      const named = { ...parcel, label: parcel.label ?? parcel.surveyNo };
      L.polygon(latlngs(parcel.ring), own ? PARCEL_BESIDE_OUTLINE_STYLE : SURVEY_STYLE)
        .bindTooltip(words(`Sy. ${named.label} — ${Math.round(parcel.areaSqm).toLocaleString()} sqm on the state’s map (a record, not a survey)`))
        .addTo(parcels);
      const label = parcelLabel(named);
      label.marker.addTo(parcels);
      labels.push(label);
    }
    labelsRef.current = labels;
    showLabelsThatFit(map, labels);

    const pinLayer = read.pin ? siteMarker(read.pin).addTo(map) : undefined;

    // Nearby places are drawn from the project, not the overlay; they stay as they are.
    layersRef.current = { places: layersRef.current.places, water, landuse, lakes, wards, survey, parcels, revenue, pin: pinLayer };
  }, [read]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = (layer: L.Layer | undefined, on: boolean) => {
      if (!layer) return;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    };
    sync(layersRef.current.water, showWater);
    sync(layersRef.current.landuse, showLanduse);
    sync(layersRef.current.lakes, showLakes);
    sync(layersRef.current.wards, showWards);
    sync(layersRef.current.survey, showSurvey);
    sync(layersRef.current.parcels, showParcels);
    sync(layersRef.current.revenue, showRevenue);
    sync(layersRef.current.places, showPlaces);
  }, [read, showWater, showLanduse, showLakes, showWards, showSurvey, showParcels, showRevenue, showPlaces]);

  useEffect(() => {
    let live = true;
    void api
      .listSheets(project.id)
      .then((r) => {
        if (live) setSheets(r.sheets);
      })
      .catch(() => {
        // A map that loses its sheet list is still a map. The Site record page
        // is where a placement problem is diagnosed and reported.
      });
    return () => {
      live = false;
    };
  }, [project.id, project.updatedAt]);

  /*
   * The best-placed sheet, not the first one added.
   *
   * Ranked by how much is known about the placement: a verified fit beats one
   * we know is loose, and both beat one nothing has checked. Picking by
   * insertion order meant a sheet somebody placed carefully sat behind an
   * older rough one, on a layer whose whole value is being trustworthy.
   *
   * The toggle, the slider and the caveat all read this same value, so they
   * can never describe a different sheet from the one drawn.
   */
  const placedSheet = useMemo(() => {
    const rank: Record<string, number> = { good: 0, loose: 1, unchecked: 2 };
    return sheets
      .filter((s) => sheetIsPlaceable(s.reading) && s.reading.fit && s.sheet.attachmentId)
      .sort((a, b) => (rank[a.reading.verdict] ?? 9) - (rank[b.reading.verdict] ?? 9))[0];
  }, [sheets]);
  const { url: sheetImage } = useAuthedUrl(
    placedSheet && showSheet
      ? `/api/projects/${project.id}/evidence/${placedSheet.sheet.evidenceId}/files/${placedSheet.sheet.attachmentId}?inline=1`
      : undefined,
  );

  /*
   * The placed sheet, drawn under the vector layers.
   *
   * `L.imageOverlay` takes a bounding box, which is exactly the north-up model
   * `fitSheet` produces — and exactly why a rotated sheet is refused rather
   * than drawn: there is no box that holds it correctly, and a plan boundary a
   * few hundred metres out is a thing somebody would act on.
   *
   * One sheet at a time, the first placeable one. Two rasters stacked at 60%
   * are unreadable and neither can be trusted; choosing between them is the
   * Site record page's job, not a slider's.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (sheetRef.current) {
      map.removeLayer(sheetRef.current);
      sheetRef.current = null;
    }
    if (!placedSheet || !showSheet || !sheetImage) return undefined;
    const { north, south, east, west } = placedSheet.reading.fit!.bounds;
    const layer = L.imageOverlay(
      sheetImage,
      [
        [south, west],
        [north, east],
      ],
      { opacity: sheetOpacity, interactive: false },
    );
    layer.addTo(map);
    layer.bringToBack();
    sheetRef.current = layer;
    return () => {
      map.removeLayer(layer);
      if (sheetRef.current === layer) sheetRef.current = null;
    };
  }, [placedSheet, showSheet, sheetOpacity, sheetImage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (wmsRef.current) {
      map.removeLayer(wmsRef.current);
      wmsRef.current = null;
    }
    const src = read?.maps.liveOverlays[0];
    if (!src?.wms || !showBbmp) return undefined;
    const layer = L.tileLayer.wms(src.wms.url, {
      layers: src.wms.layers,
      format: 'image/png',
      transparent: true,
      attribution: src.wms.attribution,
      version: '1.3.0',
    });
    layer.addTo(map);
    wmsRef.current = layer;
    return () => {
      map.removeLayer(layer);
      if (wmsRef.current === layer) wmsRef.current = null;
    };
  }, [read, showBbmp]);

  /*
    The revenue map's own findings are not read as hits. They arrive as
    sentences — headline, rule, source — and eight in a row under the map read
    as an essay. `RevenueMapBrief` lays the same read out as points under
    headings. Only the two hits that compare the read against the rest of the
    file stay here: a parcel far from the pin, and an outline that disagrees
    with the register — both are about this file, not about the land.
  */
  const flags = useMemo(() => (read?.hits ?? []).filter((h) => h.severity === 'flag' && !BRIEF_COVERS.has(h.code)), [read]);
  const notes = useMemo(
    () =>
      (read?.hits ?? []).filter(
        (h) =>
          h.severity === 'info' &&
          !BRIEF_COVERS.has(h.code) &&
          h.code !== 'map_sitting' &&
          h.code !== 'withdrawn_sheet' &&
          // Unconditional: these two fire on every project and describe the
          // card rather than this pin. They are in the header tooltip.
          h.code !== 'not_rmp' &&
          h.code !== 'not_drain_class',
      ),
    [read],
  );
  const liveBbmp = Boolean(read?.maps.liveOverlays.some((s) => s.key === 'bbmp_gis'));
  const lakeCount = read?.features.filter((f) => f.kind === 'civic_lake').length ?? 0;
  const wardCount = read?.features.filter((f) => f.kind === 'civic_ward').length ?? 0;
  const revenueCount = read?.features.filter(isRevenue).length ?? 0;
  const parcelCount = read?.parcels?.length ?? 0;
  const supplied = read ? ownOutline(read) : null;
  const placeCount = (project.siteContext?.amenities ?? []).filter((a) => a.point).length;
  // The reference shelf — where to get the real sheet, and what must never be
  // filed as one. It belongs on the file, but it is reading for the land-use
  // sitting, not for the dashboard, so it folds away until asked for.
  const shelf =
    (read?.maps.sittings.length ?? 0) + (read?.withdrawnSheets.length ?? 0) + (read?.maps.refused.length ?? 0);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await api.setSurveyBoundary(project.id, { fileText: await file.text(), note: file.name });
      await onChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read as a parcel outline.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader
        title="GIS overlay"
        info="OpenStreetMap water and landuse and OpenCity GBA wards / BBMP lakes are context around the geocoded pin. This does not georeference RMP sheets: the land-use hatch still has to be read from the sheet or a certified extract, and a blue OSM polygon is not a classified lake or rajakaluve. A mouse-drawn shape is not a survey."
        icon={<MapPinned size={16} />}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={inputRef}
              type="file"
              accept=".kml,.json,.geojson,application/json,application/vnd.google-earth.kml+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button variant="secondary" size="sm" icon={<Upload size={13} />} loading={busy} onClick={() => inputRef.current?.click()}>
              {read?.survey ? 'Replace survey sketch' : 'Upload survey GeoJSON/KML'}
            </Button>
            <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} loading={loading} onClick={() => void load(true)}>
              Refresh overlay
            </Button>
          </div>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {error ? (
          <Callout tone="warning" title="Overlay did not finish">
            {error}
          </Callout>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[12px] text-ink-secondary">
          <Layers size={13} className="mr-1 text-ink-muted" />
          <Basemaps value={basemap} onChange={setBasemap} />
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
          <LayerToggle on={showWater} onClick={() => setShowWater((v) => !v)}>OSM water
          </LayerToggle>
          <LayerToggle on={showLanduse} onClick={() => setShowLanduse((v) => !v)}>OSM landuse
          </LayerToggle>
          {lakeCount > 0 ? (
            <LayerToggle on={showLakes} onClick={() => setShowLakes((v) => !v)}>OpenCity lakes {lakeCount}
            </LayerToggle>
          ) : null}
          {wardCount > 0 ? (
            <LayerToggle on={showWards} onClick={() => setShowWards((v) => !v)}>GBA wards {wardCount}
            </LayerToggle>
          ) : null}
          {/* One switch for each outline there is to draw. With neither, the sketch's own, off, saying what would put one there. */}
          {supplied || !parcelCount ? (
            <LayerToggle
              on={showSurvey}
              onClick={() => setShowSurvey((v) => !v)}
              disabled={!supplied}
              disabledReason="No survey sketch on file — upload a GeoJSON or KML and it draws here."
            >
              {supplied?.source === 'revenue_map' ? 'Revenue-map parcel' : 'Survey sketch'}
            </LayerToggle>
          ) : null}
          {parcelCount > 0 ? (
            <LayerToggle on={showParcels} onClick={() => setShowParcels((v) => !v)}>
              {parcelCount === 1 ? 'Revenue-map parcel' : `Revenue-map parcels ${parcelCount}`}
            </LayerToggle>
          ) : null}
          {revenueCount > 0 ? (
            <LayerToggle on={showRevenue} onClick={() => setShowRevenue((v) => !v)}>State layers {revenueCount}
            </LayerToggle>
          ) : null}
          {placeCount > 0 ? (
            <LayerToggle on={showPlaces} onClick={() => setShowPlaces((v) => !v)}>Nearby places {placeCount}
            </LayerToggle>
          ) : null}
          {liveBbmp ? (
            <LayerToggle on={showBbmp} onClick={() => setShowBbmp((v) => !v)}>BBMP WMS lakes/parks
            </LayerToggle>
          ) : null}
          {placedSheet ? (
            <>
              <LayerToggle on={showSheet} onClick={() => setShowSheet((v) => !v)}>{placedSheet.sheet.title}
              </LayerToggle>
              {showSheet ? (
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={sheetOpacity}
                  onChange={(e) => setSheetOpacity(Number(e.target.value))}
                  aria-label="Sheet opacity"
                  className="h-6 w-24 accent-[var(--brand)]"
                />
              ) : null}
            </>
          ) : null}
        </div>

        {/*
          What the layers found, as a caption rather than as two more pills.

          Both of these sat inside the control row, so a count and an error
          wore the same shape as the eight things you can click — and the
          Overpass error wore it a second time, since the sentence beneath the
          map already says it did not load and what that leaves unknown. A row
          of controls should contain controls.
        */}
        {read ? (
          <p className="text-[12px] text-ink-muted">
            <span className="tabular-nums">{read.osm.featureCount}</span> OSM ·{' '}
            <span className="tabular-nums">{lakeCount}</span> lakes ·{' '}
            <span className="tabular-nums">{wardCount}</span> wards · context only, never an extent
            {read.revenue ? (
              <>
                {' '}· <span className="tabular-nums">{read.revenue.featureCount}</span> from the revenue map · a record, not evidence
              </>
            ) : null}
          </p>
        ) : null}

        {/* A picker of its own for each project: the place, the ticks and a run under way belong to one file. */}
        <RevenueMapPicker
          key={project.id}
          project={project}
          onRead={async () => {
            await onChanged();
            await load();
          }}
        />

        {placedSheet && showSheet ? (
          /* A raster somebody will read a boundary off, so how well it is
             placed travels with it. `unchecked` especially: two control points
             fit exactly by construction, and a viewer who does not know that
             will read a perfect fit as a verified one. */
          <p
            className={cn(
              'text-[12px]',
              placedSheet.reading.verdict === 'good' ? 'text-ink-muted' : 'text-[var(--status-warning-text)]',
            )}
          >
            {placedSheet.sheet.title}: {placedSheet.reading.say}
          </p>
        ) : null}

        {/*
          A map of nothing is four hundred pixels of black with zoom controls
          on it, and until now that was the first thing a new project showed.
          The canvas only exists once there is a pin or a survey to put on it.
        */}
        {canMap ? (
          /*
            The box is what goes full screen, and the line under the map is
            inside it for that reason: "no street view here" or a refused
            location has to be readable from the screen the button was pressed
            on. The line is always there, empty, so that a screen reader is
            already listening when something is written into it.
          */
          <div ref={boxRef} className={cn(fullscreen && 'flex flex-col bg-surface p-2')}>
            <div
              className={cn(
                'relative overflow-hidden rounded-lg ring-1 ring-inset ring-[var(--ring)]',
                fullscreen ? 'min-h-0 flex-1' : 'h-[min(420px,55vh)]',
              )}
            >
              {/*
                Everything that changes is on the elements round the map, never
                on the map's own. Leaflet writes its classes onto that node by
                hand, and React, handed a different class string for it, writes
                the whole attribute again: the map loses its container styles
                and its tiles collapse. So its class string is one fixed
                literal, the height comes from the element above, and the one
                round it is what hides it under the street view — hidden, not
                removed, so the map keeps its place and its buttons leave the
                tab order.
              */}
              <div className={cn('h-full', scene && 'invisible')}>
                <div ref={mapEl} className="gis-map z-0 h-full w-full" />
              </div>
              {scene ? (
                <StreetViewPane
                  scene={scene}
                  onBack={() => {
                    handBack.current = true;
                    setScene(null);
                  }}
                />
              ) : null}
            </div>
            <p role="status" className={cn('text-[12px] text-ink-muted', note && 'mt-2')}>
              {note?.text}
            </p>
          </div>
        ) : loading ? (
          <div className="min-h-[120px] rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]" />
        ) : (
          <p className="rounded-lg bg-sunken px-3 py-2.5 text-[13px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
            Geocode the address, or upload a GeoJSON/KML.
          </p>
        )}

        {loading && !read ? <p className="text-[13px] text-ink-muted">Building the overlay…</p> : null}

        {revenueReads(project).length ? <RevenueMapBrief project={project} /> : null}

        {flags.length ? (
          <ul className="space-y-1.5">
            {flags.map((h, i) => (
              <li key={`${h.code}-${i}`} className="text-[13px] leading-relaxed text-ink">
                <Badge tone="warning" className="mr-2 align-middle">
                  {h.standing}
                </Badge>
                {h.text}
              </li>
            ))}
          </ul>
        ) : null}

        {notes.length ? (
          <div className="space-y-1">
            {notes.map((h, i) => (
              <p key={`${h.code}-${i}`} className="text-[12px] leading-relaxed text-ink-secondary">
                {h.text}
              </p>
            ))}
          </div>
        ) : null}

        {read?.planning.inForce ? (
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Plan in force: {read.planning.inForce.title}. Master plan extract{' '}
            {read.planning.thisFile.hasMasterPlanExtract ? 'held' : 'not held'} on this file. Zoning certificate{' '}
            {read.planning.thisFile.hasZoningCertificate ? 'held' : 'not held'}.
          </p>
        ) : null}

        {shelf > 0 ? (
          <Disclosure title="Official maps and what not to file" count={shelf}>
            <div className="space-y-3">
        {read ? (
          liveBbmp ? (
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Live BBMP WMS lakes/parks is on because this pin is inside the BBMP viewer box. Civic inventory, not RMP
              zoning. Harohalli and other BMRDA sites will not get this layer.
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-muted">
              No BBMP WMS here — this pin is outside the BBMP viewer box. OpenCity lakes/wards still clip if they reach
              this pin. For Harohalli, BMRDA maps remain the planning sitting.
            </p>
          )
        ) : null}
        {read?.dpplansHint ? <p className="text-[12px] leading-relaxed text-ink-muted">{read.dpplansHint}</p> : null}
        {read?.maps.sittings.length ? (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-ink-muted">
              Official maps for this file ({read.maps.realm})
            </p>
            <ul className="space-y-1.5">
              {read.maps.sittings.map((s) => (
                <li key={s.key} className="text-[13px] leading-relaxed text-ink-secondary">
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                    {s.label}
                  </a>
                  <span className="text-ink-muted"> — {s.shows}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {read?.withdrawnSheets.length ? (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-ink-muted">
              Withdrawn RMP-2031 sheets that mention this locality (not in force)
            </p>
            <ul className="space-y-1">
              {read.withdrawnSheets.map((s) => (
                <li key={s.url} className="text-[13px] leading-relaxed text-ink-secondary">
                  {/* The address is out of OpenCity's catalogue. It is a link only when it is https; anything else is named and not linked. */}
                  {isHttpsUrl(s.url) ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">
                      {s.name}
                    </a>
                  ) : (
                    <span className="text-ink">{s.name}</span>
                  )}
                  <span className="text-ink-muted"> — withdrawn, do not file as the extract</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {read?.maps.refused.length ? (
          <Callout tone="neutral" title="Not used as overlay">
            {read.maps.refused.map((s) => (
              <p key={s.key} className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                <a href={s.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">
                  {s.label}
                </a>
                : {s.caveat}
              </p>
            ))}
          </Callout>
        ) : null}
            </div>
          </Disclosure>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * A layer that is on or off.
 *
 * Two problems with the pill it replaces. Its state was carried by fill colour
 * alone, so on and off were one perceptual step apart for a reader who does not
 * separate blue from grey — and there was no `aria-pressed`, so a screen reader
 * was told nothing at all. And it was the same shape as the basemap buttons
 * beside it, which are a choice between two, not eight independent switches:
 * one row of identical pills, two different behaviours, no way to tell which
 * was which until you clicked one.
 *
 * The tick is the fix for the first and the shape is the fix for the second.
 */
function LayerToggle({
  on,
  onClick,
  disabled,
  disabledReason,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Why it cannot be switched on — shown on hover and read as the name. */
  disabledReason?: string;
  children: ReactNode;
}) {
  /*
   * A layer with nothing to draw is off, whatever the preference behind it says.
   *
   * The survey toggle held its own remembered state and was disabled only
   * because no sketch was on file, so it rendered ticked and greyed at the
   * same time — which reads as "this layer is on and you may not turn it
   * off", the opposite of the truth. The tick follows what is on the map.
   */
  const lit = on && !disabled;
  return (
    <button
      type="button"
      aria-pressed={lit}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors duration-base',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        disabled ? 'cursor-not-allowed text-ink-muted opacity-50' : 'hover:bg-sunken',
        lit ? 'text-ink' : 'text-ink-muted',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid h-3 w-3 shrink-0 place-items-center rounded-[3px] ring-1 ring-inset',
          lit ? 'bg-brand text-white ring-brand' : 'bg-surface ring-[var(--ring)]',
        )}
      >
        {lit ? <Check size={9} strokeWidth={3} /> : null}
      </span>
      {children}
    </button>
  );
}

/** Basemap is a choice between two, so it is drawn as one control, not two pills. */
function Basemaps({ value, onChange }: { value: Basemap; onChange: (next: Basemap) => void }) {
  return (
    <div role="radiogroup" aria-label="Basemap" className="inline-flex rounded-md bg-sunken p-0.5 ring-1 ring-inset ring-[var(--ring)]">
      {(['satellite', 'streets'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-[5px] px-2 py-0.5 text-[12px] capitalize transition-colors duration-base',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
            value === option ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
