
// Site intelligence — one lookup, end to end.
//
// Two ways in. A survey number, which is how an owner thinks about their land,
// resolves to a cadastral parcel and takes its centroid and its surveyed extent
// from the state's own record. A dropped pin, which is how a buyer looks at a
// listing, is matched against the cadastre and falls back to the bare point
// when the parcel is not published. Either way the rest is the same: read the
// GIS around the location, turn what it finds into factors a person can act on,
// ask for the handful of facts no public layer holds, and price the result as a
// band.
//
// The pure stages (`factors`, `parcel-factors`, `questions`, `estimate`) are
// separately testable; this file is only the wiring plus the refusals that
// matter — outside Telangana, and without an area.

import type { LatLng } from "./geo/measure";
import { queryLayers } from "./arcgis";
import { buildAreaMap, deriveInsights } from "./area-map";
import type { ParcelRecord } from "./cadastre";
import { deriveFactors, sortFactors } from "./factors";
import { buildEstimate, estimateConfidence } from "./estimate";
import { resolveRate } from "./guidance-rates";
import { layersFor } from "./layers";
import { deriveKaFactors } from "./karnataka/factors";
import { kaveriRoads, kaveriVillagesFor } from "./karnataka/rates";
import { kaVillageByCode } from "./karnataka/village-index";
import { parseParcelRef } from "./cadastre";
import type { FollowUpQuestion } from "./types";
import { stateAt } from "./states";
import { extentMismatchFactor, parcelFactors } from "./parcel-factors";
import { findParcelAt, getParcel } from "./parcels";
import { factorsFromAnswers, outstandingQuestions } from "./questions";
import type { SiteIntelReport, SubjectKind } from "./types";

export type SiteIntelInput = {
  /** A dropped pin. Ignored when `parcelId` resolves. */
  point?: LatLng | null;
  /** A cadastral parcel chosen by survey number, as `<source>:<id>`. Wins over `point`. */
  parcelRef?: string | null;
  kind: SubjectKind;
  /** Omit to use the parcel's own surveyed extent. */
  area?: number | null;
  areaUnit?: string;
  answers?: Record<string, string | number | boolean>;
  /** What the owner or a local broker says the going rate is. Beats the snapshot. */
  knownRatePerUnit?: number | null;
};

export type SiteIntelOutcome =
  | { ok: true; report: SiteIntelReport }
  | { ok: false; reason: "out_of_coverage" | "bad_input" | "not_found"; message: string };

const OUT_OF_COVERAGE =
  "This tool reads the state's own GIS for Telangana and the Bengaluru region of Karnataka. Locations outside those need their layers mapped first.";

/**
 * Resolve whichever the caller gave us into a point and, where the cadastre has
 * it, the parcel. A parcel lookup that fails at the network is not fatal: the
 * pin still produces a useful report, and the failure is recorded as a gap.
 */
async function resolveSubject(input: SiteIntelInput): Promise<
  | { ok: true; point: LatLng; parcel: ParcelRecord | null; gaps: { layer: string; reason: string }[] }
  | { ok: false; reason: "bad_input" | "not_found"; message: string }
> {
  const gaps: { layer: string; reason: string }[] = [];

  if (input.parcelRef) {
    const res = await getParcel(input.parcelRef);
    if (!res.ok) {
      return {
        ok: false,
        reason: "not_found",
        message: `The survey-number map could not be read (${res.detail}). Try again, or drop a pin on the location instead.`,
      };
    }
    if (!res.data) {
      return {
        ok: false,
        reason: "not_found",
        message: "That survey number is no longer in the published cadastre.",
      };
    }
    return { ok: true, point: res.data.centroid, parcel: res.data, gaps };
  }

  const point = input.point;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { ok: false, reason: "bad_input", message: "A survey number or a location is required." };
  }

  const found = await findParcelAt(point);
  if (!found.ok) {
    gaps.push({
      layer: "Survey-number cadastre",
      reason: "The cadastre did not respond, so the survey number could not be identified.",
    });
    return { ok: true, point, parcel: null, gaps };
  }
  return { ok: true, point, parcel: found.data, gaps };
}

