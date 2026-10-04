import { Button, useToast } from '../../../components/ui/kit';
import { fieldState, fieldValue, fieldsIn, inputsOf, type FieldRef, type FieldState } from '../engine';
import { FIGURE, RowButton, RowText } from '../parts';
import { useOpen } from '../place';
import { useExample, type ProofTab } from '../state';
import { Sheet, type SheetLine } from '../Sheet';
import { Desk, History, Labelled, Pad, PassesOn, ProofFoot, ProofHead, ProofTabs, ReadCard, StandingChip, type Step } from './pieces';

const TABS: [ProofTab, string][] = [
  ['source', 'Source'],
  ['links', 'Links'],
  ['history', 'History'],
];

const MARK: Partial<Record<FieldState, SheetLine['state']>> = { set: 'ok', no: 'no' };

const NO_PAPER: Partial<Record<FieldState, string>> = {
  calc: 'Worked out from the values on this page.',
  assume: 'An assumption. Nothing on file supports it yet.',
};

/**
 * The proof of one value.
 *
 * A value read from a paper shows the page with its words marked, then what
 * was read, then the choice: accept it, or say it is not right. A worked-out
 * value shows the values it was worked out from. The other tabs say where
 * the value is used and who has touched it.
 */
export function FieldProof({ field }: { field: FieldRef }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const toast = useToast();
  const { item } = field;
  const now = fieldState(field, state);
  const value = fieldValue(field, state);
  const page = item.page ?? 1;
  const standing = now === 'sug' ? 'waiting' : now === 'no' ? 'left out' : 'accepted';

  const source = () => {
    if (item.from) {
      const lines = fieldsIn(field.fn)
        .filter((y) => y.item.from === item.from)
        .map((y): SheetLine => ({ id: y.id, label: y.item.l, value: fieldValue(y, state), state: MARK[fieldState(y, state)] ?? 'wait' }));
      return (
        <Desk>
          <Sheet title={item.from} page={page} lines={lines} current={field.id} onPick={open.field} />
          <ReadCard
            title="What was read from it"
            rows={[
              ['Value', <b>{value}</b>],
              ['Exact words', <span className="font-display text-[14px] leading-normal">{`“${item.l}: ${value}”`}</span>],
              ['Read by', `The copilot. The words were found on page ${page}.`],
              ['Standing', <StandingChip standing={standing} />],
            ]}
          />
        </Desk>
      );
    }
    const inputs = now === 'calc' ? inputsOf(field) : [];
    return (
      <Pad>
        <Labelled label="Source">{NO_PAPER[now] ?? 'Typed in by a person.'}</Labelled>
        {inputs.length ? (
          <ul className="overflow-hidden rounded-[10px] ring-1 ring-[var(--ring)]">
            {inputs.map((input, i) => (
              <li key={input.id} className={i > 0 ? 'border-t border-hairline' : undefined}>
                <RowButton onClick={() => open.field(input.id)}>
                  <RowText sub={input.item.from ? `read from ${input.item.from}` : input.item.state === 'assume' ? 'an assumption' : 'typed in by a person'}>{input.item.l}</RowText>
                  <span className={FIGURE}>{fieldState(input, state) === 'empty' ? 'Not filled' : fieldValue(input, state)}</span>
                </RowButton>
              </li>
            ))}
          </ul>
        ) : null}
      </Pad>
    );
  };

  const history = (): Step[] => [
    item.from ? { t: 'Read by the copilot', sub: `${item.from}, page ${page} · 3 Oct, 10:12` } : { t: 'Entered by a person', sub: 'A. Menon · 2 Oct, 16:40' },
    ...(now === 'sug'
      ? [{ t: 'Waiting for a person to accept', sub: 'Nothing is on the record until then', kind: 'wait' } as const]
      : now === 'no'
        ? [{ t: 'Left out', sub: 'S. Rao · 3 Oct, 10:21', kind: 'aside' } as const]
        : item.from
          ? [{ t: 'Accepted', sub: 'S. Rao · 3 Oct, 10:20' }]
          : []),
  ];

  return (
    <>
      <ProofHead kind="Proof" title={`${item.l}: ${now === 'empty' ? 'not filled' : value}`} />
      <ProofTabs tabs={TABS} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.proofTab === 'links' ? (
          <Pad>
            <Labelled label="Used in">
              {field.fn.name} · {field.section.name}
            </Labelled>
            <Labelled label="This department passes on" />
            <PassesOn dept={field.dept} />
          </Pad>
        ) : state.proofTab === 'history' ? (
          <Pad>
            <History steps={history()} />
          </Pad>
        ) : (
          source()
        )}
      </div>
      {now === 'sug' ? (
        <ProofFoot>
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: 'mark', what: 'accepted', ids: [field.id] });
              toast('Accepted.');
            }}
          >
            Accept
          </Button>
          <Button
            onClick={() => {
              dispatch({ type: 'mark', what: 'rejected', ids: [field.id] });
              toast('Left out.');
            }}
          >
            Not right
          </Button>
        </ProofFoot>
      ) : null}
    </>
  );
}
