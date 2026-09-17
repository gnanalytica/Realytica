
// Reading Telangana's published guidance (circle) rates.
//
// IGRS drives its district -> mandal -> village cascade over AJAX behind a
// session, which is why this module existed as a hand-entered snapshot for so
// long. It is replicable after all: establish a session by loading the search
// page, then POST the form to `/UnitRateMV/unitRateMV` with an `encodestr`
// parameter that is nothing more sinister than base64 of the same fields as
// JSON. No browser required.
//
// Hand-entering was not merely incomplete, it was WRONG: the snapshot carried
// Gachibowli at Rs 32,000/sq yd against a published Rs 40,100 effective
// 05/06/2026. That is the case for reading the source rather than estimating
// it, and the reason this module exists.
//
// Used by `scripts/capture-igrs-rates.ts`, not on the request path. The state
// portal is slow and has no SLA; a user lookup must never wait on it.

const BASE = "https://registration.telangana.gov.in";
const SEARCH_PAGE = `${BASE}/UnitRateMV/getDistrictList.htm`;
const SUBMIT = `${BASE}/UnitRateMV/unitRateMV`;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const TIMEOUT_MS = 45_000;

export type IgrsSession = { cookie: string };

export type CodeName = { code: string; name: string };

/** One published rate row: a named locality inside a village. */
export type RateRow = {
  locality: string;
  landPerSqYd: number;
  builtPerSqft: number;
  classification: string | null;
  effectiveFrom: string | null;
};

async function ask(
  url: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ ok: true; body: string; cookie: string } | { ok: false; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*",
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const cookie = [init.cookie, ...setCookie.map((c) => c.split(";")[0])]
      .filter(Boolean)
      .join("; ");
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, body: await res.text(), cookie };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Establish a session. The AJAX endpoints 404 without one — which is what made
 * this look like a WAF for so long, when it is only a servlet that wants to
 * have seen you load the page first.
 */
export async function openSession(): Promise<IgrsSession | null> {
  const home = await ask(`${BASE}/`);
  if (!home.ok) return null;
  const page = await ask(SEARCH_PAGE, { cookie: home.cookie, headers: { Referer: `${BASE}/` } });
  if (!page.ok) return null;
  return { cookie: page.cookie };
}

/** The `code/NAME##code/NAME##` shape both cascade endpoints return. */
function parsePairs(body: string): CodeName[] {
  return body
    .split("##")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const slash = chunk.indexOf("/");
      if (slash < 0) return null;
      return { code: chunk.slice(0, slash).trim(), name: chunk.slice(slash + 1).trim() };
    })
    .filter((v): v is CodeName => v !== null && v.code !== "" && v.name !== "");
}