export async function runSiteIntel(input: SiteIntelInput): Promise<SiteIntelOutcome> {
  const { kind } = input;

  const subject = await resolveSubject(input);
  if (!subject.ok) return subject;

  const { point, parcel } = subject;
  // The parcel knows its state; a bare pin is placed by its coordinates.
  const state = parcel?.state ?? stateAt(point);
  if (!state) {
    return { ok: false, reason: "out_of_coverage", message: OUT_OF_COVERAGE };
  }

  // A parcel carries its own surveyed extent, so the area question only has to
  // be asked when there is no parcel — or when the user is buying part of one.
  const areaUnit = input.areaUnit ?? "sqyd";
  const area =
    input.area && input.area > 0 ? input.area : parcel ? parcel.areaSqyd : 0;

  const answers = input.answers ?? {};
  const outcomes = await queryLayers(point, layersFor(state));
  const derived =
    state === "KA"
      ? (() => {
          const ka = deriveKaFactors(outcomes, kind);
          return {
            factors: ka.factors,
            gaps: ka.gaps,
            place: { village: null, mandal: null, district: null, withinHmda: false, withinOrr: false },
          };
        })()
      : deriveFactors({ outcomes, kind });
  const { factors: observed, gaps: layerGaps, place } = derived;
  const areaMap = buildAreaMap(point, outcomes, state);
  const insights = deriveInsights(point, outcomes, areaMap, state);

  const fromParcel = parcel ? parcelFactors(parcel) : [];
  const mismatch =
    parcel && input.area && input.area > 0
      ? extentMismatchFactor(parcel, input.area, areaUnit)
      : null;
  const declared = factorsFromAnswers(kind, answers, state);

  // When the parcel resolved, its own row is the authority on the Section 22-A
  // listing. The point-based reading of the same register would otherwise say
  // the same thing a second time, from a neighbouring parcel's attributes.
  const PARCEL_SUPERSEDES = new Set([
    "prohibited_hard",
    "prohibited_clearance",
    "prohibited_unclassified",
  ]);
  const fromLayers = parcel ? observed.filter((f) => !PARCEL_SUPERSEDES.has(f.code)) : observed;

  const factors = sortFactors([
    ...fromParcel,
    ...(mismatch ? [mismatch] : []),
    ...fromLayers,
    ...declared,
  ]);

  // The parcel's own village beats a village inferred from an overlapping
  // layer: it is the name the revenue record uses, which is the name the
  // guidance-value table is keyed on.
  const resolvedPlace = parcel
    ? {
        ...place,
        village: parcel.village ?? place.village,
        mandal: parcel.mandal ?? place.mandal,
        district: parcel.district ?? place.district,
      }
    : place;

  // Karnataka prices land per road. The K-GIS village code joins the parcel
  // to Kaveri's table, and the roads it lists become a question — one whose
  // answer swaps the village's typical value for the road's own.
  const parsedRef = parcel?.ref ? parseParcelRef(parcel.ref) : null;
  const villageCode = parsedRef?.source === "kgis" ? parsedRef.code : null;
  const hobli = villageCode ? (kaVillageByCode(villageCode)?.hobli ?? null) : null;
  const kaveriVillages =
    state === "KA" && villageCode && parcel?.village
      ? kaveriVillagesFor(villageCode, parcel.village, hobli)
      : [];
  const roads = kaveriRoads(kaveriVillages);
  const roadAnswer = typeof answers.kaveri_road === "string" ? answers.kaveri_road : null;
  const roadQuestion: FollowUpQuestion[] =
    roads.length >= 2
      ? [
          {
            key: "kaveri_road",
            question:
              kind === "apartment"
                ? "Which apartment complex, road or layout is it in?"
                : "Which road or layout is the plot on?",
            because:
              kind === "apartment"
                ? "Karnataka publishes a separate guidance value for every named apartment complex, road and layout. Naming yours replaces the village's typical value with the one the sub-registrar would actually apply."
                : "Karnataka publishes a separate guidance value for every road and layout in a village. Naming it replaces the village's typical value with the one the sub-registrar would actually apply.",
            kind: "choice",
            options: roads.slice(0, 200).map((r) => ({ value: r.name, label: r.name })),
            required: false,
          },
        ]
      : [];

  const anchor = resolveRate(
    {
      village: resolvedPlace.village,
      mandal: resolvedPlace.mandal,
      district: resolvedPlace.district,
      state,
      villageCode,
      hobli,
    },
    kind,
    input.knownRatePerUnit,
    roadAnswer,
  );

  const estimate = anchor && area > 0 ? buildEstimate(anchor, factors, area, areaUnit) : null;

  // The Section 22-A register is joined to the municipal layer only. A rural
  // parcel therefore comes back with no prohibited entry whether or not one
  // exists, and reporting that silence as a clean result would be the most
  // damaging thing this module could do.
  const registerGap =
    parcel?.source === "rural"
      ? [
          {
            layer: "Prohibited-property register (Section 22-A)",
            reason:
              "The register is published only for municipal areas. Nothing here confirms this survey number is clear of it — check the district list at the tahsildar's office.",
          },
        ]
      : [];

  const gaps = [...subject.gaps, ...registerGap, ...layerGaps];
  const pending = [
    ...(roadAnswer ? [] : roadQuestion),
    ...outstandingQuestions(kind, answers, state),
  ];
  const confidence = estimate
    ? estimateConfidence({
        anchorBasis: anchor!.basis,
        gapCount: gaps.length,
        unansweredRequired: pending.filter((q) => q.required).length,
      })
    : null;

  return {
    ok: true,
    report: {
      subject: {
        point,
        kind,
        area,
        areaUnit,
        answers,
        surveyNo: parcel?.parcelNo ?? null,
      },
      place: resolvedPlace,
      state,
      parcel,
      factors,
      areaMap,
      insights,
      outstandingQuestions: pending,
      estimate,
      confidence,
      gaps,
      generatedAt: new Date().toISOString(),
    },
  };
}
