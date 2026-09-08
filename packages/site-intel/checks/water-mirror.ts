/**
 * The on-disk copy of the water-body layer.
 *
 * This exists because the lake buffer is the one finding that can make a plot
 * unbuildable AND still depends on a live call — the Section 22-A register
 * arrives on the parcel row for free. The service holding it refused a
 * connection in 114 ms while its neighbours answered normally, and the state's
 * GIS went fully unreachable four times in one afternoon.
 *
 * Pure: reads the captured file, no network.
 *
 * Run: pnpm test
 */
import assert from "node:assert/strict";

import { WATER_MIRROR_CAPTURED_ON, mirroredWaterBodies } from "../src/layer-mirror";
import mirror from "../src/water-bodies.json";

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

const raw = mirror as { capturedOn: string; bodies: { rings: [number, number][][] }[] };
const captured = WATER_MIRROR_CAPTURED_ON !== null;

if (!captured) console.log("  --   no mirror captured yet (run: pnpm capture:water)");

ok("an uncaptured mirror answers nothing rather than 'no lakes here'", () => {
  if (captured) return;
  // The distinction the whole module turns on: a layer that was never read and
  // a plot with no lake near it look identical, and only one is safe to act on.
  // Null makes the caller report the layer unreachable; [] would claim it is
  // clear.
  assert.equal(mirroredWaterBodies({ lat: 17.4, lng: 78.4 }, 1200), null);
});

ok("it holds the whole state, not a sample", () => {
  if (!captured) return;
  assert.ok(raw.bodies.length > 3_500, `only ${raw.bodies.length} water bodies mirrored`);
  assert.match(raw.capturedOn, /^\d{4}-\d{2}-\d{2}$/);
});

ok("every mirrored polygon is a polygon", () => {
  if (!captured) return;
  // The capture drops rings shorter than four points; a degenerate one here
  // would make point-in-polygon quietly wrong rather than loudly broken.
  const bad = raw.bodies.filter((b) => b.rings.length === 0 || b.rings.some((r) => r.length < 4));
  assert.equal(bad.length, 0, `${bad.length} bodies have a degenerate ring`);
});

ok("coordinates are inside Telangana", () => {
  if (!captured) return;
  // Catches an outSR mistake, which would otherwise show up as every plot in
  // the state being nowhere near water.
  const outside = raw.bodies.filter((b) => {
    const [lng, lat] = b.rings[0][0];
    return lng < 77 || lng > 82 || lat < 15 || lat > 20;
  });
  assert.equal(outside.length, 0, `${outside.length} bodies fall outside the state`);
});

ok("it finds a lake we know the position of", () => {
  if (!captured) return;
  // Hussain Sagar, from a point on its edge. Verified against the live layer:
  // both report the same body at 4 m.
  const hits = mirroredWaterBodies({ lat: 17.4106, lng: 78.4762 }, 1200);
  assert.ok(hits && hits.length > 0, "Hussain Sagar was not found");
  assert.match(String(hits![0].attributes.WB_Name ?? ""), /sagar/i);
  assert.ok(hits![0].distanceM < 100, `nearest reported ${hits![0].distanceM} m away`);
});

ok("hits come back nearest-first and inside the radius", () => {
  if (!captured) return;
  const hits = mirroredWaterBodies({ lat: 17.423539, lng: 78.588312 }, 1200)!;
  assert.ok(hits.length > 0);
  for (const h of hits) assert.ok(h.distanceM <= 1200, `hit at ${h.distanceM} m exceeds the radius`);
  for (let i = 1; i < hits.length; i += 1) {
    assert.ok(hits[i].distanceM >= hits[i - 1].distanceM, "hits are not sorted by distance");
  }
});

ok("a point far from any water reports none", () => {
  if (!captured) return;
  // Not a null: the mirror WAS read and there is genuinely nothing within reach.
  const hits = mirroredWaterBodies({ lat: 19.6, lng: 78.2 }, 50);
  assert.ok(Array.isArray(hits), "reading the mirror returned null");
  assert.equal(hits!.length, 0);
});

ok("the shape matches what the live client returns", () => {
  if (!captured) return;
  // Downstream factor logic cannot know where the answer came from, so the keys
  // it reads have to be identical.
  const h = mirroredWaterBodies({ lat: 17.4106, lng: 78.4762 }, 1200)![0];
  assert.equal(h.layerKey, "water_bodies");
  assert.equal(typeof h.contains, "boolean");
  assert.equal(typeof h.distanceM, "number");
  for (const key of ["WB_Name", "Area", "WBS_2023", "Village"]) {
    assert.ok(key in h.attributes, `missing attribute ${key}`);
  }
});

if (failures > 0) {
  console.error(`\nwater mirror: ${failures} failure(s)`);
  throw new Error("checks failed");
}
console.log("water mirror: ok");
