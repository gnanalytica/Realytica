/**
 * What has gone out of date on a case.
 *
 * --- Why this is derived and never stored --------------------------------
 *
 * A staleness report frozen into a `ScreenResult` would be a statement about
 * how old things were on the day the screen ran, which is the one thing the
 * reader does not need to know. It has to be computed against the moment it
 * is read, or it becomes the stalest item on its own list. Same decision as
 * `RunGraph` and the title graph, for a sharper reason.
 *
 * --- Why it is worth having at all ---------------------------------------
 *
 * Every statutory figure in a State Pack already carries an `asOf`, and the
 * comment above the Karnataka duty slabs says outright that these are "the
 * numbers most likely to have moved". An encumbrance certificate covers a
 * period that ends. A K-RERA registration expires. A khata extract older than
 * a year gets handed back across the counter. The screen consumed every one
 * of those and never once asked how old it was — so a case screened eight
 * months ago against superseded guidance values looked exactly like one
 * screened this morning.
 *
 * --- The distinction that keeps it honest --------------------------------
 *
 * Nothing here says a figure *is* wrong. It says a figure is carried from a
 * date, and states how long ago that was, and names what refreshes it. "This
 * is old" and "this is incorrect" are different claims, and only the first
 * one is supportable from a date.
 */

import type {
  CaseDocument,
  PropertyCase,
  ReferenceData,
  RiskSeverity,
  StaleItem,
  StalenessReport,
  StatePack,
} from './types';
import { resolveStatePack } from './reference';

const DAY_MS = 86_400_000;

/* ==================================================================== */
/* Thresholds                                                            */
/* ==================================================================== */

/**
 * How long each kind of thing stays current, in days.
 *
 * Written as a table with reasons rather than as inline numbers because
 * every one of these is a judgement about Indian conveyancing practice that
 * someone may reasonably want to argue with — and arguing with a number is
 * only possible when you can find it.
 */
const THRESHOLDS = {
  /**
   * A screen older than a quarter has watched the market move under it;
   * older than two, it predates a likely guidance-value revision.
   */
  screenWarn: 90,
  screenSerious: 180,
  /**
   * Karnataka revises guidance values and periodically the duty structure.
   * Eighteen months without reconfirmation is where a figure stops being
   * something to rely on and becomes something to check.
   */
  referenceWarn: 548,
  referenceSerious: 1095,
  /**
   * An encumbrance search is a snapshot of a register that anyone may add to
   * the next morning. Thirty days is the point at which a lender or a
   * purchaser's counsel will ask for a fresh one; ninety is where relying on
   * it becomes a decision rather than an oversight.
   */
  registerSearchWarn: 30,
  registerSearchSerious: 90,
  /** A planning position is a snapshot of a zoning regime that gets revised. */
  planningWarn: 180,
  /**
   * A khata extract, encumbrance certificate or tax receipt older than a
   * year is routinely refused by the counterparty's lawyer, whatever it
   * says. This is a practice threshold, not a legal one.
   */
  documentWarn: 365,
  documentSerious: 730,
  /** An expiry inside this window is close enough to matter to a transaction. */
  expiryHorizon: 90,
} as const;

/** Document kinds whose usefulness genuinely decays with age. */
const AGE_SENSITIVE: Partial<Record<CaseDocument['kind'], { label: string; refresh: string }>> = {
  khata_extract: {
    label: 'Khata extract',
    refresh: 'Obtain a current khata extract from the BBMP/panchayat counter — a purchaser\'s lawyer will ask for one issued within the last year.',
  },
  encumbrance_certificate: {
    label: 'Encumbrance certificate',
    refresh: 'Obtain a fresh Form 15/16 encumbrance certificate running up to the current date from the jurisdictional Sub-Registrar.',
  },
  property_tax_receipt: {
    label: 'Property tax receipt',
    refresh: 'Obtain the paid receipt for the current assessment year — an unpaid year is a charge on the property and is the buyer\'s problem after completion.',
  },
  form_9_11: {
    label: 'Form 9 & 11',
    refresh: 'Obtain current Form 9 and Form 11 extracts from the gram panchayat.',
  },
};

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / DAY_MS);
}