/** Districts, read out of the search page's own <select>. */
export async function listDistricts(session: IgrsSession): Promise<CodeName[]> {
  const res = await ask(SEARCH_PAGE, {
    cookie: session.cookie,
    headers: { Referer: `${BASE}/` },
  });
  if (!res.ok) return [];
  const select = /<select[^>]*id="districtCode"[\s\S]*?<\/select>/i.exec(res.body);
  if (!select) return [];
  return [...select[0].matchAll(/<option[^>]*value="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/option>/gi)]
    .map((m) => ({ code: m[1], name: m[2].trim() }))
    .filter((d) => d.code !== "");
}

export async function listMandals(
  session: IgrsSession,
  districtCode: string,
): Promise<CodeName[]> {
  const res = await ask(
    `${BASE}/UnitRateMV/getMandalListByDistCode?districtcode=${encodeURIComponent(districtCode)}`,
    { cookie: session.cookie, headers: { Referer: SEARCH_PAGE, "X-Requested-With": "XMLHttpRequest" } },
  );
  return res.ok ? parsePairs(res.body) : [];
}

/**
 * Villages in a mandal. `sType` selects which register is read: "U" returns the
 * urban locality list (longer, and what a Hyderabad plot needs), anything else
 * the rural village list.
 */
export async function listVillages(
  session: IgrsSession,
  districtCode: string,
  mandalCode: string,
  sType: "U" | "R" = "U",
): Promise<CodeName[]> {
  const url =
    `${BASE}/UnitRateMV/getVillageListByDistCode?districtcode=${encodeURIComponent(districtCode)}` +
    `&mandalcode=${encodeURIComponent(mandalCode)}&sType=${sType}`;
  const res = await ask(url, {
    cookie: session.cookie,
    headers: { Referer: SEARCH_PAGE, "X-Requested-With": "XMLHttpRequest" },
  });
  return res.ok ? parsePairs(res.body) : [];
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(v: string): number {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull the rate rows out of the results page.
 *
 * The table is per LOCALITY within a village, not per village: Gachibowli comes
 * back as a plain "GACHIBOWLI" row at Rs 40,100 plus a dozen named road
 * frontages at Rs 78,600. Rows are returned as published; choosing which one
 * represents the village is the caller's decision, and a deliberate one.
 */
export function parseRates(html: string): RateRow[] {
  const rows: RateRow[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      stripTags(c[1]),
    );
    if (cells.length < 6) continue;
    // Shape: S.No | Ward-Block | Locality | Land Rs/sq yd | Built Rs/sq ft |
    //        Classification | Effective date | (link)
    const effective = cells.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
    if (!effective) continue;
    const locality = cells[2];
    const land = toNumber(cells[3]);
    const built = toNumber(cells[4]);
    if (!locality || land <= 0) continue;
    rows.push({
      locality,
      landPerSqYd: land,
      builtPerSqft: built,
      classification: cells[5] || null,
      effectiveFrom: effective,
    });
  }
  return rows;
}

/** Fetch every published rate row for one village. */
export async function fetchVillageRates(
  session: IgrsSession,
  args: {
    districtCode: string;
    mandalCode: string;
    villageCode: string;
    mandalName: string;
    villageName: string;
    rateType?: "U" | "R";
  },
): Promise<{ ok: true; rows: RateRow[] } | { ok: false; detail: string }> {
  const rValue = args.rateType ?? "U";
  const fields: Record<string, string> = {
    encodestr: "",
    locName: "",
    rValue,
    tFlag: "",
    mndlName: args.mandalName,
    vlgName: args.villageName,
    RateType: rValue,
    search_by: "L",
    districtId: args.districtCode,
    mandalCode: args.mandalCode,
    divCode: "",
    villageCode: args.villageCode,
    locality: "",
  };
  // The portal echoes the whole form back to itself as base64 JSON and reads
  // that in preference to the individual fields. Both are sent, as the page does.
  const encodestr = Buffer.from(JSON.stringify(fields)).toString("base64");

  const body = new URLSearchParams({ ...fields, encodestr, submit: "Submit" });
  const res = await ask(SUBMIT, {
    method: "POST",
    cookie: session.cookie,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: SEARCH_PAGE,
      Origin: BASE,
    },
    body: body.toString(),
  });
  if (!res.ok) return res;
  return { ok: true, rows: parseRates(res.body) };
}

/**
 * The rate that represents a whole village.
 *
 * A village's rows are one general entry plus a spread of premium frontages —
 * Gachibowli is Rs 40,100 with roads at Rs 78,600. Anchoring an estimate to the
 * highest would over-price every interior plot, and to the mean would be a
 * number nobody published. The row whose locality IS the village name is the
 * general rate and is preferred; failing that, the median, which is resistant
 * to one very expensive road.
 */
export function representativeRate(village: string, rows: RateRow[]): RateRow | null {
  if (rows.length === 0) return null;
  const key = village.trim().toLowerCase();
  const exact = rows.find((r) => r.locality.trim().toLowerCase() === key);
  if (exact) return exact;
  const sorted = [...rows].sort((a, b) => a.landPerSqYd - b.landPerSqYd);
  return sorted[Math.floor(sorted.length / 2)];
}
