import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, MapPinned, RefreshCw, Upload } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { sheetIsPlaceable, type DdProject, type GisContextFeature, type GisOverlayHit, type GisOverlayRead, type SheetPlacement } from '@realytica/shared';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Disclosure, cn } from './ui/kit';
import { api } from '../lib/api';

/**
 * Pin + optional survey sketch + OSM + OpenCity civic clips.
 *
 * OSM and OpenCity lakes/wards are volunteer or civic geometry. They are not
 * the RMP hatch and not a classified drain. The card is the showcase; it
 * never files what it draws.
 */

type Basemap = 'satellite' | 'streets';

const WATER_STYLE: L.PathOptions = { color: '#1d4ed8', weight: 2, fillColor: '#3b82c4', fillOpacity: 0.38 };
const WATER_FLAG_STYLE: L.PathOptions = { color: '#b91c1c', weight: 3, fillColor: '#ef4444', fillOpacity: 0.28 };
const WATERWAY_STYLE: L.PathOptions = { color: '#1d4ed8', weight: 2.5, opacity: 0.9 };
const LANDUSE_STYLE: L.PathOptions = { color: '#a16207', weight: 1, dashArray: '4 3', fillColor: '#fbbf24', fillOpacity: 0.18 };
const SURVEY_STYLE: L.PathOptions = { color: '#c2410c', weight: 2.5, fillColor: '#fb923c', fillOpacity: 0.12 };

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

