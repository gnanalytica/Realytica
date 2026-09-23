// The questions worth asking, and what the answers do to the estimate.
//
// A public GIS layer knows where a plot is; it does not know who approved the
// layout, how wide the road in front is, or whether the seller's brother is
// disputing it. Those are the facts that move an Indian land price most, and
// the only way to get them is to ask. Each question therefore carries the reason
// we are asking it — people answer a question about litigation honestly far more
// often when they are told it changes the number.
//
// Answers become factors with `declared` confidence and are never mixed with
// what a layer observed. Pure module: no network, no clock.

import { STATES, type StateKey } from "./states";
import type {
  FollowUpQuestion,
  SiteFactor,
  SubjectKind,
} from "./types";

const ALL: SubjectKind[] = ["open_plot", "independent_house", "apartment", "agricultural_land"];
const BUILT: SubjectKind[] = ["independent_house", "apartment"];
const LAND: SubjectKind[] = ["open_plot", "agricultural_land"];

export const SITE_QUESTIONS: FollowUpQuestion[] = [
  {
    key: "approval",
    question: "Who approved the layout or building?",
    because:
      "Approval decides whether a bank will lend against it, and an unapproved plot sells for far less than an identical approved one next door.",
    kind: "choice",
    // The authority names are the state's; see `questionsFor`.
    options: [
      { value: "hmda", label: "HMDA" },
      { value: "dtcp", label: "DTCP" },
      { value: "panchayat", label: "Gram panchayat only" },
      { value: "unapproved", label: "Not approved" },
      { value: "unknown", label: "I don't know" },
    ],
    appliesTo: ["open_plot", "independent_house", "apartment"],
    required: true,
  },
  {
    key: "regularised",
    question: "Has it been regularised under LRS or BRS?",
    because:
      "A panchayat-era layout without regularisation cannot get a building permission, and the pending fee lands on the buyer.",
    kind: "choice",
    options: [
      { value: "done", label: "Regularised" },
      { value: "applied", label: "Applied, not yet issued" },
      { value: "no", label: "Not applied" },
      { value: "na", label: "Not applicable" },
    ],
    appliesTo: ["open_plot", "independent_house"],
    required: false,
  },
  {
    key: "road_width",
    question: "How wide is the road in front, in feet?",
    because:
      "Road width sets what can legally be built — height, floors and commercial use all key off it — so it moves the rate more than most buyers expect.",
    kind: "number",
    unit: "ft",
    appliesTo: ALL,
    required: true,
  },
  {
    key: "corner",
    question: "Is it a corner plot?",
    because: "Two open sides command a real premium, especially for shop-front potential.",
    kind: "boolean",
    appliesTo: LAND.concat(["independent_house"]),
    required: false,
  },
  {
    key: "facing",
    question: "Which direction does it face?",
    because:
      "Facing carries a measurable premium in Hyderabad, not merely a sentimental one — east and north plots resell faster.",
    kind: "choice",
    options: [
      { value: "east", label: "East" },
      { value: "north", label: "North" },
      { value: "north_east", label: "North-east" },
      { value: "west", label: "West" },
      { value: "south", label: "South" },
      { value: "other", label: "Other / not sure" },
    ],
    appliesTo: ALL,
    required: false,
  },
  {
    key: "litigation",
    question: "Is there any dispute, court case or family claim on it?",
    because:
      "A disputed property trades at a heavy discount because the buyer inherits the case, and no lender will touch it until it clears.",
    kind: "boolean",
    appliesTo: ALL,
    required: true,
  },
  {
    key: "possession",
    question: "Is the plot physically fenced and in the seller's possession?",
    because:
      "Paper ownership and physical possession part company often enough in peri-urban Hyderabad that lenders check it separately.",
    kind: "boolean",
    appliesTo: LAND,
    required: false,
  },
  {
    key: "age_years",
    question: "How old is the construction, in years?",
    because: "Depreciation on the built portion is the largest single deduction on a built property.",
    kind: "number",
    unit: "years",
    appliesTo: BUILT,
    required: true,
  },
  {
    key: "oc",
    question: "Has an occupancy certificate been issued?",
    because:
      "Without an OC the building is technically unauthorised however good it looks, and several banks refuse the file outright.",
    kind: "choice",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unknown", label: "I don't know" },
    ],
    appliesTo: BUILT,
    required: false,
  },
];

/** The questions that apply to a subject and have not been answered yet. */
/**
 * The question list for a state: the same questions, with the layout
 * approval offering that state's planning authorities. A Bengaluru owner is
 * asked about BDA and BMRDA, not HMDA.
 */
