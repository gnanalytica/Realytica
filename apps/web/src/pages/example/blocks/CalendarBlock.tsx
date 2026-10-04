import { Badge } from '../../../components/ui/kit';
import { tone } from '../engine';
import { Group, LINE, RowText } from '../parts';
import type { CalendarBlock as Spec } from '../types';

/** Things with a due date: the day large, who it falls to, and whether it is filed, due or overdue. */
export function CalendarBlock({ block }: { block: Spec }) {
  const due = block.items.filter((item) => /due|overdue/i.test(item.state)).length;
  return (
    <Group title={block.title ?? 'Calendar'} note={due ? `${due} due` : undefined}>
      <ul>
        {block.items.map((item, i) => {
          const [day, ...rest] = item.due.split(' ');
          return (
            <li key={i} className={LINE}>
              <span className="grid w-[46px] shrink-0 justify-items-center rounded-lg bg-sunken py-[3px] leading-[1.15]">
                <b className="font-mono text-[15px] font-semibold">{day}</b>
                <span className="whitespace-nowrap text-micro text-ink-muted">{rest.join(' ')}</span>
              </span>
              <RowText sub={item.who}>{item.t}</RowText>
              <Badge tone={tone(item.state)}>{item.state}</Badge>
            </li>
          );
        })}
      </ul>
    </Group>
  );
}