function addFeature(group: L.LayerGroup, feature: GisContextFeature, flagged: boolean): void {
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
    L.polygon(latlngs(feature.ring), style).bindTooltip(tooltip).addTo(group);
  } else if (feature.line) {
    L.polyline(latlngs(feature.line), water ? WATERWAY_STYLE : LANDUSE_STYLE)
      .bindTooltip(tooltip)
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
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    water?: L.LayerGroup;
    landuse?: L.LayerGroup;
    survey?: L.LayerGroup;
    pin?: L.Layer;
    lakes?: L.LayerGroup;
    wards?: L.LayerGroup;
  }>({});
  const tilesRef = useRef<{ satellite?: L.TileLayer; streets?: L.TileLayer }>({});
  const wmsRef = useRef<L.TileLayer.WMS | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [read, setRead] = useState<GisOverlayRead | null>(null);
  /** Whether there is anything to draw. Declared here because the map effect reads it. */
  const canMap = Boolean(read?.pin || read?.survey);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('satellite');
  const [showWater, setShowWater] = useState(true);
  const [showLanduse, setShowLanduse] = useState(true);
  const [showSurvey, setShowSurvey] = useState(true);
  const [showBbmp, setShowBbmp] = useState(true);
  const [showLakes, setShowLakes] = useState(true);
  const [showWards, setShowWards] = useState(true);
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

  useEffect(() => {
    const el = mapEl.current;
    if (!el) return undefined;
    const map = L.map(el, { scrollWheelZoom: true, attributionControl: true, zoomControl: true });
    mapRef.current = map;
    tilesRef.current.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri', maxZoom: 19 },
    );
    tilesRef.current.streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });
    tilesRef.current.satellite.addTo(map);
    map.setView([20, 0], 2);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
      tilesRef.current = {};
    };
    // Re-runs when the canvas appears, because a project with no pin and no
    // survey does not render one — see the map block below.
  }, [canMap]);

  useEffect(() => {
    const map = mapRef.current;
    const sat = tilesRef.current.satellite;
    const streets = tilesRef.current.streets;
    if (!map || !sat || !streets) return;
    if (basemap === 'satellite') {
      if (!map.hasLayer(sat)) sat.addTo(map);
      if (map.hasLayer(streets)) map.removeLayer(streets);
    } else {
      if (!map.hasLayer(streets)) streets.addTo(map);
      if (map.hasLayer(sat)) map.removeLayer(sat);
    }
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !read) return;

    for (const key of ['water', 'landuse', 'survey', 'pin', 'lakes', 'wards'] as const) {
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
    const bounds: L.LatLngExpression[] = [];

    for (const feature of read.features) {
      const group =
        feature.kind === 'osm_landuse'
          ? landuse
          : feature.kind === 'civic_lake'
            ? lakes
            : feature.kind === 'civic_ward'
              ? wards
              : water;
      addFeature(group, feature, flagged.has(feature.id));
      for (const p of feature.ring ?? feature.line ?? []) bounds.push([p.lat, p.lng]);
    }

    if (read.survey?.ring.length) {
      L.polygon(latlngs(read.survey.ring), SURVEY_STYLE)
        .bindTooltip('Supplied survey outline — not product-drawn, not RMP')
        .addTo(survey);
      for (const p of read.survey.ring) bounds.push([p.lat, p.lng]);
    }

    let pinLayer: L.Layer | undefined;
    if (read.pin) {
      pinLayer = L.circleMarker([read.pin.lat, read.pin.lng], {
        radius: 8,
        color: '#1c5cab',
        weight: 2,
        fillColor: '#2a78d6',
        fillOpacity: 1,
      }).bindTooltip(read.pin.resolvedAddress ? `Pin — ${read.pin.resolvedAddress}` : 'Geocoded pin — not a parcel');
      pinLayer.addTo(map);
      bounds.push([read.pin.lat, read.pin.lng]);
    }

    layersRef.current = { water, landuse, lakes, wards, survey, pin: pinLayer };
    if (bounds.length) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 16 });
    }
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
  }, [read, showWater, showLanduse, showLakes, showWards, showSurvey]);

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
    if (!placedSheet || !showSheet) return undefined;
    const placed = placedSheet;
    const { north, south, east, west } = placed.reading.fit!.bounds;
    const layer = L.imageOverlay(
      `/api/projects/${project.id}/evidence/${placed.sheet.evidenceId}/files/${placed.sheet.attachmentId}?inline=1`,
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
  }, [placedSheet, showSheet, sheetOpacity, project.id]);

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

  const flags = useMemo(() => (read?.hits ?? []).filter((h) => h.severity === 'flag'), [read]);
  const notes = useMemo(
    () =>
      (read?.hits ?? []).filter(
        (h) =>
          h.severity === 'info' &&
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

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
          <Layers size={13} className="text-ink-muted" />
          <button type="button" className={toggleClass(basemap === 'satellite')} onClick={() => setBasemap('satellite')}>
            Satellite
          </button>
          <button type="button" className={toggleClass(basemap === 'streets')} onClick={() => setBasemap('streets')}>
            Streets
          </button>
          <span className="text-ink-muted">·</span>
          <button type="button" className={toggleClass(showWater)} onClick={() => setShowWater((v) => !v)}>
            OSM water
          </button>
          <button type="button" className={toggleClass(showLanduse)} onClick={() => setShowLanduse((v) => !v)}>
            OSM landuse
          </button>
          {lakeCount > 0 ? (
            <button type="button" className={toggleClass(showLakes)} onClick={() => setShowLakes((v) => !v)}>
              OpenCity lakes {lakeCount}
            </button>
          ) : null}
          {wardCount > 0 ? (
            <button type="button" className={toggleClass(showWards)} onClick={() => setShowWards((v) => !v)}>
              GBA wards {wardCount}
            </button>
          ) : null}
          <button type="button" className={toggleClass(showSurvey)} onClick={() => setShowSurvey((v) => !v)} disabled={!read?.survey}>
            Survey sketch
          </button>
          {liveBbmp ? (
            <button type="button" className={toggleClass(showBbmp)} onClick={() => setShowBbmp((v) => !v)}>
              BBMP WMS lakes/parks
            </button>
          ) : null}
          {placedSheet ? (
            <>
              <button type="button" className={toggleClass(showSheet)} onClick={() => setShowSheet((v) => !v)}>
                {placedSheet.sheet.title}
              </button>
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
          {read?.osm.error ? <Badge tone="warning">OSM {read.osm.error}</Badge> : null}
          {read ? (
            <Badge tone="neutral">
              {read.osm.featureCount} OSM · {lakeCount} lakes · {wardCount} wards · CONTEXT
            </Badge>
          ) : null}
        </div>

        {placedSheet && showSheet ? (
          /* A raster somebody will read a boundary off, so how well it is
             placed travels with it. `unchecked` especially: two control points
             fit exactly by construction, and a viewer who does not know that
             will read a perfect fit as a verified one. */
          <p
            className={cn(
              'text-[11.5px]',
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
          <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-[var(--ring)]">
            <div ref={mapEl} className="gis-map z-0 h-[min(420px,55vh)] w-full" />
          </div>
        ) : loading ? (
          <div className="min-h-[120px] rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]" />
        ) : (
          <p className="rounded-lg bg-sunken px-3 py-2.5 text-[12.5px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
            No pin and no survey sketch yet — geocode the site address, or upload a surveyor&apos;s GeoJSON/KML.
          </p>
        )}

        {loading && !read ? <p className="text-[12.5px] text-ink-muted">Building the overlay…</p> : null}

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
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
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
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Official maps for this file ({read.maps.realm})
            </p>
            <ul className="space-y-1.5">
              {read.maps.sittings.map((s) => (
                <li key={s.key} className="text-[12.5px] leading-relaxed text-ink-secondary">
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
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Withdrawn RMP-2031 sheets that mention this locality (not in force)
            </p>
            <ul className="space-y-1">
              {read.withdrawnSheets.map((s) => (
                <li key={s.url} className="text-[12.5px] leading-relaxed text-ink-secondary">
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-ink hover:underline">
                    {s.name}
                  </a>
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

function toggleClass(on: boolean) {
  return cn(
    'rounded-md px-2 py-0.5 ring-1 ring-inset',
    on ? 'bg-brand-soft text-brand ring-brand/30' : 'bg-sunken text-ink-muted ring-[var(--ring)]',
  );
}