function severityFor(ageDays: number, warn: number, serious: number): RiskSeverity | null {
  if (ageDays >= serious) return 'serious';
  if (ageDays >= warn) return 'warning';
  return null;
}

/** The four-digit year at the end of a period string like "2010–2024" or "2010-2024". */
function trailingYear(text: string): number | undefined {
  const years = text.match(/\b(19|20)\d{2}\b/g);
  if (!years || years.length === 0) return undefined;
  return Number(years[years.length - 1]);
}

function fieldValue(doc: CaseDocument, key: string): string | undefined {
  return doc.extracted.find(f => f.key === key)?.value;
}

/**
 * Every `asOf` the state pack carries, so the oldest can be reported rather
 * than an arbitrary one. Listed explicitly rather than reflected over the
 * object because a future non-`StatutoryRule` field with an `asOf`-shaped
 * property would silently join the list.
 */
function packRules(pack: StatePack): { label: string; asOf: string; source: string }[] {
  return [
    { label: 'Stamp duty slabs', asOf: pack.stampDutySlabs.asOf, source: pack.stampDutySlabs.source },
    { label: 'Stamp duty cess', asOf: pack.stampDutyCessPct.asOf, source: pack.stampDutyCessPct.source },
    { label: 'Stamp duty surcharge', asOf: pack.stampDutySurchargePct.asOf, source: pack.stampDutySurchargePct.source },
    { label: 'Registration fee', asOf: pack.registrationFeePct.asOf, source: pack.registrationFeePct.source },
    { label: 'Drain and lake buffer distances', asOf: pack.buffers.asOf, source: pack.buffers.source },
  ];
}

/**
 * How old one statutory figure is, and whether that is worth saying.
 *
 * Exported because the report is not the only place this question is asked.
 * The report answers "what on this case has aged"; a reader looking at a
 * stamp-duty line asks the narrower "how old is *this* number", and until
 * this existed the interface could only answer with the date it was carried
 * from — which is the same answer on the day the figure was written as on the
 * day it is four years out.
 *
 * Same thresholds and same arithmetic as the report, from the same constants,
 * so a figure the report calls serious cannot read as current beside it.
 */
export function statutoryAge(asOf: string, now: string = new Date().toISOString()): {
  ageDays: number;
  severity: RiskSeverity | null;
} {
  const ageDays = daysBetween(asOf, now);
  return { ageDays, severity: severityFor(ageDays, THRESHOLDS.referenceWarn, THRESHOLDS.referenceSerious) };
}

/**
 * Every statutory figure in a pack, with its age — the report's own pack
 * section, minus the case.
 *
 * The report needs a `PropertyCase` because most of what ages is on the case:
 * a register search, a khata extract, a RERA registration. The pack's figures
 * are the exception. They age for everybody, identically, and depend on no
 * case at all — which is why a project (which is not a `PropertyCase`) could
 * never ask the question, and why the whole mechanism went unrendered on the
 * surface people actually use.
 */
