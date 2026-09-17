/**
 * The offline district/mandal/village snapshot, and the rule that governs it.
 *
 * This file exists because the first capture ran against a flapping government
 * server and produced an index with 16 of Rangareddy's 25 mandals and none of
 * Karimnagar's. A fallback that silently omits a mandal is worse than no
 * fallback: it converts "the state server is down" into "your land is not on
 * the map". These checks are what stops a degraded capture from shipping.
 *
 * Run: pnpm test
 */
import assert from "node:assert/strict";

import snapshot from "../src/cadastre-index.json";
import {
  INDEX_CAPTURED_ON,
  fallbackDistricts,
  fallbackMandals,
  fallbackVillages,
} from "../src/cadastre-fallback";

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

const raw = snapshot as { capturedOn: string; index: Record<string, Record<string, string[]>> };

// Having no snapshot yet is a legitimate state: the fallback is hardening, not
// a dependency, and `pnpm capture:cadastre-index` needs the state server up. But
// a snapshot that EXISTS must be complete — a half-captured index is the one
// outcome worse than having none — so the completeness checks below run only
// once a real capture has landed, and the placeholder is asserted to be inert.
const captured = raw.capturedOn !== "pending";

if (!captured) {
  console.log("  --   no snapshot captured yet (run: pnpm capture:cadastre-index)");
}

ok("the date shown to the user is the snapshot's own", () => {
  assert.equal(INDEX_CAPTURED_ON, raw.capturedOn);
});

ok("an uncaptured snapshot serves nothing rather than a short list", () => {
  if (captured) return;
  assert.deepEqual(fallbackDistricts(), [], "the placeholder is serving data");
  assert.deepEqual(fallbackMandals("Rangareddy"), []);
});

ok("a captured snapshot is dated", () => {
  if (!captured) return;
  assert.match(raw.capturedOn, /^\d{4}-\d{2}-\d{2}$/);
});

ok("it covers both published layers, urban and rural", () => {
  if (!captured) return;
  const districts = fallbackDistricts();
  assert.ok(districts.length >= 15, `only ${districts.length} districts`);
  // One district from each layer, so a capture that lost a whole source fails.
  assert.ok(districts.includes("Rangareddy"), "the municipal layer is missing");
  assert.ok(districts.includes("Mahabubnagar"), "the rural layer is missing");
});

ok("no district was captured empty", () => {
  if (!captured) return;
  const empty = fallbackDistricts().filter((d) => fallbackMandals(d).length === 0);
  assert.deepEqual(empty, [], `districts with no mandals: ${empty.join(", ")}`);
});

ok("no mandal was captured empty", () => {
  if (!captured) return;
  const empty: string[] = [];
  for (const d of fallbackDistricts()) {
    for (const m of fallbackMandals(d)) {
      if (fallbackVillages(d, m).length === 0) empty.push(`${d}/${m}`);
    }
  }
  assert.deepEqual(empty.slice(0, 10), [], `${empty.length} mandals with no villages`);
});

ok("the districts a Hyderabad user needs are actually complete", () => {
  if (!captured) return;
  // Ghatkesar is the mandal the live probe exercises; the first bad capture
  // dropped it, and nothing but a named check would have caught that.
  const mandals = fallbackMandals("Rangareddy");
  assert.ok(mandals.length >= 25, `Rangareddy has only ${mandals.length} mandals`);
  assert.ok(mandals.includes("Ghatkesar"), "Ghatkesar is missing from Rangareddy");
  const villages = fallbackVillages("Rangareddy", "Ghatkesar");
  assert.ok(villages.length >= 21, `Ghatkesar has only ${villages.length} villages`);
  assert.ok(villages.includes("Boduppal"), "Boduppal is missing from Ghatkesar");
});

ok("lookups are sorted and unknown keys return nothing rather than throwing", () => {
  if (!captured) {
    assert.deepEqual(fallbackVillages("Atlantis", "Nowhere"), []);
    return;
  }
  const districts = fallbackDistricts();
  assert.deepEqual(districts, [...districts].sort((a, b) => a.localeCompare(b)));
  const mandals = fallbackMandals("Rangareddy");
  assert.deepEqual(mandals, [...mandals].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(fallbackMandals("Atlantis"), []);
  assert.deepEqual(fallbackVillages("Atlantis", "Nowhere"), []);
  assert.deepEqual(fallbackVillages("Rangareddy", "Nowhere"), []);
});

ok("survey numbers are deliberately NOT snapshotted", () => {
  // A stale survey number sends someone to look up a parcel that may no longer
  // exist, and the list is far larger than the village index. Narrowing offline
  // and failing honestly at the survey number is the intended shape.
  for (const mandals of Object.values(raw.index)) {
    for (const villages of Object.values(mandals)) {
      assert.ok(Array.isArray(villages), "villages must be a flat list");
      assert.ok(
        villages.every((v) => typeof v === "string"),
        "a village entry holds nested parcel data",
      );
    }
  }
});

if (failures > 0) {
  console.error(`\ncadastre fallback: ${failures} failure(s)`);
  throw new Error("checks failed");
}
console.log("cadastre fallback: ok");
