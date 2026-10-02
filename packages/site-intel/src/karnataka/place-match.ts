// Which revenue village an address names.
//
// The revenue-map picker asks for district, taluk and village, and the file
// usually already says them — in the address a deed or khata gives the site:
// "Balagere Village, Varthur Hobli, Bangalore East Taluk". This reads that
// line against the K-GIS village index, so the picker can start filled.
//
// A guess, and it says so. Kannada place names have no fixed English
// spelling, 425 village names repeat across the index, and an address often
// names the hobli and not the village at all ("Harohalli Hobli" is not the
// village Harohalli). So a village name only counts when the address does not
// call it a hobli or taluk, and a name shared by several villages needs the
// hobli or taluk to agree before one of them is chosen.

import { looseName, normName } from "./rates";
import { kaVillageLabel, kaVillageLabels, kaVillages, type KaVillage } from "./village-index";

export type KaPlaceMatch =
  | { kind: "match"; village: KaVillage; label: string; agrees: Array<"hobli" | "taluk" | "district"> }
  | { kind: "ambiguous"; candidates: number }
  | { kind: "none" };

/** Words that say the name before them is not a village. */
const NOT_A_VILLAGE = new Set(["hobli", "taluk", "taluka", "tq", "district", "dist", "zone", "ward", "division", "road", "main", "cross", "layout", "nagar", "colony"]);

/** The city's two spellings; the index writes Bangalore for taluks and Bengaluru for districts. */
function aliased(text: string): string {
  return text.replace(/\bbengaluru\b/g, "bangalore").replace(/\bbengalore\b/g, "bangalore");
}

function keysOf(name: string): string[] {
  const exact = normName(aliased(name.toLowerCase()));
  return exact.length >= 4 ? [exact, looseName(exact)] : [];
}

/** "Varturu-2" and "K R Pura-3" are hoblis split for administration; the address names the hobli. */
function hobliName(hobli: string): string {
  return hobli.replace(/[-\s]*\d+$/, "");
}

function grams(text: string): { all: Set<string>; villageish: Set<string> } {
  const words = aliased(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const all = new Set<string>();
  const villageish = new Set<string>();
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 1; n <= 3 && i + n <= words.length; n += 1) {
      const window = words.slice(i, i + n).join("");
      if (window.length < 4) continue;
      const keys = [normName(window), looseName(window)];
      for (const k of keys) all.add(k);
      if (!NOT_A_VILLAGE.has(words[i + n] ?? "")) for (const k of keys) villageish.add(k);
    }
  }
  return { all, villageish };
}

const has = (set: Set<string>, keys: string[]) => keys.some((k) => set.has(k));

/** The picker's label for a village, with the code suffix when its taluk holds two of the same name. */
export function kaPickerLabel(v: KaVillage): string {
  const plain = kaVillageLabel(v);
  return kaVillageLabels(v.district, v.taluk).includes(plain) ? plain : kaVillageLabel(v, true);
}

export function kaVillageFromAddress(text: string | null | undefined): KaPlaceMatch {
  if (!text?.trim()) return { kind: "none" };
  const { all, villageish } = grams(text);
  const scored: Array<{ v: KaVillage; score: number; agrees: Array<"hobli" | "taluk" | "district"> }> = [];
  for (const v of kaVillages()) {
    if (!has(villageish, keysOf(v.village))) continue;
    const agrees: Array<"hobli" | "taluk" | "district"> = [];
    if (has(all, keysOf(hobliName(v.hobli)))) agrees.push("hobli");
    if (has(all, keysOf(v.taluk))) agrees.push("taluk");
    if (has(all, keysOf(v.district.replace(/[()]/g, " ")))) agrees.push("district");
    const score = 3 + (agrees.includes("hobli") ? 2 : 0) + (agrees.includes("taluk") ? 2 : 0) + (agrees.includes("district") ? 1 : 0);
    scored.push({ v, score, agrees });
  }
  if (!scored.length) return { kind: "none" };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score).length;
  // One village of that name anywhere, or one the hobli or taluk singles out.
  if (tied === 1 && (scored.length === 1 || best.agrees.includes("hobli") || best.agrees.includes("taluk"))) {
    return { kind: "match", village: best.v, label: kaPickerLabel(best.v), agrees: best.agrees };
  }
  return { kind: "ambiguous", candidates: tied > 1 ? tied : scored.length };
}
