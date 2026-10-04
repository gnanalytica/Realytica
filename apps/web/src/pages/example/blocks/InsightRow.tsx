import { Badge, Button, cn, useToast } from '../../../components/ui/kit';
import { fieldValue, type FieldRef, type InsightRef } from '../engine';
import { useOpen, usePicked } from '../place';
import { useExample } from '../state';

/** A value an insight rests on. Pressing it shows the value where it lives, with its proof. */
function RestsOn({ field }: { field: FieldRef }) {
  const { state } = useExample();
  const open = useOpen();
  const picked = usePicked('field', field.id);
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={() => open.field(field.id)}
      className={cn(
        'inline-flex min-h-7 items-baseline gap-[7px] rounded-lg border bg-surface px-[9px] py-1 text-left text-[12px] text-ink-muted transition-colors duration-quick ease-state',
        picked ? 'border-transparent ring-2 ring-brand' : 'border-hairline hover:border-[var(--axis)] hover:bg-page',
      )}
    >
      <span>{field.item.l}</span>
      <b className="font-mono font-medium text-ink">{fieldValue(field, state) || 'Not filled'}</b>
    </button>
  );
}

/**
 * Something the copilot noticed. It is not on the record: a person raises it
 * as a flag, or dismisses it. `tagged` names the function, for a list that
 * mixes several.
 */
export function InsightRow({ insight, tagged = false }: { insight: InsightRef; tagged?: boolean }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const raised = Boolean(state.raised[insight.id]);
  return (
    <li className="grid gap-2 border-t border-hairline px-3.5 pb-3 pt-2.5">
      <p className="grid gap-px text-[13px] text-ink">
        {insight.t}
        {tagged ? <span className="text-[12px] text-ink-muted">{insight.fn.name}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {insight.rests.map((field) => (
          <RestsOn key={field.id} field={field} />
        ))}
        {raised ? (
          <Badge>Raised as a flag</Badge>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => {
                dispatch({ type: 'mark', what: 'raised', ids: [insight.id] });
                toast('Flag raised.');
              }}
            >
              Raise as a flag
            </Button>
            <Button
              size="sm"
              onClick={() => {
                dispatch({ type: 'mark', what: 'dismissed', ids: [insight.id] });
                toast('Dismissed.');
              }}
            >
              Dismiss
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
