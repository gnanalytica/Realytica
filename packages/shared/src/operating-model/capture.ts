/**
 * What a photograph was taken FOR, and how much of what it claims can be trusted.
 *
 * A site photograph is the one piece of evidence this product collects that is
 * made rather than obtained. A deed exists whether or not anybody looks at it;
 * a photograph exists because somebody stood somewhere, on a day, for a reason.
 * All three of those facts change what the picture proves, and none of them is
 * in the file name.
 *
 * The reason it matters here rather than in the abstract: the same wall,
 * photographed twice, is four different records depending on why. A
 * pre-construction shot is a BASELINE — it exists to show what the condition
 * was before anybody touched it, and its value is entirely in its date. A
 * valuation inspection shot is a STATEMENT AS AT a valuation date, and one
 * fourteen months stale is not weak evidence, it is evidence of a different
 * property. A defect shot is an ASSERTION about a specific finding. A progress
 * shot is a claim about a percentage. Collapsing them into "photograph" throws
 * away the only thing that decides which of those a reader may rely on.
 *
 * ## Claimed, not proven
 *
 * Everything a JPEG says about itself is a CLAIM. The GPS tag is where the
 * phone believed it was; it can be wrong by a street in a canyon, absent
 * entirely (WhatsApp strips EXIF, screenshots never had it), or simply edited.
 * `DateTimeOriginal` is whatever the camera clock said, and camera clocks are
 * wrong all the time.
 *
 * So every capture fact carries its SOURCE. `exif` means it was read off the
 * file. `stated` means a person typed it. The two are not interchangeable and
 * the UI must never render them identically: "geotagged" and "somebody says
 * this is the north boundary" are different strengths of claim, and a report
 * that flattens them has overstated its own evidence. This is the same
 * derived-versus-authored split the graph, the report blocks and the computed
 * check fields already run on — a fourth surface, one idea.
 */

/** Why the shot was taken. The purpose decides what it can be relied on for. */
export type CapturePurpose =
  | 'pre_construction'
  | 'survey'
  | 'diligence_inspection'
  | 'valuation_inspection'
  | 'progress'
  | 'defect'
  | 'handover'
  | 'record';

export const CAPTURE_PURPOSES: readonly CapturePurpose[] = [
  'pre_construction',
  'survey',
  'diligence_inspection',
  'valuation_inspection',
  'progress',
  'defect',
  'handover',
  'record',
] as const;

export const CAPTURE_PURPOSE_LABEL: Record<CapturePurpose, string> = {
  pre_construction: 'Pre-construction baseline',
  survey: 'Survey / measurement',
  diligence_inspection: 'Diligence inspection',
  valuation_inspection: 'Valuation inspection',
  progress: 'Progress',
  defect: 'Defect / condition',
  handover: 'Handover / snagging',
  record: 'General record',
};

/** What each purpose is good for, and what it is not. Shown where somebody picks one. */
export const CAPTURE_PURPOSE_NOTE: Record<CapturePurpose, string> = {
  pre_construction:
    'The condition before works began. Its whole value is the date — a baseline shot with no reliable taken-at proves nothing about what changed.',
  survey: 'Taken to measure or locate something. Usually pairs with a measured figure recorded on a check.',
  diligence_inspection: 'Observed on a diligence walk. Supports a finding about condition, compliance or use.',
  valuation_inspection:
    'A statement about the property AS AT the inspection date. A valuation cites its inspection date, and a photograph older than it does not support that date.',
  progress: 'Construction progress at a moment. Read against the programme, never on its own.',
  defect: 'A specific defect, for a specific finding. Should be linked to the finding it is about.',
  handover: 'Snagging or handover condition, for the completion record.',
  record: 'Kept because it may matter later. Claims nothing on its own.',
};

/**
 * Where a capture fact came from.
 *
 * `exif` — read off the file's own metadata. The camera's claim.
 * `stated` — a person entered it. Their claim.
 *
 * There is deliberately no third value for "we worked it out". Nothing in this
 * product infers where a photograph was taken, and adding a source that meant
 * "inferred" would create somewhere for a guess to hide.
 */
export type CaptureSource = 'exif' | 'stated';

export const CAPTURE_SOURCE_LABEL: Record<CaptureSource, string> = {
  exif: 'read from the file',
  stated: 'entered by a person',
};

