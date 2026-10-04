import { Check } from 'lucide-react';
import { useMeasure } from '../../components/charts/primitives';
import { Button, Card, TONE_ICON, andList, cn, toneText, type Tone } from '../../components/ui/kit';

/**
 * The site on a map: the plot, what lies around it, and what the planning
 * authority has drawn over it.
 *
 * The example project keeps one map, in Engineering · Site. Every other map is
 * a view of that one with its own layers switched on, so a drain or a road is
 * drawn once and reads the same wherever it is shown.
 */

export type MapView = 'site' | 'area' | 'plot';

export type MapLayer = 'plot' | 'survey' | 'water' | 'planning' | 'roads' | 'power' | 'airport' | 'rings';

export interface MapPin {
  t: string;
  kind: 'borehole' | 'photo' | 'visit' | 'comparable' | 'competitor' | 'amenity';
  /** Percent of the map from the left and from the top. */
  x: number;
  y: number;
}

export interface MapMeasure {
  t: string;
  v: string;
  tone: 'ok' | 'warn' | 'crit';
}

export interface MapBlockSpec {
  type: 'map';
  title?: string;
  view: MapView;
  /** The layers switched on when the map is first shown. */
  layers: MapLayer[];
  pins?: MapPin[];
  measures?: MapMeasure[];
}

export interface MapBlockProps {
  block: MapBlockSpec;
  /** The layers switched on now. */
  layers: MapLayer[];
  onToggleLayer: (layer: MapLayer) => void;
  /** Set when this map is a view of the one kept elsewhere: where the original is, and the way there. */
  home?: { label: string; onOpen: () => void } | null;
}

/* ==================================================================== */
/* What the map is drawn with                                            */
/* ==================================================================== */

/*
 * The map's own colours, named for what they draw.
 *
 * A map is a drawing on paper, so it keeps one light palette in both themes,
 * the way a page of a document does. Only what stands around it (the
 * switches, the key, the measures) follows the theme.
 */
const MAP = {
  land: '#EEF1EA',
  zoneResidential: '#F5ECDC',
  zoneCommercial: '#E1E6EF',
  zoneOpen: '#DCEBD6',
  water: '#BFDDF2',
  waterEdge: '#6FA8D6',
  waterName: '#2B6A9B',
  buffer: '#4F93C8',
  drain: '#4F93C8',
  drainBuffer: '#6FA8D6',
  road: '#D3D8DE',
  roadMarking: '#FFFFFF',
  highway: '#C5CBD3',
  proposedRoad: '#8D949F',
  metro: '#8A5A00',
  station: '#FFFFFF',
  powerLine: '#8A5A00',
  powerCorridor: '#C99A2E',
  restricted: '#B42318',
  plot: '#0B6464',
  plotName: '#084C4C',
  setback: '#2B5FA8',
  building: '#15171A',
  buildingEdge: '#4A4F57',
  basement: '#69707A',
  words: '#4A4F57',
  halo: '#FFFFFF',
  north: '#4A4F57',
  pin: {
    borehole: '#8A5A00',
    photo: '#0B6464',
    visit: '#15171A',
    comparable: '#2B5FA8',
    competitor: '#2B5FA8',
    amenity: '#5B6470',
  },
  pinEdge: '#FFFFFF',
} as const;

/** The drawing is 1000 by 560 of its own units, whatever size it is shown at. */
const WIDTH = 1000;
const HEIGHT = 560;

/** At this many pixels and wider, the map is drawn at its own size. Narrower, the pen grows to keep words and marks readable. */
const FULL_WIDTH = 860;
/** Narrower than this the map cannot carry every word, and the ones that explain a mark move to the key under it. */
const KEY_WIDTH = 640;
/** The pen stops growing here, at about the width of a small phone. */
const MAX_PEN = 2.7;

const LAYER_NAME: Record<MapLayer, string> = {
  plot: 'Plot',
  survey: 'Survey numbers',
  water: 'Water and buffers',
  planning: 'Town planning',
  roads: 'Roads',
  power: 'Power line',
  airport: 'Airport zone',
  rings: 'Distance rings',
};

/** The layers each view can draw, in the order of their switches. */
const VIEW_LAYERS: Record<MapView, MapLayer[]> = {
  site: ['plot', 'survey', 'water', 'planning', 'roads', 'power', 'airport'],
  area: ['plot', 'rings', 'water', 'roads'],
  plot: ['plot', 'survey', 'planning', 'roads'],
};