export function packStaleness(
  pack: StatePack,
  now: string = new Date().toISOString(),
): {
  label: string;
  asOf: string;
  source: string;
  ageDays: number;
  severity: RiskSeverity | null;
}[] {
  return packRules(pack)
    .map((rule) => ({ ...rule, ...statutoryAge(rule.asOf, now) }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

export function buildStaleness(caseData: PropertyCase, refData: ReferenceData, now: string): StalenessReport {
  const items: StaleItem[] = [];
  const asOfDates: string[] = [];

  const push = (item: StaleItem): void => {
    items.push(item);
    asOfDates.push(item.asOf);
  };

  /* -- Register searches ----------------------------------------------- */

  /*
   * This is the watch the staleness report was always missing something to
   * watch. Until records could be fetched, the only encumbrance certificate
   * on a case was one somebody uploaded, and its age was tracked as a
   * document. A register *search* ages differently and for a different
   * reason: a document ages because a counterparty stops accepting it, and a
   * search ages because somebody may have registered a charge the morning
   * after it ran. Thirty days of that is a real exposure, and it is invisible
   * unless it is stated.
   */
  for (const search of caseData.registerSearches ?? []) {
    const age = daysBetween(search.retrievedAt, now);
    const severity = severityFor(age, THRESHOLDS.registerSearchWarn, THRESHOLDS.registerSearchSerious);
    if (!severity) continue;
    push({
      key: `register:${search.kind}`,
      kind: 'register_search',
      label: search.label,
      what:
        `This register was searched ${age} days ago${search.nilResult ? ' and came back nil' : ''}. ` +
        'A register search is a snapshot: anything registered against the title since that date does not appear in it, ' +
        `and ${search.nilResult ? 'a nil result is only nil as at the search date' : 'the position may have moved'}.`,
      asOf: search.retrievedAt,
      ageDays: age,
      severity,
      refresh: search.refresh,
    });
  }

  /* -- The screen itself ---------------------------------------------- */

  const result = caseData.result;
  if (result) {
    const age = daysBetween(result.generatedAt, now);
    const severity = severityFor(age, THRESHOLDS.screenWarn, THRESHOLDS.screenSerious);
    if (severity) {
      push({
        key: 'screen',
        kind: 'screen',
        label: 'This screen',
        what: `The valuation, risks and compliance position on this case were computed ${age} days ago against the market and statutory data of that date. Comparables have transacted since, and guidance values are revised on a cycle shorter than this.`,
        asOf: result.generatedAt,
        ageDays: age,
        severity,
        refresh: 'Re-run the screen. It is free and takes seconds, and everything below is recomputed with it.',
      });
    }
  }

  /* -- Statutory figures the screen relied on -------------------------- */

  // Collapsed to a single item rather than one per rule, and the reason is
  // the reason this list is worth reading at all.
  //
  // The pack's age is a fact about this deployment, not about this case: it
  // is identical on every Karnataka case in the system. Emitting it five
  // times — duty slabs, cess, surcharge, registration fee, buffers — would
  // put five permanent entries at the top of every report, above an expired
  // RERA registration and an encumbrance certificate two years short. A list
  // whose first five entries never change and never apply to the case in
  // front of you is a list people stop reading, and then the sixth entry, the
  // one that mattered, goes unread with it.
  //
  // So: one line, the oldest date, the count, and every source named in it.
  // Same resolver as the engine's. A third copy of this test is how the
  // staleness view comes to disagree with the screen about which pack is even
  // in force.
  const statePack = resolveStatePack(caseData.identity, refData.statePacks);
  if (statePack) {
    // Through `packStaleness` rather than repeating the filter: two copies of
    // "which figures count as aged" is how the report and the line beside the
    // number come to disagree about the same date.
    const aged = packStaleness(statePack, now).filter((rule) => rule.severity !== null);

    if (aged.length > 0) {
      const oldest = aged[0];
      push({
        key: 'reference_data',
        kind: 'reference_data',
        label: `Statutory figures for ${statePack.state}`,
        what:
          `${aged.length} statutory figure${aged.length === 1 ? '' : 's'} this screen relies on ${aged.length === 1 ? 'is' : 'are'} carried from dates that have passed — ` +
          `${aged.map(r => `${r.label.toLowerCase()} (${r.asOf})`).join(', ')}. The oldest is ${oldest.ageDays} days old. ` +
          'This applies to every case in this deployment, not only to this property, and every acquisition-cost figure shown is only as current as those dates.',
        asOf: oldest.asOf,
        ageDays: oldest.ageDays,
        severity: severityFor(oldest.ageDays, THRESHOLDS.referenceWarn, THRESHOLDS.referenceSerious) ?? 'warning',
        refresh: `Reconfirm against the source of record before relying on any figure they produce: ${[...new Set(aged.map(r => r.source))].join('; ')}.`,
      });
    }
  }

  /* -- Planning ------------------------------------------------------- */

  if (result) {
    const age = daysBetween(result.planning.lastCheckedAt, now);
    if (age >= THRESHOLDS.planningWarn) {
      push({
        key: 'planning',
        kind: 'planning',
        label: 'Planning position',
        what: `Zoning, permitted uses and FAR were last checked ${age} days ago against ${result.planning.source}. A master-plan revision or a road-widening notification since then would change what can be built here.`,
        asOf: result.planning.lastCheckedAt,
        ageDays: age,
        severity: 'warning',
        refresh: 'Re-confirm the zoning and FAR band for this survey number with the planning authority.',
      });
    }
  }

  /* -- Documents that decay -------------------------------------------- */

  for (const doc of caseData.documents) {
    const spec = AGE_SENSITIVE[doc.kind];
    if (!spec) continue;
    const age = daysBetween(doc.uploadedAt, now);
    const severity = severityFor(age, THRESHOLDS.documentWarn, THRESHOLDS.documentSerious);
    if (!severity) continue;
    push({
      key: `document:${doc.id}`,
      kind: 'document',
      label: spec.label,
      what: `${doc.fileName} has been on file ${age} days. A counterparty's lawyer will ask for a recent one whatever this says, so an old copy is a delay waiting to happen rather than a defect.`,
      asOf: doc.uploadedAt,
      ageDays: age,
      severity,
      refresh: spec.refresh,
    });
  }

  /* -- Periods and expiries -------------------------------------------- */

  const nowYear = new Date(now).getFullYear();

  for (const doc of caseData.documents) {
    // An encumbrance certificate proves nothing about the period after the
    // one it covers, and that period is the one the buyer is exposed to. This
    // is the single most misread document in an Indian file: people treat a
    // clean EC as a clean title rather than as a clean *window*.
    if (doc.kind === 'encumbrance_certificate') {
      const period = fieldValue(doc, 'ecPeriod');
      const endYear = period ? trailingYear(period) : undefined;
      if (endYear !== undefined && endYear < nowYear) {
        const yearsUncovered = nowYear - endYear;
        push({
          key: `ec_period:${doc.id}`,
          kind: 'expiry',
          label: 'Encumbrance certificate period',
          what: `${doc.fileName} covers ${period}, so it says nothing about charges, mortgages or litigation registered in the ${yearsUncovered} year${yearsUncovered === 1 ? '' : 's'} since. A clean certificate is a clean window, not a clean title.`,
          asOf: `${endYear}-12-31`,
          ageDays: daysBetween(`${endYear}-12-31`, now),
          severity: yearsUncovered >= 2 ? 'serious' : 'warning',
          refresh: 'Obtain a fresh encumbrance certificate running to the current date before completion — and again immediately before registration.',
        });
      }
    }

    if (doc.kind === 'rera_registration') {
      const validTill = fieldValue(doc, 'reraValidTill');
      const expiry = validTill ? Date.parse(validTill) : Number.NaN;
      if (Number.isFinite(expiry)) {
        const daysLeft = Math.floor((expiry - Date.parse(now)) / DAY_MS);
        if (daysLeft < THRESHOLDS.expiryHorizon) {
          push({
            key: `rera:${doc.id}`,
            kind: 'expiry',
            label: 'RERA registration',
            what:
              daysLeft < 0
                ? `The registration on file expired ${Math.abs(daysLeft)} days ago (${validTill}). Marketing an unregistered project is an offence under the Act, and an expired registration affects what the promoter can lawfully do next.`
                : `The registration on file expires in ${daysLeft} days (${validTill}), which is inside the window a transaction of this kind takes.`,
            asOf: validTill ?? now,
            ageDays: Math.max(0, -daysLeft),
            severity: daysLeft < 0 ? 'serious' : 'warning',
            refresh: 'Check the current registration status on the K-RERA portal and obtain the extension or renewal if one has been granted.',
          });
        }
      }
    }

    if (doc.kind === 'property_tax_receipt') {
      const assessment = fieldValue(doc, 'assessmentYear');
      const year = assessment ? trailingYear(assessment) : undefined;
      if (year !== undefined && year < nowYear) {
        push({
          key: `tax_year:${doc.id}`,
          kind: 'expiry',
          label: 'Property tax assessment year',
          what: `The receipt on file is for ${assessment}. Tax for ${year + 1}${nowYear > year + 1 ? ` onwards` : ''} is not evidenced, and unpaid property tax is a charge that follows the property to its new owner.`,
          asOf: `${year}-12-31`,
          ageDays: daysBetween(`${year}-12-31`, now),
          severity: nowYear - year >= 2 ? 'serious' : 'warning',
          refresh: 'Obtain the paid receipt for every assessment year up to the current one.',
        });
      }
    }
  }

  /* -- The map lookup --------------------------------------------------- */

  const site = caseData.siteContext;
  if (site?.location) {
    const current = siteContextInput(caseData.identity);
    if (site.location.queried !== current) {
      push({
        key: 'site_context',
        kind: 'site_context',
        label: 'Location on the map',
        what: `The pin and everything measured from it were built from "${site.location.queried}". The case now records "${current}". Every distance shown on the location view was measured from the old one.`,
        asOf: site.builtAt,
        ageDays: daysBetween(site.builtAt, now),
        severity: 'warning',
        refresh: 'Rebuild the location from the Location view so the map and the distances describe the place the case actually holds.',
      });
    }
  }

  /* -- Assemble --------------------------------------------------------- */

  const order: Record<RiskSeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };
  items.sort((a, b) => (order[a.severity] !== order[b.severity] ? order[a.severity] - order[b.severity] : b.ageDays - a.ageDays));

  const oldestAsOf = asOfDates.length > 0 ? asOfDates.slice().sort()[0] : null;

  // Counted separately because they are answered by different people. A
  // case-level item is something this buyer goes and obtains; the reference
  // item is something whoever maintains this deployment updates. Reporting
  // them as one number would tell the buyer they have more to do than they do.
  const caseItems = items.filter(i => i.kind !== 'reference_data');
  const caseSerious = caseItems.filter(i => i.severity === 'serious' || i.severity === 'critical').length;
  const referenceItem = items.find(i => i.kind === 'reference_data');
  const referenceNote = referenceItem ? ` Separately, the statutory figures this deployment carries were last confirmed ${referenceItem.ageDays} days ago, which affects every case here rather than this one.` : '';

  /*
   * One clause, then the caveat, then the aside.
   *
   * The old version welded all three into a single 57-word sentence that
   * opened with "1 of 1 item ... are" — a plural agreement bug that only
   * appears at exactly one item, which is the common case. It also stated
   * "nothing below is asserted to be wrong" before the reader had seen
   * anything below.
   *
   * `splitLead` on the rendering side takes the first sentence as the
   * scannable claim, so the claim is now short by construction and everything
   * after it folds.
   */
  const plural = caseItems.length === 1 ? '' : 's';
  const headline =
    caseItems.length === 0
      ? `Nothing on this case has aged past the point where it needs rechecking. That is a statement about dates, not about correctness.${referenceNote}`
      : caseSerious > 0
        ? `${caseSerious} of ${caseItems.length} item${plural} here ${caseSerious === 1 ? 'is' : 'are'} old enough that a counterparty will question ${caseSerious === 1 ? 'it' : 'them'}. Nothing below is asserted to be wrong — each is carried from a date, and that date has passed.${referenceNote}`
        : `${caseItems.length} item${plural} ${caseItems.length === 1 ? 'is' : 'are'} approaching the point where ${caseItems.length === 1 ? 'it needs' : 'they need'} rechecking. Nothing below is asserted to be wrong — each is carried from a date, and that date is getting old.${referenceNote}`;

  return { checkedAt: now, items, oldestAsOf, headline };
}

/**
 * The address string a site-context lookup was, or would be, built from.
 *
 * Defined here rather than beside the place provider because the staleness
 * check needs it and the shared package cannot depend on the agents package.
 * The provider imports this one — there is a single definition, and a drift
 * between the two would show up as a location that rebuilds on every read or
 * never rebuilds at all.
 */
/**
 * What the site context would be built from right now.
 *
 * One step above {@link siteContextQuery}, and the string both the cache and
 * the staleness check compare against — because a case that states its own
 * coordinate is not geocoded at all, and comparing such a pin against an
 * address it never used would report it stale on every read.
 */
export function siteContextInput(identity: PropertyCase['identity']): string {
  const point = identity.statedPoint;
  return point ? `${point.lat}, ${point.lng}` : siteContextQuery(identity);
}

export function siteContextQuery(identity: PropertyCase['identity']): string {
  return [identity.addressLine, identity.locality, identity.city, identity.state, identity.postalCode]
    .map(part => (part ?? '').trim())
    .filter(part => part.length > 0)
    .join(', ');
}
