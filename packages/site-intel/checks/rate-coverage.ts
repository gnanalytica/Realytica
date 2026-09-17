/**
 * How much of the map the value band actually covers.
 *
 * The app can FIND 3,539 villages. It can PRICE far fewer, because the
 * guidance-rate table is a hand-entered snapshot and the IGRS portal has no
 * readable endpoint. That gap is the single biggest limitation in the product,
 * so it is measured here rather than left as a vague "Hyderabad region only".
 *
 * This test does not demand high coverage — it demands that the number is known
 * and does not silently fall. If you extend the table, the floors below go up.
 * If a refactor quietly breaks the district fallback, this fails instead of the
 * product going quiet in eleven districts.
 *
 * Run: pnpm test
 */
import assert from "node:assert/strict";

import snapshot from "../src/cadastre-index.json";
import { resolveRate } from "../src/guidance-rates";
import { districtHasGuidance } from "../src/rate-coverage";

const index = (snapshot as { index: Record<string, Record<string, string[]>> }).index;

let failures = 0;
function ok(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${label}`);
    console.error(`       ${(err as Error).message}`);
  }
}

type Tally = { villages: number; priced: number };
const byDistrict = new Map<string, Tally>();
let villages = 0;
let priced = 0;

for (const [district, mandals] of Object.entries(index)) {
  const tally: Tally = { villages: 0, priced: 0 };
  for (const [mandal, names] of Object.entries(mandals)) {
    for (const village of names) {
      villages += 1;
      tally.villages += 1;
      if (resolveRate({ village, mandal, district }, "open_plot", null)) {
        priced += 1;
        tally.priced += 1;
      }
    }
  }
  byDistrict.set(district, tally);
}

const pct = villages ? (priced / villages) * 100 : 0;
const uncovered = [...byDistrict.entries()].filter(([, t]) => t.priced === 0).map(([d]) => d);

console.log(`  --   ${priced}/${villages} villages priced (${pct.toFixed(1)}%)`);
console.log(`  --   no rate at all in ${uncovered.length} district(s): ${uncovered.join(", ")}`);

// Only meaningful once a real cadastre snapshot has been captured.
const captured = (snapshot as { capturedOn: string }).capturedOn !== "pending";

ok("the priced fraction has not regressed", () => {
  if (!captured) return;
  // Raised from 30 to 75 once `pnpm capture:igrs` finished the state: 2,911 of
  // 3,539 villages price against 1,066 before it. A floor left at the old value
  // would no longer notice losing two thirds of the table.
  assert.ok(pct >= 75, `coverage fell to ${pct.toFixed(1)}% — the rate table lost entries`);
});

ok("a district reported uncovered is not in fact broadly covered", () => {
  if (!captured) return;
  // Under-claiming a little is harmless: the user is asked for a local rate and
  // gets a band anyway if the resolver happens to find one, because a mandal
  // name or an unambiguous village can legitimately match across the 2016
  // district split. Under-claiming a LOT means the coverage list is stale and
  // people are being asked for numbers we already hold.
  const stale = [...byDistrict.entries()]
    .filter(([d, t]) => !districtHasGuidance(d) && t.villages > 0 && t.priced / t.villages > 0.1)
    .map(([d, t]) => `${d} prices ${t.priced}/${t.villages} but is reported uncovered`);
  assert.deepEqual(stale, [], stale.join("; "));
});

ok("a district we claim to cover prices something", () => {
  if (!captured) return;
  // The other direction. Claiming coverage and delivering nothing is the
  // failure that sends a user through a 30-second check to reach "no rate to
  // anchor to" — which is what this whole prompt-first flow exists to avoid.
  const hollow = [...byDistrict.entries()]
    .filter(([d, t]) => districtHasGuidance(d) && t.priced === 0)
    .map(([d, t]) => `${d} claims coverage but prices 0 of ${t.villages}`);
  assert.deepEqual(hollow, [], hollow.join("; "));
});

ok("an uncovered district refuses to price rather than guessing", () => {
  const a = resolveRate(
    { village: "Nowhere", mandal: "Nowhere", district: "Atlantis" },
    "open_plot",
    null,
  );
  assert.equal(a, null, "an unknown district invented a rate");
});

ok("a rate the user supplies works anywhere, covered or not", () => {
  const a = resolveRate(
    { village: "Nowhere", mandal: "Nowhere", district: "Atlantis" },
    "open_plot",
    7_500,
  );
  assert.ok(a, "a user-supplied rate was refused in an uncovered district");
  assert.equal(a!.basis, "user");
  assert.equal(a!.ratePerUnit, 7_500);
});

if (failures > 0) {
  console.error(`\nrate coverage: ${failures} failure(s)`);
  throw new Error("checks failed");
}
console.log("rate coverage: ok");