const VIEW_SAYS: Record<MapView, string> = {
  site: 'Example map of the plot and about 300 m around it',
  area: 'Example map of the neighbourhood around the site',
  plot: 'Example map of the plot itself',
};

const PIN: Record<MapPin['kind'], { letter: string; name: string }> = {
  borehole: { letter: 'B', name: 'Borehole' },
  photo: { letter: 'P', name: 'Photograph' },
  visit: { letter: 'V', name: 'Visit' },
  comparable: { letter: 'C', name: 'Comparable' },
  competitor: { letter: 'K', name: 'Competing project' },
  amenity: { letter: 'A', name: 'Amenity' },
};

interface Paint {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  strokeDasharray?: string;
  strokeLinecap?: 'round';
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * How each thing on the map is drawn.
 *
 * Lines and edges are drawn with a pen: their weight and their dashes grow
 * with `pen`, so they keep their size on screen as the map gets narrower.
 * Bands that stand for a width on the ground (a buffer, a corridor, a road)
 * are in the map's own units and do not.
 */
function paints(pen: number) {
  const line = (stroke: string, weight: number, dash?: readonly [number, number]): Paint => ({
    fill: 'none',
    stroke,
    strokeWidth: round(weight * pen),
    strokeDasharray: dash ? `${round(dash[0] * pen)} ${round(dash[1] * pen)}` : undefined,
  });
  return {
    water: { fill: MAP.water, stroke: MAP.waterEdge, strokeWidth: round(1.5 * pen) },
    buffer: line(MAP.buffer, 1.5, [7, 6]),
    drain: { ...line(MAP.drain, 6), strokeLinecap: 'round' },
    drainBuffer: { fill: 'none', stroke: MAP.drainBuffer, strokeOpacity: 0.28, strokeWidth: 62 },
    roadMarking: line(MAP.roadMarking, 2, [12, 10]),
    proposedRoad: line(MAP.proposedRoad, 3, [10, 8]),
    highway: { fill: 'none', stroke: MAP.highway, strokeWidth: 16 },
    mainRoad: { fill: 'none', stroke: MAP.road, strokeWidth: 8 },
    metro: line(MAP.metro, 3, [3, 7]),
    station: { fill: MAP.station, stroke: MAP.metro, strokeWidth: round(2.5 * pen) },
    ring: { ...line(MAP.plot, 1.5, [6, 6]), strokeOpacity: 0.55 },
    powerLine: line(MAP.powerLine, 2),
    powerCorridor: { fill: 'none', stroke: MAP.powerCorridor, strokeOpacity: 0.2, strokeWidth: 48 },
    restricted: { ...line(MAP.restricted, 1, [4, 4]), strokeOpacity: 0.45, fill: MAP.restricted, fillOpacity: 0.12 },
    plot: { fill: MAP.plot, fillOpacity: 0.16, stroke: MAP.plot, strokeWidth: round(2.5 * pen) },
    site: { fill: MAP.plot, stroke: MAP.plot, strokeWidth: 2.5 },
    surveyLine: line(MAP.plot, 1.5, [6, 5]),
    setback: line(MAP.setback, 1.5, [8, 6]),
    building: { fill: MAP.building, fillOpacity: 0.12, stroke: MAP.buildingEdge, strokeWidth: round(1.5 * pen) },
    basement: line(MAP.basement, 1, [3, 5]),
  } satisfies Record<string, Paint>;
}

type Paints = ReturnType<typeof paints>;

/** The paints at the map's own size, for the samples in the key. */
const INK = paints(1);

/* ==================================================================== */
/* The words on the map                                                  */
/* ==================================================================== */

/** The three hands the map is lettered in: a note, the name of water, and the name of the plot or what stands on it. */
const FACE = {
  note: { size: 13, weight: 400, fill: MAP.words },
  water: { size: 14, weight: 500, fill: MAP.waterName },
  plot: { size: 14, weight: 600, fill: MAP.plotName },
} as const;

/** What stands for a thing in the key: a patch of it, a band, a line, or a line on its band. */
interface Sample {
  area?: Paint;
  band?: Paint;
  line?: Paint;
}

interface MapWords {
  /** The layer these words belong to. Left out, they are always drawn. */
  layer?: MapLayer;
  says: string;
  /** A second, quieter line under the first. */
  more?: string;
  x: number;
  y: number;
  anchor?: 'middle' | 'end';
  /** How far below `y` the words sit, in their own heights: 0.35 centres them on it, 0.8 hangs them from it, a negative one stands them above it. */
  drop?: number;
  face?: keyof typeof FACE;
  /** Words that explain a mark. Where the map is too small to carry them, they go to the key beside this sample. */
  sample?: Sample;
}

/*
 * Where each word stands. Words get larger in the map's own units as the map
 * gets narrower, so one with close neighbours is centred on what it names,
 * hung below it or stood above it (`drop`), and grows in place.
 */
const WORDS: Record<MapView, MapWords[]> = {
  site: [
    { layer: 'planning', says: 'Residential zone', x: 770, y: 340, sample: { area: { fill: MAP.zoneResidential } } },
    { layer: 'planning', says: 'Commercial axis', x: 770, y: 426, drop: 0.35, sample: { area: { fill: MAP.zoneCommercial } } },
    { layer: 'planning', says: 'Park and open space', x: 40, y: 250, sample: { area: { fill: MAP.zoneOpen } } },
    { layer: 'planning', says: 'Proposed 18 m road', x: 790, y: 70, sample: { line: INK.proposedRoad } },
    { layer: 'water', says: 'Lake', x: 112, y: 128, drop: 0.35, anchor: 'middle', face: 'water' },
    { layer: 'water', says: 'Lake buffer', x: 60, y: 222, sample: { line: INK.buffer } },
    {
      layer: 'water',
      says: 'Storm-water drain',
      more: 'and its buffer',
      x: 204,
      y: 316,
      anchor: 'end',
      face: 'water',
      sample: { band: INK.drainBuffer, line: { ...INK.drain, strokeWidth: 3 } },
    },
    { layer: 'power', says: '110 kV line and corridor', x: 776, y: 116, sample: { band: INK.powerCorridor, line: INK.powerLine } },
    { layer: 'airport', says: 'Airport height zone', x: 990, y: 24, anchor: 'end', sample: { area: INK.restricted } },
    { layer: 'roads', says: '24 m road', x: 40, y: 476, drop: 0.35 },
    { layer: 'roads', says: '12 m road', x: 722, y: 380 },
    { layer: 'plot', says: 'Lakeview Tower', x: 500, y: 168, drop: -0.86, anchor: 'middle', face: 'plot' },
    { layer: 'survey', says: '41/2', x: 440, y: 280, drop: 0.35, anchor: 'middle', face: 'plot' },
    { layer: 'survey', says: '41/3', x: 560, y: 280, drop: 0.35, anchor: 'middle', face: 'plot' },
    { layer: 'survey', says: '64.0 m', x: 500, y: 398, drop: 0.8, anchor: 'middle' },
    { layer: 'survey', says: '65.8 m', x: 628, y: 250 },
  ],
  area: [
    { layer: 'water', says: 'Lake', x: 247, y: 172, anchor: 'middle', face: 'water' },
    { layer: 'water', says: 'Lake', x: 751, y: 432, anchor: 'middle', face: 'water' },
    { layer: 'roads', says: 'Highway', x: 40, y: 431, drop: 0.8 },
    { layer: 'roads', says: 'Main road', x: 418, y: 40, anchor: 'end' },
    { layer: 'roads', says: 'Metro line', x: 40, y: 222 },
    { layer: 'rings', says: '3 km', x: 506, y: 124 },
    { layer: 'rings', says: '5 km', x: 506, y: 36, drop: 0.85 },
    { layer: 'plot', says: 'Site', x: 524, y: 280, drop: 0.35, face: 'plot' },
    { says: 'Airport 14 km to the north-east', x: 40, y: 540 },
  ],
  plot: [
    { layer: 'roads', says: '24 m road', x: 40, y: 500, drop: 0.35 },
    { layer: 'roads', says: '12 m road', x: 988, y: 180, anchor: 'end' },
    { layer: 'planning', says: 'Road widening strip', x: 160, y: 434, drop: 0.35, sample: { area: INK.restricted } },
    { layer: 'planning', says: 'Setback line', x: 204, y: 118, drop: 0.8, sample: { line: INK.setback } },
    { says: 'Basement line', x: 244, y: 387, drop: 0.8, sample: { line: INK.basement } },
    { says: 'Tower', x: 495, y: 260, drop: 0.35, anchor: 'middle', face: 'plot' },
    { says: 'Club', x: 711, y: 328, drop: 0.35, anchor: 'middle' },
    { layer: 'survey', says: '41/2', x: 322, y: 91, drop: 0.35, anchor: 'middle', face: 'plot' },
    { layer: 'survey', says: '41/3', x: 668, y: 91, drop: 0.35, anchor: 'middle', face: 'plot' },
    { layer: 'survey', says: '64.0 m', x: 495, y: 60, anchor: 'middle' },
    { layer: 'survey', says: '65.8 m', x: 838, y: 262, anchor: 'end' },
  ],
};

/** Words on the map, with a pale edge so they read over whatever lies under them. */
function Words({ words, pen }: { words: MapWords; pen: number }) {
  const face = FACE[words.face ?? 'note'];
  return (
    <text
      x={words.x}
      y={words.y}
      dy={words.drop ? `${words.drop}em` : undefined}
      textAnchor={words.anchor}
      fontSize={Math.round(face.size * pen)}
      fontWeight={face.weight}
      fill={face.fill}
      stroke={MAP.halo}
      strokeOpacity={0.8}
      strokeWidth={round(3 * pen)}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {words.says}
      {words.more ? (
        <tspan x={words.x} dy="1.4em" fontSize={Math.round(FACE.note.size * pen)} fontWeight={FACE.note.weight} fill={FACE.note.fill}>
          {words.more}
        </tspan>
      ) : null}
    </text>
  );
}

/* ==================================================================== */
/* The three views                                                       */
/* ==================================================================== */

interface ViewProps {
  on: ReadonlySet<MapLayer>;
  ink: Paints;
  /** How much larger than their own size the small marks are drawn: a pylon, a station, the site's square. */
  dot: number;
}

const SITE_LAKE = 'M52 78c30-48 122-58 172-28s62 82 22 108-152 26-187-10-27-46-7-70z';
const SITE_DRAIN = 'M214 168C244 240 236 330 242 400S262 510 268 560';
const SITE_POWER = 'M540 0L1000 268';
const SITE_PYLONS = [
  [610, 41],
  [760, 128],
  [910, 216],
] as const;

/** The plot and about 300 m around it. The roads, the lake and the drain are the ground; each layer adds what the rules say about it. */
function SiteView({ on, ink, dot }: ViewProps) {
  return (
    <>
      {on.has('planning') ? (
        <>
          <rect width={WIDTH} height={HEIGHT} fill={MAP.zoneResidential} />
          <ellipse cx={150} cy={105} rx={218} ry={152} fill={MAP.zoneOpen} />
          <rect y={396} width={WIDTH} height={60} fill={MAP.zoneCommercial} />
          <rect y={496} width={WIDTH} height={64} fill={MAP.zoneCommercial} />
        </>
      ) : null}
      <rect y={456} width={WIDTH} height={40} fill={MAP.road} />
      <path d="M0 476h1000" {...ink.roadMarking} />
      <rect x={690} width={24} height={456} fill={MAP.road} />
      <path d={SITE_LAKE} {...ink.water} />
      {on.has('water') ? (
        <>
          <ellipse cx={150} cy={100} rx={160} ry={102} {...ink.buffer} />
          <path d={SITE_DRAIN} {...ink.drainBuffer} />
        </>
      ) : null}
      <path d={SITE_DRAIN} {...ink.drain} />
      {on.has('planning') ? <path d="M760 0L1000 190" {...ink.proposedRoad} /> : null}
      {on.has('power') ? (
        <>
          <path d={SITE_POWER} {...ink.powerCorridor} />
          <path d={SITE_POWER} {...ink.powerLine} />
          {SITE_PYLONS.map(([x, y]) => (
            <rect key={x} x={round(x - 5 * dot)} y={round(y - 5 * dot)} width={round(10 * dot)} height={round(10 * dot)} fill={MAP.powerLine} />
          ))}
        </>
      ) : null}
      {on.has('airport') ? <path d="M820 0h180v150z" {...ink.restricted} /> : null}
      {on.has('plot') ? <rect x={380} y={168} width={240} height={224} {...ink.plot} /> : null}
      {on.has('survey') ? <path d="M500 168v224" {...ink.surveyLine} /> : null}
    </>
  );
}

const AREA_STATIONS = [
  [180, 246],
  [500, 246],
  [820, 200],
] as const;

/** The neighbourhood, with the site at the centre of its distance rings. */
function AreaView({ on, ink, dot }: ViewProps) {
  return (
    <>
      <path d="M0 420C300 400 620 330 1000 300" {...ink.highway} />
      <path d="M430 0C470 190 520 380 600 560" {...ink.mainRoad} />
      <path d="M0 150C260 190 640 150 1000 90" {...ink.mainRoad} />
      <path d="M196 138c26-34 92-38 126-14s38 60 8 80-104 20-130-8-18-40-4-58z" {...ink.water} />
      <path d="M700 400c22-26 78-30 106-10s30 48 6 64-86 16-108-8-16-32-4-46z" {...ink.water} />
      {on.has('roads') ? (
        <>
          <path d="M0 232C330 262 660 222 1000 172" {...ink.metro} />
          {AREA_STATIONS.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={round(5 * dot)} {...ink.station} />
          ))}
        </>
      ) : null}
      {on.has('rings') ? (
        <>
          <circle cx={500} cy={280} r={150} {...ink.ring} />
          <circle cx={500} cy={280} r={250} {...ink.ring} />
        </>
      ) : null}
      {on.has('plot') ? (
        <rect x={round(500 - 12 * dot)} y={round(280 - 12 * dot)} width={round(24 * dot)} height={round(24 * dot)} rx={round(3 * dot)} {...ink.site} />
      ) : null}
    </>
  );
}

