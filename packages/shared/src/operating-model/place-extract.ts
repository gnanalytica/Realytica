/**
 * Reading WHERE a property is out of the documents that say so.
 *
 * The pin, the map, Street View, the nearby list, the locality rate and every
 * connector route hang off two fields on the project: `siteAddress` and
 * `parcelId`. Both have existed since the screen was written. Nothing fills
 * them. So a file can carry an encumbrance certificate whose subject line
 * names twelve survey numbers, a RERA certificate with the project's postal
 * address, and a site plan with a coordinate — and still report "no geocoded
 * pin on this project, so there is nothing to overlay".
 *
 * This reads those out of what was uploaded. Three rules shape it:
 *
 * **A document says; it does not settle.** Everything here becomes a card
 * somebody approves, never a write. A survey number read off a scan is that
 * scan's claim about the parcel, and the difference between a claim and a
 * record is the whole product.
 *
 * **Karnataka survey numbers have a shape, and it is not "any number".** They
 * run `50/2`, `51/2B1`, `53/1`, `51/2C2` — a number, a slash, then a
 * subdivision that may carry letters. Matched on that shape and only where a
 * survey word introduces it, because a Karnataka deed is also full of dates,
 * rule numbers, khata numbers and registration numbers with slashes in them.
 *
 * **A coordinate is a pin, not a boundary.** Same constraint the site-context
 * model enforces everywhere else: reading `12.9352, 77.6245` off a site plan
 * places the property, it does not bound it.
 */

import type { ChatIngestFile, ChatProposal, DdProject, PatchProjectInput } from './types';
import { createChatProposal } from './wizard';

/**
 * A Karnataka survey number, introduced by a survey word.
 *
 * The introducer is not decoration. `50/2` on its own is indistinguishable
 * from a rule reference, a date fragment or a khata number, and a parcel id
 * invented from one of those would send every connector lookup to the wrong
 * land. The subdivision allows letters and further slashes — `51/2B1` and
 * `51/2C2` are both real, and both appear in the same certificate.
 */
const SURVEY_BLOCK = /\b(?:sy\.?\s*(?:no\.?|nos\.?)?|survey\s*(?:no\.?|nos\.?|numbers?)?)\s*[:.]?\s*((?:\d+\/[\dA-Z]+(?:\/[\dA-Z]+)?)(?:\s*(?:,|and|&)\s*(?:\d+\/[\dA-Z]+(?:\/[\dA-Z]+)?))*)/gi;

/** One survey number inside a matched block. */
const SURVEY_ONE = /\d+\/[\dA-Z]+(?:\/[\dA-Z]+)?/gi;

/**
 * A decimal lat/lng pair.
 *
 * Bounded to India rather than the whole globe: a document that yields
 * `52.37, 4.89` has produced Amsterdam, and silently pinning a Bengaluru file
 * there is worse than finding nothing. Degrees-minutes-seconds is deliberately
 * not parsed — it appears on survey sketches in forms too varied to read
 * safely, and a mis-parsed DMS is a pin in a different taluk.
 */
const LATLNG = /(\d{1,2}\.\d{4,})\s*[°NnSs]?\s*[,/]\s*(\d{2,3}\.\d{4,})\s*[°EeWw]?/g;

/** India's bounding box, generously. Outside it, we found something else. */
const IN_BOUNDS = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 98 };

/** Every scrap of text an uploaded file gives us to read. */
function readable(file: ChatIngestFile): string {
  return [file.excerpt, file.extractionNotes, ...(file.quotes ?? []).map((q) => q.text)]
    .filter(Boolean)
    .join('\n');
}

/**
 * Survey numbers a document names, de-duplicated, in the order it names them.
 *
 * Order matters more than it looks: an EC subject line lists the parcel in the
 * order the schedule does, and a valuer reading the card should see the same
 * sequence they will see on the certificate.
 */
