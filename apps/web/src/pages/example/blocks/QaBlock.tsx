import { FileText } from 'lucide-react';
import { Button, useToast } from '../../../components/ui/kit';
import type { BlockAt } from '../engine';
import { AiChip, Group, GroupFoot, SourceChip } from '../parts';
import { useExample } from '../state';
import type { QaBlock as Spec } from '../types';

/**
 * Questions and their answers, each answer with where it came from. An
 * answer the copilot suggested stays a suggestion until a person confirms it.
 */
export function QaBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const items = block.items.map((item, i) => {
    const id = `${at.id}/${i}`;
    return { ...item, id, now: item.state === 'suggested' && state.confirmed[id] ? 'answered' : item.state };
  });
  const answered = items.filter((item) => item.now === 'answered').length;

  return (
    <Group title={block.title ?? 'Questions'} note={`${answered} of ${items.length} answered`}>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="grid gap-1 border-t border-hairline px-3.5 pb-3 pt-2.5 text-[13px]">
            <p className="font-medium text-ink">{item.q}</p>
            <p className={item.a ? 'text-ink-secondary' : 'text-ink-muted'}>{item.a || 'Not answered'}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
              {item.source ? <SourceChip>{item.source}</SourceChip> : null}
              {item.proof ? <SourceChip icon={<FileText aria-hidden />}>{item.proof}</SourceChip> : null}
              {item.now === 'suggested' ? (
                <>
                  <AiChip>Suggested</AiChip>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      dispatch({ type: 'mark', what: 'confirmed', ids: [item.id] });
                      toast('Confirmed.');
                    }}
                  >
                    Confirm
                  </Button>
                </>
              ) : item.now === 'open' ? (
                <Button size="sm" onClick={() => toast('Opens the answer.')}>
                  Answer
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <GroupFoot>
        <Button size="sm" onClick={() => toast('Imports the list.')}>
          Import a list
        </Button>
      </GroupFoot>
    </Group>
  );
}