/**
 * Where and when a file claims it was captured.
 *
 * Every field optional, because the common case is a photograph that carries
 * none of it. A shot with no geotag is still evidence; a shot whose geotag is
 * silently invented is not.
 */
export interface CaptureFacts {
  purpose?: CapturePurpose;
  /** ISO date-time. EXIF carries no timezone, so an `exif` value is local to wherever the camera was. */
  takenAt?: string;
  takenAtSource?: CaptureSource;
  lat?: number;
  lng?: number;
  latLngSource?: CaptureSource;
  /** The asset this is about, when it is about one. */
  assetId?: string;
  /** Free text — "north boundary", "core, level 7", "STP room". */
  zone?: string;
  /** What the photographer wanted the viewer to see. */
  caption?: string;
  /** The site visit this was taken on, when it was taken on one. */
  visitId?: string;
}

/** True when the file itself carried the position, rather than a person typing it. */
export function isGeotagged(facts: CaptureFacts | undefined): boolean {
  return facts?.lat !== undefined && facts.lng !== undefined && facts.latLngSource === 'exif';
}

/**
 * One line saying what is known about the capture and how strongly.
 *
 * Written as a single function because this sentence appears in the register,
 * on the check panel, in the report and in an agent's reading of a photograph,
 * and four hand-written versions of it would disagree about the caveat within
 * a month.
 */
export function describeCapture(facts: CaptureFacts | undefined): string {
  if (!facts) return 'No capture detail recorded.';
  const parts: string[] = [];
  if (facts.purpose) parts.push(CAPTURE_PURPOSE_LABEL[facts.purpose]);
  if (facts.takenAt) parts.push(`taken ${facts.takenAt.slice(0, 10)} (${CAPTURE_SOURCE_LABEL[facts.takenAtSource ?? 'stated']})`);
  if (facts.lat !== undefined && facts.lng !== undefined) {
    parts.push(`at ${facts.lat.toFixed(5)}, ${facts.lng.toFixed(5)} (${CAPTURE_SOURCE_LABEL[facts.latLngSource ?? 'stated']})`);
  }
  if (facts.zone) parts.push(facts.zone);
  return parts.length ? parts.join(' · ') : 'No capture detail recorded.';
}

/**
 * How far a photograph's own geotag falls from where the file says it is.
 *
 * Returns metres, or null when either position is missing. The check this
 * enables is the one that matters for a site photograph: a shot said to be of
 * this property, whose camera recorded it two kilometres away, is either
 * mislabelled or of somewhere else — and either way a reader should be told
 * before it is cited.
 *
 * Haversine on a sphere. At the distances this is used for — hundreds of
 * metres to a few kilometres — the ellipsoid correction is far below the GPS
 * error already in the input, so a more elaborate formula would be false
 * precision rather than more accuracy.
 */
export function captureDistanceM(facts: CaptureFacts | undefined, site: { lat: number; lng: number } | undefined): number | null {
  if (facts?.lat === undefined || facts.lng === undefined || !site) return null;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(site.lat - facts.lat);
  const dLng = toRad(site.lng - facts.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(facts.lat)) * Math.cos(toRad(site.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * How far off is too far.
 *
 * A generous default, deliberately. Consumer GPS is routinely 20–50 m out and
 * worse between towers; a threshold tight enough to catch a genuinely
 * mislabelled photo without crying wolf on every accurate one sits well beyond
 * any plausible site. 2 km says "this is not the same place", not "your GPS
 * drifted".
 */
export const CAPTURE_OFF_SITE_M = 2_000;

/**
 * What a caller may send when describing or correcting a capture.
 *
 * `null` clears; an omitted key leaves that fact alone. The two have to be
 * distinguishable or a request that mentions only the purpose would wipe the
 * coordinates, so the nullable fields are spelled out rather than inherited
 * from `CaptureFacts` — an intersection would collapse `number | null` back
 * to `number` and quietly make clearing impossible.
 *
 * The source fields are absent on purpose. Nothing outside this product
 * decides whether a coordinate came off the file: `setAttachmentCapture` sets
 * `stated` for anything a caller sends, and only the upload path may write
 * `exif`. A client that could claim `latLngSource: 'exif'` could dress a typed
 * guess as the camera's own record.
 */
export interface CaptureFactsInput extends Omit<CaptureFacts, 'lat' | 'lng' | 'takenAt' | 'takenAtSource' | 'latLngSource'> {
  lat?: number | null;
  lng?: number | null;
  takenAt?: string | null;
}