export function extractSurveyNumbers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const block of text.matchAll(SURVEY_BLOCK)) {
    for (const one of (block[1] ?? '').matchAll(SURVEY_ONE)) {
      const value = one[0].toUpperCase();
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** A coordinate a document states, when it is plausibly in India. */
export function extractCoordinate(text: string): { lat: number; lng: number } | undefined {
  for (const hit of text.matchAll(LATLNG)) {
    const lat = Number(hit[1]);
    const lng = Number(hit[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < IN_BOUNDS.latMin || lat > IN_BOUNDS.latMax) continue;
    if (lng < IN_BOUNDS.lngMin || lng > IN_BOUNDS.lngMax) continue;
    return { lat, lng };
  }
  return undefined;
}

/** How a parcel of several survey numbers is written on a Karnataka file. */
export function formatParcelId(numbers: readonly string[]): string {
  return numbers.join(', ');
}

/**
 * The administrative place a Karnataka document puts the parcel in.
 *
 * Karnataka land records do not carry a street address. They carry a chain of
 * revenue divisions — village, hobli, taluk, district — and an encumbrance
 * certificate's subject line ends `of Balagere Village, Varthur Hobli`. That
 * chain is the only address most of these files hold, and it is enough for a
 * geocoder to place the neighbourhood even though it will never place the plot.
 */
const PLACE_LABELS = ['village', 'hobli', 'taluk', 'taluka', 'taluq', 'district'] as const;

/**
 * Words that cannot be part of a place name.
 *
 * Two jobs, and both of them are about where a name *stops*. The connectives
 * are how a deed introduces a place — `of land situated at Balagere Village` —
 * and none of them belong in the name. The division labels are here because a
 * regex that allows three words before `Village` will happily read
 * `Balagere Village and Panathur Village` as one village called
 * "Balagere Village And Panathur": the longest match wins, and the longest
 * match is wrong. Barring the labels from the inside of a name stops that.
 */
const NOT_INSIDE_A_NAME = [
  ...PLACE_LABELS,
  'and', 'or', 'of', 'at', 'in', 'the', 'situated', 'situate', 'lying', 'being',
  'bearing', 'within', 'limits', 'no', 'nos', 'sy', 'survey', 'number', 'numbers',
  'property', 'land', 'schedule', 'above', 'all', 'that', 'piece', 'parcel', 'to',
];

/**
 * Up to four words then a division label. `Bengaluru East Taluk` and
 * `Bangalore Urban District` are both real and both matter, so one word is not
 * enough; every word is checked against {@link NOT_INSIDE_A_NAME} so the run
 * cannot reach back across a connective or another division.
 */
const NAME_WORD = `(?!(?:${NOT_INSIDE_A_NAME.join('|')})\\b)[A-Za-z][A-Za-z.'-]*`;
const PLACE_PART = new RegExp(`\\b((?:${NAME_WORD}\\s+){0,3}${NAME_WORD})\\s+(${PLACE_LABELS.join('|')})\\b`, 'gi');

/** The order a Karnataka address is written in, narrowest first. */
const PLACE_ORDER = ['village', 'hobli', 'taluk', 'district'] as const;

function normaliseLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower === 'taluka' || lower === 'taluq') return 'taluk';
  return lower;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The administrative address a document states, written the way the document
 * writes it: `Balagere Village, Varthur Hobli`.
 *
 * Narrowest division first, one of each. A file that names two villages is
 * describing two parcels or quoting a neighbour's boundary, and picking one of
 * them to put on the record would be inventing which.
 */
export function extractPlaceLine(text: string): string {
  const found = new Map<string, string>();
  for (const hit of text.matchAll(PLACE_PART)) {
    const label = normaliseLabel(hit[2] ?? '');
    if (found.has(label)) continue;
    const words = (hit[1] ?? '').split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    found.set(label, `${words.map(titleCase).join(' ')} ${titleCase(label)}`);
  }
  return PLACE_ORDER.map((label) => found.get(label))
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

/**
 * Cards proposing what these documents say about where the property is.
 *
 * Proposes only what the project does not already hold — a file that already
 * names its parcel does not need a card telling it so, and a card that would
 * change a recorded parcel id is a different and much more serious act than
 * filling a blank one. Nothing here overwrites.
 *
 * At most one card per field, from the first document that says something
 * about it. A second certificate naming the same village adds nothing a person
 * has to decide about, and two cards for one field is a choice nobody asked
 * for.
 */
export function placeProposalsFromIngest(
  project: DdProject,
  files: readonly ChatIngestFile[],
  actor = 'operator',
): ChatProposal[] {
  const out: ChatProposal[] = [];
  const wantParcel = !project.parcelId;
  const wantAddress = !project.siteAddress;
  if (!wantParcel && !wantAddress) return out;

  let parcelDone = !wantParcel;
  let addressDone = !wantAddress;

  for (const file of files) {
    if (parcelDone && addressDone) break;
    const text = readable(file);
    if (!text) continue;

    const coordinate = extractCoordinate(text);
    // The coordinate rides on whichever card this document produces, and on
    // only one of them. It is stated, not verified, and it places the site
    // without bounding it — the same thing the site-context model says about
    // every pin it draws.
    const stated = coordinate
      ? ` It also states ${coordinate.lat}, ${coordinate.lng}, which places the site without bounding it.`
      : '';
    let spoken = false;

    if (!parcelDone) {
      const numbers = extractSurveyNumbers(text);
      if (numbers.length > 0) {
        const parcelId = formatParcelId(numbers);
        const patch: PatchProjectInput = { parcelId };
        out.push(
          createChatProposal(
            'patch_project',
            `Record the parcel as ${numbers.length === 1 ? numbers[0] : `${numbers.length} survey numbers`}`,
            `${file.fileName} names ${parcelId}. Reading it off the document, not verifying it — the RTC and the encumbrance certificate settle what the parcel is.${stated}`,
            'Sets the parcel on the project record, which is what the register searches and the map lookup key off.',
            patch as unknown as Record<string, unknown>,
            actor,
          ),
        );
        parcelDone = true;
        spoken = true;
      }
    }

    if (!addressDone) {
      const siteAddress = extractPlaceLine(text);
      if (siteAddress) {
        const patch: PatchProjectInput = { siteAddress };
        out.push(
          createChatProposal(
            'patch_project',
            `Record the address as ${siteAddress}`,
            `${file.fileName} places the parcel in ${siteAddress}. That is the revenue division, not a street address: it will find the neighbourhood on a map and it will never find the plot.${spoken ? '' : stated}`,
            'Fills the site address, which is what the geocoder is given — approving it moves the pin, the distances and Street View to this place.',
            patch as unknown as Record<string, unknown>,
            actor,
          ),
        );
        addressDone = true;
      }
    }
  }
  return out;
}