export function questionsFor(state: StateKey): FollowUpQuestion[] {
  const city = STATES[state].city;
  return SITE_QUESTIONS.map((q) => {
    // The questions were written against Hyderabad; the city is the only
    // thing in them that changes with the state.
    if (q.key !== "approval") return { ...q, because: q.because.replace(/Hyderabad/g, city) };
    const generic = (q.options ?? []).filter((o) => !["hmda", "dtcp"].includes(o.value));
    return {
      ...q,
      question:
        state === "KA" ? "Who approved the layout or building?" : q.question,
      options: [...STATES[state].approvals, ...generic],
    };
  });
}

/** Approval answers that name a planning authority, in any state. */
const AUTHORITY_APPROVALS = new Set(["hmda", "dtcp", "bda", "bmrda", "bbmp"]);

export function outstandingQuestions(
  kind: SubjectKind,
  answers: Record<string, string | number | boolean>,
  state: StateKey = "TS",
): FollowUpQuestion[] {
  return questionsFor(state).filter((q) => {
    if (q.appliesTo && !q.appliesTo.includes(kind)) return false;
    const a = answers[q.key];
    return a === undefined || a === null || a === "";
  });
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function declared(
  code: string,
  label: string,
  severity: SiteFactor["severity"],
  direction: SiteFactor["direction"],
  headline: string,
  detail: string,
  low: number,
  high: number,
): SiteFactor {
  return {
    code,
    label,
    severity,
    direction,
    confidence: "declared",
    headline,
    detail,
    impactLowPct: low,
    impactHighPct: high,
    evidence: { source: "Answered by you — not independently verified" },
  };
}

export function factorsFromAnswers(
  kind: SubjectKind,
  answers: Record<string, string | number | boolean>,
  state: StateKey = "TS",
): SiteFactor[] {
  const out: SiteFactor[] = [];
  const city = STATES[state].city;
  const planningArea = state === "KA" ? "the BDA or BMRDA planning area" : "the HMDA area";

  const approval = asString(answers.approval);
  if (approval && AUTHORITY_APPROVALS.has(approval)) {
    const authority =
      STATES[state].approvals.find((o) => o.value === approval)?.label ??
      approval.toUpperCase();
    out.push(
      declared(
        `approval_${approval}`,
        `${authority}-approved layout`,
        "info",
        "uplift",
        `An approved layout is what makes the property financeable, and buyers pay for that.`,
        "Approved plots command a standing premium over panchayat layouts in the same village because the buyer pool includes everyone who needs a home loan. Verify the LP number on the sanctioning authority's own portal — the approval is claimed far more often than it is held.",
        8,
        16,
      ),
    );
  } else if (approval === "panchayat") {
    out.push(
      declared(
        "approval_panchayat",
        "Gram panchayat layout only",
        "caution",
        "drag",
        "A panchayat-only layout is not an approved layout, and most lenders will not fund it.",
        `Panchayats have no power to approve layouts inside ${planningArea}; plots in these layouts are sold as approved constantly. Without regularisation the buyer cannot get a building permission, and the resale pool shrinks to cash buyers.`,
        -22,
        -10,
      ),
    );
  } else if (approval === "unapproved") {
    out.push(
      declared(
        "approval_none",
        "Unapproved layout",
        "critical",
        "drag",
        "An unapproved layout cannot be financed and cannot be built on without regularisation.",
        "The discount here is not a negotiating position, it is the market clearing price for a plot only a cash buyer can purchase. Regularisation, where available, costs a percentage of the land value and is not guaranteed.",
        -35,
        -20,
      ),
    );
  } else if (approval === "unknown") {
    out.push(
      declared(
        "approval_unknown",
        "Approval status unknown",
        "caution",
        "drag",
        "Not knowing the approval status is itself worth a discount until it is established.",
        "This is the single cheapest thing to check and the most expensive to get wrong. The sanctioning authority's portal will confirm an LP number in minutes.",
        -15,
        -5,
      ),
    );
  }

  const regularised = asString(answers.regularised);
  if (regularised === "no") {
    out.push(
      declared(
        "lrs_pending",
        "Not regularised",
        "caution",
        "drag",
        "Regularisation has not been applied for, and the fee will fall on whoever buys it.",
        "LRS and BRS fees are charged on the land value and must be cleared before a building permission is issued, so an unregularised plot is worth the regularised price minus that cost and minus the risk that the window has closed.",
        -14,
        -6,
      ),
    );
  } else if (regularised === "applied") {
    out.push(
      declared(
        "lrs_applied",
        "Regularisation applied for",
        "info",
        "drag",
        "The application is in but the proceeding has not been issued, so the outcome is not yet certain.",
        "Buyers discount an in-flight application because the fee and the timeline are both still open. The discount closes when the proceeding is issued.",
        -7,
        -2,
      ),
    );
  }

  const road = asNumber(answers.road_width);
  if (road !== null) {
    if (road < 20) {
      out.push(
        declared(
          "road_narrow",
          "Narrow approach road",
          "caution",
          "drag",
          `A ${road} ft road caps what can be built and keeps larger buyers away.`,
          "Below about 20 ft the setback and height rules bite hard, fire access becomes a problem for anything above two floors, and commercial use is effectively closed off.",
          -14,
          -6,
        ),
      );
    } else if (road >= 40) {
      out.push(
        declared(
          "road_wide",
          "Wide approach road",
          "info",
          "uplift",
          `A ${road} ft road opens up height, floors and commercial use.`,
          "Permissible height keys off road width, so frontage on a 40 ft or wider road is what separates a plot that can carry a building from one that cannot. On 60 ft and above, commercial conversion becomes realistic and the rate steps up again.",
          road >= 60 ? 10 : 5,
          road >= 60 ? 20 : 11,
        ),
      );
    }
  }

  if (answers.corner === true) {
    out.push(
      declared(
        "corner_plot",
        "Corner plot",
        "info",
        "uplift",
        "Two open sides — better light, better access, and shop-front potential.",
        `Corner plots carry a standing premium in ${city} layouts, larger where the second road is also wide.`,
        5,
        10,
      ),
    );
  }

  const facing = asString(answers.facing);
  if (facing === "east" || facing === "north" || facing === "north_east") {
    out.push(
      declared(
        "facing_favoured",
        "Favoured facing",
        "info",
        "uplift",
        "East and north facing plots resell faster and at a premium in this market.",
        "The preference is cultural but the price effect is real and consistent, and it shows up most on resale speed rather than on the asking rate.",
        3,
        8,
      ),
    );
  } else if (facing === "south" || facing === "west") {
    out.push(
      declared(
        "facing_discount",
        "Less favoured facing",
        "info",
        "drag",
        "South and west facing plots typically take longer to sell and settle slightly lower.",
        "The discount is small and largely disappears where the plot has another strong advantage such as a wide road or a corner position.",
        -6,
        -2,
      ),
    );
  }

  if (answers.litigation === true) {
    out.push(
      declared(
        "litigation",
        "Dispute or claim",
        "critical",
        "drag",
        "A property under dispute trades far below a clear one, and no lender will fund it until the case ends.",
        "The buyer inherits the litigation along with the land. Until there is a decree or a registered settlement, the price is set by the small pool of buyers willing to take on a case.",
        -35,
        -15,
      ),
    );
  }

  if (answers.possession === false) {
    out.push(
      declared(
        "no_possession",
        "Not in physical possession",
        "critical",
        "drag",
        "The seller does not physically hold the land, which is how most encroachment losses start.",
        `Recovering possession is a civil suit measured in years. Fencing and continuous physical possession are what make a paper title worth its face value in peri-urban ${city}.`,
        -30,
        -12,
      ),
    );
  }

  const age = asNumber(answers.age_years);
  if (age !== null && age > 0) {
    // Straight-line depreciation on the structure, capped: the land under an old
    // house does not depreciate, so a whole-property discount must stay modest
    // however old the building is.
    const drag = Math.min(30, Math.round(age * 0.8));
    if (drag >= 3) {
      out.push(
        declared(
          "age_depreciation",
          "Age of construction",
          "info",
          "drag",
          `${age} years of age on the structure reduces what the building contributes to the value.`,
          "Only the structure depreciates; the land under it does not. On an older property most of the value is the land, which is why a very old house on a good plot can still be worth close to plot value.",
          -drag,
          -Math.round(drag / 2),
        ),
      );
    }
  }

  const oc = asString(answers.oc);
  if (oc === "no") {
    out.push(
      declared(
        "no_oc",
        "No occupancy certificate",
        "caution",
        "drag",
        "Without an OC the building is unauthorised on paper, whatever its condition.",
        "Several banks refuse a file without an OC, and the municipal body can levy penal property tax. It also blocks a clean resale to any buyer who needs finance.",
        -15,
        -6,
      ),
    );
  }

  return out;
}
