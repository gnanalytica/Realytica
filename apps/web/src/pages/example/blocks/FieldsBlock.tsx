import { FileText, Sigma } from 'lucide-react';
import { Badge, Button, Field, Input, Select, cn, useToast } from '../../../components/ui/kit';
import { fieldById, fieldState, fieldValue, type BlockAt, type FieldRef } from '../engine';
import { Group, SourceChip } from '../parts';
import { useOpen, usePicked } from '../place';
import { useSeek } from '../seek';
import { useExample } from '../state';
import type { FieldsBlock as Spec } from '../types';

/*
 * The kit's controls are tinted from the cell that holds them, so a value the
 * copilot read looks like a suggestion and a worked-out one cannot be mistaken
 * for something to type into.
 */
const SUGGESTED =
  '[&_input]:bg-ai-soft [&_input]:text-ai-ink [&_input]:ring-ai/60 [&_select]:bg-ai-soft [&_select]:text-ai-ink [&_select]:ring-ai/60';
const WORKED_OUT = '[&_input]:bg-brand-soft [&_input]:text-brand-strong [&_input]:ring-transparent';

/** A choice between two words, both in sight. */
function YesNo({ label, options, value, suggested, onPick }: { label: string; options: string[]; value: string; suggested: boolean; onPick: (value: string) => void }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex justify-self-start overflow-hidden rounded-lg bg-surface ring-1 ring-inset', suggested ? 'ring-ai/60' : 'ring-[var(--ring)]')}>
      {options.map((option, i) => {
        const on = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(option)}
            className={cn(
              'min-h-8 px-[15px] py-1.5 text-[13px] transition-colors duration-quick ease-state focus-visible:outline-offset-[-2px] coarse:min-h-11',
              i > 0 && 'border-l border-hairline',
              on ? (suggested ? 'bg-ai text-white' : 'bg-ink text-ink-inverse') : 'text-ink-secondary hover:bg-page',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One typed fact, with where its value came from.
 *
 * A value the copilot read waits here until a person accepts it or says it
 * is not right, on the field itself or in the proof pane. An empty field
 * takes a typed value; a field with a set of answers is a selector.
 */
function FieldCell({ field }: { field: FieldRef }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const toast = useToast();
  const picked = usePicked('field', field.id);
  const cell = useSeek<HTMLDivElement>(picked);
  const { item } = field;
  const now = fieldState(field, state);
  const value = now === 'empty' ? '' : fieldValue(field, state);
  const set = (next: string) => dispatch({ type: 'value', id: field.id, value: next });
  const show = () => open.field(field.id);
  const options = item.options;

  return (
    <div ref={cell} className={cn('grid min-w-0 content-start gap-1', now === 'sug' && SUGGESTED, now === 'calc' && WORKED_OUT)}>
      <Field label={item.l} className={cn(picked && '[&>label]:font-semibold [&>label]:text-brand-strong')}>
        {now === 'calc' ? (
          <Input readOnly value={value} className="font-mono" />
        ) : options && options.length === 2 && options.includes('Yes') && options.includes('No') ? (
          <YesNo label={item.l} options={options} value={value} suggested={now === 'sug'} onPick={set} />
        ) : options ? (
          <Select value={options.includes(value) ? value : ''} onChange={(e) => set(e.target.value)}>
            <option value="">Choose</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={value} placeholder="Not filled" onChange={(e) => set(e.target.value)} className="font-mono" />
        )}
      </Field>
      {now === 'empty' ? null : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
          {item.from ? (
            <SourceChip icon={<FileText aria-hidden />} on={picked} title="Show where this came from" onClick={show}>
              {item.from}
              {item.page ? `, p. ${item.page}` : ''}
            </SourceChip>
          ) : now === 'calc' ? (
            <SourceChip icon={<Sigma aria-hidden />} on={picked} title="Show what it was worked out from" onClick={show}>
              Worked out
            </SourceChip>
          ) : now === 'assume' ? (
            <SourceChip assumed>Assumption</SourceChip>
          ) : null}
          {now === 'sug' ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  dispatch({ type: 'mark', what: 'accepted', ids: [field.id] });
                  toast('Accepted.');
                }}
              >
                Accept
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  dispatch({ type: 'mark', what: 'rejected', ids: [field.id] });
                  toast('Left out.');
                }}
              >
                Not right
              </Button>
            </>
          ) : null}
          {now === 'no' ? <Badge>Left out</Badge> : null}
        </div>
      )}
    </div>
  );
}

/** A set of typed facts, laid out in as many columns as the page has room for. */
export function FieldsBlock({ at, block }: { at: BlockAt; block: Spec }) {
  const { state } = useExample();
  const fields = block.items.map((_, i) => fieldById(`${at.id}/${i}`)).filter((x): x is FieldRef => Boolean(x));
  const filled = fields.filter((x) => fieldState(x, state) !== 'empty').length;

  return (
    <Group title={block.title ?? 'Details'} note={`${filled} of ${fields.length} filled`}>
      <div className="grid gap-x-4 gap-y-3.5 px-3.5 pb-4 pt-1 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
        {fields.map((field) => (
          <FieldCell key={field.id} field={field} />
        ))}
      </div>
    </Group>
  );
}
