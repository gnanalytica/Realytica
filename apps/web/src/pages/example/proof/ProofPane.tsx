import type { ReactNode } from 'react';
import { cn } from '../../../components/ui/kit';
import { fieldById, flagById, photoById, type Marks } from '../engine';
import { usePlace } from '../place';
import { useExample, type Picked } from '../state';
import { FieldProof } from './FieldProof';
import { FlagProof } from './FlagProof';
import { PhotoProof } from './PhotoProof';

/** Under the work it is a sheet with its top corners rounded. Beside the work it is a plain column, ruled off on its left. */
const UNDER = 'rounded-t-2xl border-t border-[var(--axis)] shadow-pop';
const BESIDE =
  'lg:rounded-none lg:border-l lg:border-t-0 lg:border-hairline lg:shadow-none ' +
  'max-lg:short:rounded-none max-lg:short:border-l max-lg:short:border-t-0 max-lg:short:border-hairline max-lg:short:shadow-none';

/** The proof of what is picked, or nothing when what was picked is no longer there to prove. */
function proofOf(picked: Picked, marks: Marks): ReactNode {
  if (picked.kind === 'field') {
    const field = fieldById(picked.id);
    return field ? <FieldProof field={field} /> : null;
  }
  if (picked.kind === 'photo') {
    const photo = photoById(picked.id);
    return photo ? <PhotoProof photo={photo} /> : null;
  }
  const flag = flagById(picked.id, marks);
  return flag ? <FlagProof flag={flag} /> : null;
}

/**
 * The proof of whatever is picked, and only while it is picked on the page
 * being looked at.
 *
 * On a wide screen it is a column beside the work, and so it is on a phone
 * held sideways. On a narrow, upright one it takes the lower part of the
 * window, never more than half of it, and the work keeps the rest. The two
 * never overlap, so the thing picked stays in sight above its proof and
 * nothing is hidden under it.
 */
export function ProofPane() {
  const { state } = useExample();
  const place = usePlace();
  const picked = state.picked;
  const proof = picked && picked.at === place.key ? proofOf(picked, state) : null;
  if (!proof) return null;

  return (
    <aside
      aria-label="Proof"
      className={cn('flex min-h-0 min-w-0 flex-col bg-surface', UNDER, BESIDE)}
    >
      {proof}
    </aside>
  );
}