/** The plot itself: what may be built where, and what is. */
function PlotView({ on, ink }: ViewProps) {
  return (
    <>
      <rect y={470} width={WIDTH} height={60} fill={MAP.road} />
      <path d="M0 500h1000" {...ink.roadMarking} />
      <rect x={870} width={40} height={470} fill={MAP.road} />
      {on.has('plot') ? <rect x={150} y={70} width={690} height={376} {...ink.plot} /> : null}
      {on.has('planning') ? (
        <>
          <rect x={150} y={422} width={690} height={24} {...ink.restricted} />
          <rect x={196} y={112} width={598} height={298} {...ink.setback} />
        </>
      ) : null}
      <rect x={236} y={140} width={516} height={244} {...ink.basement} />
      <rect x={330} y={170} width={330} height={180} {...ink.building} />
      <rect x={676} y={296} width={70} height={64} {...ink.building} />
      {on.has('survey') ? <path d="M495 70v376" {...ink.surveyLine} /> : null}
    </>
  );
}

const VIEW = { site: SiteView, area: AreaView, plot: PlotView } satisfies Record<MapView, (props: ViewProps) => unknown>;

/* ==================================================================== */
/* Pins, the key and the drawing                                         */
/* ==================================================================== */

/** A pin, drawn about its own centre: on the map and again in the key. */
function Pin({ kind, scale }: { kind: MapPin['kind']; scale: number }) {
  return (
    <>
      <circle r={round(12 * scale)} fill={MAP.pin[kind]} stroke={MAP.pinEdge} strokeWidth={round(2.5 * scale)} />
      <text dy="0.35em" textAnchor="middle" fontSize={Math.round(12 * scale)} fontWeight={500} fill={MAP.pinEdge} className="font-mono">
        {PIN[kind].letter}
      </text>
    </>
  );
}

