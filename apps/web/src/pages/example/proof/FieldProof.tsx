import { Button, useToast } from '../../../components/ui/kit';
import { changed, fieldState, fieldValue, fieldsIn, othersIn, paperOf, readFrom, type FieldRef, type FieldState, type Marks } from '../engine';
import { FIGURE, RowButton, RowText } from '../parts';
import { useOpen } from '../place';
import { useExample, type ProofTab } from '../state';
import { Sheet, sheetLine } from '../Sheet';
import { Desk, History, Labelled, Pad, PassesOn, ProofFoot, ProofHead, ProofTabs, ReadCard, StandingChip, type Step } from './pieces';

const TABS: [ProofTab, string][] = [
  ['source', 'Source'],
  ['links', 'Links'],
  ['history', 'History'],
];

/** What a person has done with a value the copilot read or suggested. */
function fate(now: FieldState, typedOver: boolean): 'waiting' | 'left out' | 'changed' | 'accepted' {
  return now === 'sug' ? 'waiting' : now === 'no' ? 'left out' : typedOver ? 'changed' : 'accepted';
}

/** Where a value with no paper behind it came from, in a sentence. */
function origin(field: FieldRef, now: FieldState, marks: Marks): string {
  const typed = changed(field, marks);
  if (field.item.state === 'sug') {
    return typed
      ? `Typed in by a person, over what the copilot suggested: ${field.item.v}.`
      : 'Suggested by the copilot from what is on the file. There is no page behind it.';
  }
  if (now === 'calc') return 'Worked out by the product.';
  if (now === 'empty') return 'Not filled yet.';
  if (now === 'assume' && !typed) return 'An assumption. Nothing on file supports it yet.';
  return 'Typed in by a person.';
}

/** Who touched a value, in order. The first line is where it came from, the rest what people did with it. */
function story(field: FieldRef, now: FieldState, marks: Marks): Step[] {
  const { item } = field;
  const value = fieldValue(field, marks);
  const typed = changed(field, marks);
  const fromCopilot = Boolean(item.from) || item.state === 'sug';
  const first: Step = item.from
    ? { t: 'Read by the copilot', sub: `${item.from}, page ${item.page ?? 1} · 3 Oct, 10:12` }
    : item.state === 'sug'
      ? { t: 'Suggested by the copilot', sub: 'From what is on the file · 3 Oct, 10:12' }
      : item.state === 'calc'
        ? { t: 'Worked out by the product', sub: '3 Oct, 10:12' }
        : item.state === 'empty'
          ? { t: 'Not filled', sub: 'Nobody had entered a value', kind: 'aside' }
          : { t: 'Entered by a person', sub: 'A. Menon · 2 Oct, 16:40' };
  const then: Step[] = !fromCopilot
    ? []
    : now === 'sug'
      ? [{ t: 'Waiting for a person to accept', sub: 'Nothing is on the record until then', kind: 'wait' }]
      : now === 'no'
        ? [{ t: 'Left out', sub: 'S. Rao · 3 Oct, 10:21', kind: 'aside' }]
        : typed
          ? []
          : [{ t: 'Accepted', sub: 'S. Rao · 3 Oct, 10:20' }];
  if (!typed || now === 'no') return [first, ...then];
  const typedIn: Step = item.v ? { t: 'Changed by a person', sub: `From ${item.v} to ${value || 'nothing'} · today` } : { t: 'Entered by a person', sub: `${value} · today` };
  return [first, ...then, typedIn];
}

/**
 * The proof of one value.
 *
 * A value read from a paper shows the page it was read from, with the
 * page's own words marked, then what was read, then the choice: accept it, or
 * say it is not right. The page and the exact words never change: when a
 * person has typed another value, the proof says so and shows both. A value
 * the copilot suggested with no page behind it, a worked-out one and a typed
 * one each say plainly which they are. The other tabs say where the value is
 * used and who has touched it.
 */
export function FieldProof({ field }: { field: FieldRef }) {
  const { state, dispatch } = useExample();
  const open = useOpen();
  const toast = useToast();
  const { item } = field;
  const now = fieldState(field, state);
  const value = fieldValue(field, state);
  const fromCopilot = Boolean(item.from) || item.state === 'sug';
  const typedOver = fromCopilot && changed(field, state);
  const standing = fate(now, typedOver);
  const page = item.page ?? 1;

  const source = () => {
    if (item.from) {
      // The page holds what every function read from it there, and nothing read from its other pages.
      const paper = paperOf(field);
      const read = paper ? readFrom(paper) : fieldsIn(field.fn).filter((y) => y.item.from === item.from);
      const lines = read.filter((y) => (y.item.page ?? 1) === page).map((y) => sheetLine(y, state));
      return (
        <Desk>
          <Sheet title={item.from} page={page} lines={lines} current={field.id} visit={state.picked?.visit} onPick={open.field} />
          <ReadCard
            title="What was read from it"
            rows={[
              ['Value', <b>{item.v}</b>],
              ['Exact words', <span className="font-display text-[14px] leading-normal">{`“${item.l}: ${item.v}”`}</span>],
              ['Read by', `The copilot. The words were found on page ${page}.`],
              [
                'Standing',
                <>
                  <StandingChip standing={standing} />
                  {typedOver ? <span className="mt-1 block">The record holds {value || 'nothing'}, typed by a person.</span> : null}
                </>,
              ],
            ]}
          />
        </Desk>
      );
    }
    const others = now === 'calc' ? othersIn(field) : [];
    return (
      <Pad>
        <Labelled label="Source">{origin(field, now, state)}</Labelled>
        {item.state === 'sug' ? (
          <Labelled label="Standing">
            <StandingChip standing={standing} />
          </Labelled>
        ) : null}
        {others.length ? (
          <>
            {/* The files do not say which values a worked-out one uses, so these are shown as neighbours and not as its inputs. */}
            <Labelled label={`Other values in ${field.section.name}`} />
            <ul className="overflow-hidden rounded-[10px] ring-1 ring-[var(--ring)]">
              {others.map((other, i) => (
                <li key={other.id} className={i > 0 ? 'border-t border-hairline' : undefined}>
                  <RowButton onClick={() => open.field(other.id)}>
                    <RowText>{other.item.l}</RowText>
                    <span className={FIGURE}>{fieldState(other, state) === 'empty' ? 'Not filled' : fieldValue(other, state)}</span>
                  </RowButton>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Pad>
    );
  };

  return (
    <>
      <ProofHead
        kind="Proof"
        title={`${item.l}: ${now === 'empty' ? 'not filled' : value || 'nothing'}`}
        note={typedOver ? `Changed by a person. ${item.from ? 'The page says' : 'The copilot suggested'} ${item.v}.` : undefined}
      />
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
            <History steps={story(field, now, state)} />
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
