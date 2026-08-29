import type { DocScript } from '@realytica/shared';

/**
 * The value as the page writes it, beside our reading of it.
 *
 * A Karnataka deed names its owner "ರಾಮಯ್ಯ"; the extractor reads that as
 * "Ramaiah" and stores both. Showing only the reading is what this component
 * exists to stop. Two different Kannada names romanise identically, the
 * registrar's index holds the original, and a lawyer asked to verify a name
 * they can only see in translation has been given nothing to verify against.
 *
 * Rendered as a quotation rather than a second value: it is the same fact,
 * shown as the document shows it, not another field. Marked `lang` so a
 * screen reader switches voice and the browser picks a font that can draw the
 * script — without it, an Indic string in a Latin font is a row of boxes,
 * which looks like corrupted data rather than a name.
 *
 * Absent for an English document, where the reading IS the original and
 * repeating it would be noise.
 */

const LANG_TAG: Partial<Record<DocScript, string>> = {
  kannada: 'kn',
  telugu: 'te',
  devanagari: 'hi',
  tamil: 'ta',
  malayalam: 'ml',
};

export function OriginalScript({
  original,
  script,
  className,
}: {
  original?: string;
  script?: DocScript;
  className?: string;
}) {
  if (!original) return null;
  const lang = script ? LANG_TAG[script] : undefined;
  return (
    <span
      {...(lang ? { lang } : {})}
      // `title` rather than a visible label: the string speaks for itself to a
      // reader of the script, and a reader who cannot read it needs to know
      // what it is rather than a transliteration guide.
      title="As written in the document"
      className={className ?? 'ml-1.5 text-ink-secondary'}
    >
      [{original}]
    </span>
  );
}
