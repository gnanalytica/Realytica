import { fieldById, photoById } from '../engine';
import { usePlace } from '../place';
import { useExample } from '../state';
import { FieldProof } from './FieldProof';
import { FlagProof } from './FlagProof';
import { PhotoProof } from './PhotoProof';

/**
 * The right-hand panel: the proof of whatever is picked, and only while it
 * is picked on the page being looked at.
 *
 * Beside the work on a wide screen. On a narrow one it lies over the lower
 * part of the work, so the thing picked can still be seen above it.
 */
export function ProofPane() {
  const { picked } = useExample().state;
  const place = usePlace();
  if (!picked || picked.at !== place.key) return null;
  const field = picked.kind === 'field' ? fieldById(picked.id) : undefined;
  const photo = picked.kind === 'photo' ? photoById(picked.id) : undefined;

  return (
    <aside
      aria-label="Proof"
      className="absolute inset-x-0 bottom-0 z-[15] flex h-[68%] min-h-0 min-w-0 flex-col rounded-t-2xl border-t border-[var(--axis)] bg-surface shadow-pop lg:static lg:z-auto lg:h-auto lg:rounded-none lg:border-l lg:border-t-0 lg:border-hairline lg:shadow-none"
    >
      {field ? <FieldProof field={field} /> : photo ? <PhotoProof photo={photo} /> : picked.kind === 'flag' ? <FlagProof id={picked.id} /> : null}
    </aside>
  );
}
