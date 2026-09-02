import { useId, useMemo } from 'react';
import { ownerSuggestions, type DdProject } from '@realytica/shared';
import { Input } from './ui/kit';
import { useRoster } from '../lib/useRoster';

/**
 * An owner field that offers the people who exist.
 *
 * Offered, never enforced. The field is free text because the person doing the
 * work is not always somebody with an account — a site helper who has never
 * signed in is still the person fixing the boundary wall — and a picker that
 * refused them would be a picker people route around by typing the name into
 * the description, where nothing can read it.
 *
 * What this buys is convergence rather than correctness: "My work" matches an
 * owner against an address, its local part, or a full name, and nothing looser,
 * because a false positive there puts somebody else's work on a screen whose
 * whole promise is that it is yours. A list that puts one of those three forms
 * a keystroke away is how the free text comes to be in one of them, without
 * anybody being asked to migrate anything.
 */
export function OwnerInput({
  value,
  onChange,
  project,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The file being worked on, so the names already on it come first. */
  project?: DdProject;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const roster = useRoster();
  const options = useMemo(() => ownerSuggestions(project, roster), [project, roster]);

  return (
    <>
      <Input
        value={value}
        list={options.length > 0 ? listId : undefined}
        placeholder={placeholder ?? 'Name or email'}
        className={className}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