/** A piece of the map the size of a word, for the key. */
function SampleMark({ area, band, line }: Sample) {
  return (
    <svg viewBox="0 0 22 14" aria-hidden className="h-3.5 w-[22px] shrink-0 rounded-[3px] ring-1 ring-[var(--ring)]">
      <rect width={22} height={14} fill={MAP.land} />
      {area ? <rect width={22} height={14} {...area} /> : null}
      {band ? <path d="M0 7h22" {...band} strokeWidth={10} /> : null}
      {line ? <path d="M0 7h22" {...line} /> : null}
    </svg>
  );
}

function shown(words: MapWords, on: ReadonlySet<MapLayer>): boolean {
  return !words.layer || on.has(words.layer);
}

function MapDrawing({
  view,
  on,
  pins,
  pen,
  keyed,
  label,
}: {
  view: MapView;
  on: ReadonlySet<MapLayer>;
  pins: MapPin[];
  /** How much larger than its own size the pen draws, so words and marks stay readable on a narrow map. */
  pen: number;
  /** The map is too small for every word: the ones with a sample are in the key instead. */
  keyed: boolean;
  label: string;
}) {
  const View = VIEW[view];
  /*
   * Words and lines keep their size on screen as the map narrows. Pins give
   * up a little of theirs, and the small marks grow at half the pace, or each
   * would swallow its neighbours.
   */
  const mark = round(pen ** 0.8);
  const dot = round(Math.sqrt(pen));
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="block h-auto w-full">
      <rect width={WIDTH} height={HEIGHT} fill={MAP.land} />
      <View on={on} ink={paints(pen)} dot={dot} />
      {WORDS[view].map((words) => (shown(words, on) && !(keyed && words.sample) ? <Words key={`${words.says}-${words.x}`} words={words} pen={pen} /> : null))}
      {pins.map((pin, i) => (
        <g key={i} transform={`translate(${Math.round(pin.x * 10)} ${Math.round(pin.y * 5.6)})`}>
          <title>{pin.t}</title>
          <Pin kind={pin.kind} scale={mark} />
        </g>
      ))}
      <g transform={`translate(${round(WIDTH - 38 * mark)} ${round(HEIGHT - 38 * mark)}) scale(${mark})`}>
        <path d="M0 -22l9 26-9-7-9 7z" fill={MAP.north} />
        <text y={24} textAnchor="middle" fontSize={12} fontWeight={500} fill={MAP.north} className="font-mono">
          N
        </text>
      </g>
    </svg>
  );
}

