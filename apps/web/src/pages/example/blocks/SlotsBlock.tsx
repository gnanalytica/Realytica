import { slotById, slotState, type BlockAt, type SlotRef } from '../engine';
import { DropStrip, FLUSH, Group, GroupHead } from '../parts';
import { useExample } from '../state';
import type { SlotsBlock as Spec } from '../types';
import { SlotRow } from './SlotRow';

/** The named papers a function expects, in their groups, and a strip to drop more on. */
export function SlotsBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const { state } = useExample();
  const groups = block.groups.map((group, gi) => ({
    name: group.name,
    slots: group.lines.map((_, li) => slotById(`${at.id}/${gi}.${li}`)).filter((x): x is SlotRef => Boolean(x)),
  }));
  const all = groups.flatMap((g) => g.slots);
  const inHand = all.filter((x) => slotState(x, state) === 'in').length;

  return (
    <Group title={block.title ?? 'Documents'} note={`${inHand} of ${all.length} in hand`}>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.name ? <GroupHead>{group.name}</GroupHead> : null}
          <ul className={group.name ? FLUSH : undefined}>
            {group.slots.map((slot) => (
              <SlotRow key={slot.id} slot={slot} />
            ))}
          </ul>
        </div>
      ))}
      <DropStrip what="Add documents" says="Adds the files." />
    </Group>
  );
}
