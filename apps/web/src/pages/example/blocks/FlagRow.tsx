import { Badge, cn } from '../../../components/ui/kit';
import type { FlagRef } from '../engine';
import { RowButton, RowText } from '../parts';
import { useOpen, usePicked } from '../place';
import { SEEK, useSeek } from '../seek';

const RAISED: Record<FlagRef['by'], string> = {
  rule: 'Raised by a rule',
  person: 'Raised by a person',
  ai: 'From an AI insight',
};

/**
 * A flag on the record: what it says, who raised it and how serious it is.
 * Pressing it opens why it was raised. `tagged` names the function, for a
 * list that mixes several.
 */
export function FlagRow({ flag, tagged = false }: { flag: FlagRef; tagged?: boolean }) {
  const open = useOpen();
  const visit = usePicked('flag', flag.id);
  const row = useSeek<HTMLLIElement>(visit);
  return (
    <li ref={row} className={cn('border-t border-hairline', SEEK)}>
      <RowButton picked={visit > 0} alert={flag.high ? 'high' : 'medium'} onClick={() => open.flag(flag)}>
        <RowText sub={`${RAISED[flag.by]}${tagged ? ` · ${flag.fn.name}` : ''}`}>{flag.t}</RowText>
        <Badge tone={flag.high ? 'critical' : 'warning'}>{flag.high ? 'High' : 'Medium'}</Badge>
      </RowButton>
    </li>
  );
}
