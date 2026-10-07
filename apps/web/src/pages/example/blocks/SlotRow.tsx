import { Button, useToast } from '../../../components/ui/kit';
import { homeOf, many, slotState, type SlotRef } from '../engine';
import { RowButton, RowText, StateDot } from '../parts';
import { useOpen } from '../place';
import { useExample } from '../state';

/**
 * One paper: in hand, asked for or not asked for, and the one thing to do
 * about it.
 *
 * A paper has one home. A line that only refers to it says where it is filed
 * and opens it there, so the same deed is never kept twice. `tagged` names
 * the function, for a list that mixes several.
 */
export function SlotRow({ slot, tagged = false }: { slot: SlotRef; tagged?: boolean }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const toast = useToast();
  const home = homeOf(slot);
  const refers = home !== slot;
  const now = slotState(slot, state);
  const sub = refers ? `Filed in ${home.dept.label} · ${home.fn.name}` : tagged ? slot.fn.name : now === 'asked' && slot.line.who ? `Asked of ${slot.line.who}` : '';
  const meta =
    now === 'in'
      ? `In hand${home.line.pages ? ` · ${many(home.line.pages, 'page', 'pages')}` : ''}`
      : now === 'asked'
        ? `Asked${home.line.due ? ` · due ${home.line.due}` : ''}`
        : 'Not asked';

  return (
    <li className="flex items-center border-t border-hairline">
      <RowButton className="flex-1 [@container(min-width:35rem)]:flex-nowrap" onClick={() => open.paper(home.id)}>
        <StateDot state={now} />
        <RowText sub={sub}>{slot.line.t}</RowText>
        <span className="whitespace-nowrap text-[12px] text-ink-muted">{meta}</span>
      </RowButton>
      {refers ? (
        <Button size="sm" className="mr-3 shrink-0" onClick={() => open.to(home.dept, home.fn, { part: home.section.id })}>
          Open there
        </Button>
      ) : now === 'none' ? (
        <Button
          size="sm"
          className="mr-3 shrink-0"
          onClick={() => {
            dispatch({ type: 'mark', what: 'asked', ids: [home.id] });
            toast('Asks for the paper.');
          }}
        >
          Ask for it
        </Button>
      ) : now === 'asked' ? (
        <Button size="sm" className="mr-3 shrink-0" onClick={() => toast('Sends a reminder.')}>
          Remind
        </Button>
      ) : null}
    </li>
  );
}