/** What the picture shows, for someone who cannot see it. */
function describe(block: MapBlockSpec, on: ReadonlySet<MapLayer>): string {
  const layers = VIEW_LAYERS[block.view].filter((layer) => on.has(layer)).map((layer) => LAYER_NAME[layer].toLowerCase());
  const pins = (block.pins ?? []).map((pin) => pin.t);
  return [
    `${VIEW_SAYS[block.view]}, not to scale.`,
    layers.length ? `Showing ${andList(layers)}.` : 'No layers switched on.',
    pins.length ? `Marked: ${pins.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/* ==================================================================== */
/* The block                                                             */
/* ==================================================================== */

/*
 * A measure's tone is a tint, a mark and a word for a screen reader, so it
 * does not rest on colour alone. Its label is in the quiet ink on a plain
 * chip and the secondary ink on a tinted one, where the quiet ink is too
 * faint to read in the dark theme.
 */
const MEASURE_TONE: Record<MapMeasure['tone'], { tone: Tone; chip: string; says: string }> = {
  ok: { tone: 'good', chip: 'border-good/40 bg-surface text-ink-muted', says: 'fine' },
  warn: { tone: 'warning', chip: 'border-warning/50 bg-warning/15 text-ink-secondary', says: 'to check' },
  crit: { tone: 'critical', chip: 'border-critical/50 bg-critical/10 text-ink-secondary', says: 'a problem' },
};

/**
 * One card: the layer switches, the drawing, a key, and what was read off it.
 * It is framed like the other blocks of the example (a heading with one quiet
 * note beside it, a ruled foot) and takes everything it shows as props, so it
 * can stand on any page.
 *
 * The drawing is a fixed picture of the example's site: the block only says
 * which view to show, which layers start switched on and what to pin. Which
 * layers are on now is the caller's to keep, so each view of the map
 * remembers its own.
 *
 * The map is measured rather than left to scale as a picture. Scaled, its
 * words would be four pixels tall on a phone. So below its own size the pen
 * grows as the map shrinks, which keeps words and line weights the same size
 * on screen; and below the width where the words would collide, the ones that
 * explain a mark move to the key, each beside a sample of it.
 *
 * The card is its own container, so the measures go beside the map when the
 * card itself is wide, whatever the page around it is doing.
 */
export function MapBlock({ block, layers, onToggleLayer, home }: MapBlockProps) {
  const [box, { width }] = useMeasure<HTMLDivElement>();
  const on = new Set(layers);
  const pins = block.pins ?? [];
  const measures = block.measures ?? [];
  const pen = width > 0 ? Math.min(MAX_PEN, Math.max(1, FULL_WIDTH / width)) : 1;
  const keyed = width > 0 && width < KEY_WIDTH;
  const samples = keyed ? WORDS[block.view].filter((words) => words.sample && shown(words, on)) : [];
  const kinds = [...new Set(pins.map((pin) => pin.kind))];

  return (
    <Card className="overflow-hidden [container-type:inline-size]">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3.5 py-[11px]">
        <h3 className="text-[14px] font-semibold text-ink">{block.title ?? 'Map'}</h3>
        <span className="ml-auto font-mono text-[12px] text-ink-muted">Example map, not to scale</span>
      </header>

      <div role="group" aria-label="Map layers" className="flex flex-wrap gap-1.5 border-t border-hairline px-3.5 py-2.5">
        {VIEW_LAYERS[block.view].map((layer) => {
          const pressed = on.has(layer);
          return (
            <button
              key={layer}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggleLayer(layer)}
              className={cn(
                'inline-flex min-h-7 items-center gap-1.5 rounded-full border text-[12px] font-medium coarse:min-h-11',
                'transition-colors duration-quick ease-state',
                // A layer that is on carries a tick. One that is off keeps the tick's room as padding, so a switch stays the same width and nothing under it moves.
                pressed ? 'border-brand bg-brand-soft px-[11px] text-brand-strong' : 'border-[var(--axis)] bg-surface px-5 text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              {pressed ? <Check size={12} strokeWidth={2.5} aria-hidden className="shrink-0" /> : null}
              {LAYER_NAME[layer]}
            </button>
          );
        })}
      </div>

      <div className={cn('grid grid-cols-1 border-t border-hairline', measures.length > 0 && '[@container(min-width:56rem)]:grid-cols-[minmax(0,1fr)_15rem]')}>
        <div className="min-w-0">
          <div ref={box} style={{ backgroundColor: MAP.land }}>
            <MapDrawing view={block.view} on={on} pins={pins} pen={pen} keyed={keyed} label={describe(block, on)} />
          </div>
          {samples.length + kinds.length > 0 ? (
            <ul
              aria-label="Key to the map"
              className={cn(
                'flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-3.5 pt-2.5 text-[12px] text-ink-secondary',
                measures.length > 0 ? '[@container(min-width:56rem)]:pb-2.5' : 'pb-2.5',
              )}
            >
              {samples.map((words) => (
                <li key={words.says} className="inline-flex items-center gap-1.5">
                  {words.sample ? <SampleMark {...words.sample} /> : null}
                  {words.more ? `${words.says} ${words.more}` : words.says}
                </li>
              ))}
              {kinds.map((kind) => (
                <li key={kind} className="inline-flex items-center gap-1.5">
                  <svg viewBox="-14 -14 28 28" aria-hidden className="size-[22px] shrink-0">
                    <Pin kind={kind} scale={1} />
                  </svg>
                  {PIN[kind].name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {measures.length > 0 ? (
          <dl
            className={cn(
              'flex min-w-0 flex-wrap content-start gap-1.5 px-3.5 pb-3 pt-2.5',
              '[@container(min-width:56rem)]:flex-col [@container(min-width:56rem)]:flex-nowrap [@container(min-width:56rem)]:border-l [@container(min-width:56rem)]:border-hairline [@container(min-width:56rem)]:p-3',
            )}
          >
            {measures.map((measure, i) => {
              const { tone, chip, says } = MEASURE_TONE[measure.tone];
              const Mark = TONE_ICON[tone];
              return (
                <div
                  key={i}
                  className={cn(
                    'inline-flex min-h-7 max-w-full items-baseline gap-x-[7px] gap-y-0.5 rounded-lg border px-[9px] py-1 text-[12px]',
                    // Beside the map each is a row: the value at the right, or on a line of its own where the two do not fit.
                    '[@container(min-width:56rem)]:flex-wrap',
                    chip,
                  )}
                >
                  <dt className="flex min-w-0 items-baseline gap-1.5 [@container(min-width:56rem)]:flex-auto">
                    <Mark size={12} aria-hidden className={cn('shrink-0 translate-y-[2px]', toneText(tone))} />
                    {measure.t}
                  </dt>
                  <dd className="shrink-0 font-mono font-medium text-ink [@container(min-width:56rem)]:ml-auto">
                    {measure.v}
                    <span className="sr-only">, {says}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
      </div>

      {home ? (
        <footer className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-hairline px-3.5 py-[9px]">
          <p className="text-[12px] text-ink-muted">{home.label}</p>
          <Button type="button" size="sm" onClick={() => home.onOpen()}>
            Open the map
          </Button>
        </footer>
      ) : null}
    </Card>
  );
}
