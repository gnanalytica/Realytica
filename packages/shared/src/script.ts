/**
 * Reading Indian property documents that are not in English.
 *
 * A Karnataka sale deed is routinely in Kannada, a Telangana one in Telugu, a
 * northern one in Devanagari, and the parts that matter are mixed: the
 * schedule in the local script, the survey number in Latin digits, the seal
 * in both. Two rules follow, and both are about not losing information the
 * moment it is understood.
 *
 * **Never replace the original with the transliteration.** "ರಾಮಯ್ಯ" becoming
 * "Ramaiah" is a reading, and a reading is a claim. The registrar's index
 * holds the original; a report that names only the romanised form gives a
 * lawyer nothing to check against, and two different Kannada names can
 * romanise identically. Both travel together, always.
 *
 * **Never transliterate an identifier.** A survey number, a document number
 * and a khata number are strings that must match a register character for
 * character. Devanagari and Kannada digits are converted (they are the same
 * number written differently) but letters are left alone, because there is no
 * such thing as the English spelling of an identifier — only the identifier.
 */

export type DocScript = 'latin' | 'kannada' | 'telugu' | 'devanagari' | 'tamil' | 'malayalam' | 'mixed' | 'unknown';

const SCRIPT_RANGES: { script: Exclude<DocScript, 'mixed' | 'unknown'>; test: RegExp }[] = [
  { script: 'devanagari', test: /[ऀ-ॿ]/ },
  { script: 'kannada', test: /[ಀ-೿]/ },
  { script: 'telugu', test: /[ఀ-౿]/ },
  { script: 'tamil', test: /[஀-௿]/ },
  { script: 'malayalam', test: /[ഀ-ൿ]/ },
  { script: 'latin', test: /[A-Za-z]/ },
];

/**
 * Which scripts a piece of text is written in.
 *
 * Detection rather than declaration: a document's own header lies about this
 * constantly — an English cover page over a Kannada deed is the normal case,
 * not the exception.
 */
export function detectScripts(text: string): Exclude<DocScript, 'mixed' | 'unknown'>[] {
  return SCRIPT_RANGES.filter(r => r.test.test(text)).map(r => r.script);
}

/** The single label for a document: the one script, `mixed`, or `unknown`. */
export function scriptOf(text: string): DocScript {
  const found = detectScripts(text);
  if (found.length === 0) return 'unknown';
  if (found.length === 1) return found[0];
  // Latin alongside one Indic script is the ordinary shape of an Indian deed
  // — digits, "Sy. No.", an English endorsement — and calling that "mixed"
  // would label almost every document the same way and say nothing. Mixed is
  // reserved for two Indic scripts together, which is genuinely unusual and
  // worth a reader's attention.
  const indic = found.filter(s => s !== 'latin');
  return indic.length === 1 ? indic[0] : 'mixed';
}

/**
 * Indic digits to ASCII.
 *
 * Applied to identifiers, where it is safe and necessary: ೧೨೩ and 123 are the
 * same number, and a survey number written in Kannada digits must match a
 * register that holds it in Latin ones. Letters are never touched.
 */
const DIGIT_BASES = [0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66];

export function normalizeDigits(value: string): string {
  return [...value]
    .map(ch => {
      const code = ch.codePointAt(0) ?? 0;
      for (const base of DIGIT_BASES) {
        if (code >= base && code <= base + 9) return String(code - base);
      }
      return ch;
    })
    .join('');
}

/**
 * A value paired with the text it was read from.
 *
 * `original` is what the page says; `value` is what we take it to mean. For a
 * document already in English they are the same string and this costs nothing.
 * For one that is not, keeping both is the difference between a report a
 * lawyer can verify and one they have to take on trust.
 */
export interface ScriptedValue {
  value: string;
  original: string;
  script: DocScript;
  /** True when `value` is a reading of `original` rather than a copy of it. */
  transliterated: boolean;
}

export function scriptedValue(value: string, original?: string): ScriptedValue {
  const source = original ?? value;
  return {
    value,
    original: source,
    script: scriptOf(source),
    transliterated: source !== value,
  };
}

/**
 * Whether a field is an identifier, and therefore must not be transliterated.
 *
 * Keyed on the field name rather than on the value's shape: a survey number
 * can look like anything, and by the time you are inspecting the value you
 * have already lost the chance to protect it.
 */
const IDENTIFIER_KEY = /(number|no|id|khata|survey|sy|pid|folio|volume|page|registration|document)$/i;

export function isIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEY.test(key.replace(/[^A-Za-z]/g, ''));
}

/**
 * Prepare one extracted value for storage.
 *
 * An identifier keeps its characters and only has its digits normalised. A
 * name or a description keeps both forms. Nothing is discarded either way —
 * the distinction is only about which string becomes `value`.
 */
export function prepareValue(key: string, value: string, original?: string): ScriptedValue {
  if (isIdentifierKey(key)) {
    const source = original ?? value;
    const normalised = normalizeDigits(source);
    return { value: normalised, original: source, script: scriptOf(source), transliterated: false };
  }
  return scriptedValue(value, original);
}
