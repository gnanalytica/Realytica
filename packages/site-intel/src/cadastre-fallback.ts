// The floor under the survey-number picker.
//
// Telangana's GIS went fully unreachable twice during a single afternoon of
// building against it. Next's data cache only helps an instance that has
// already succeeded once, so a cold start during an outage has nothing at all
// to show — and a blank district list reads to a user as "my village is not
// covered", which is both wrong and the exact impression this product must not
// leave.
//
// So the district / mandal / village index is snapshotted to disk
// (`pnpm capture:cadastre-index`) and used when the live read fails. Survey
// numbers are deliberately NOT snapshotted: the list is far larger, it is the
// part most likely to have changed, and a stale survey number would send
// someone to look up a parcel that no longer exists. Narrowing to a village
// offline and then failing honestly at the survey number is the right shape.

// NOT marked `server-only`, because the pure test imports it directly and plain
// Node cannot resolve that guard. The JSON it pulls in is a few hundred KB, so
// this module must stay server-side by discipline: its only caller is
// `parcels.ts`, which IS server-only. Importing it from a client component
// would ship the whole village index to the browser.
import snapshot from "./cadastre-index.json";

type Index = Record<string, Record<string, string[]>>;

const INDEX = (snapshot as { capturedOn: string; index: Index }).index ?? {};

/** When the snapshot was taken, for the "this list may be out of date" notice. */
export const INDEX_CAPTURED_ON = (snapshot as { capturedOn: string }).capturedOn ?? "unknown";

export function fallbackDistricts(): string[] {
  return Object.keys(INDEX).sort((a, b) => a.localeCompare(b));
}

export function fallbackMandals(district: string): string[] {
  return Object.keys(INDEX[district] ?? {}).sort((a, b) => a.localeCompare(b));
}

export function fallbackVillages(district: string, mandal: string): string[] {
  return [...(INDEX[district]?.[mandal] ?? [])].sort((a, b) => a.localeCompare(b));
}
