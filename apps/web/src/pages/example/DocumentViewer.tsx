import { Button, Modal, useToast } from '../../components/ui/kit';
import { fieldState, fieldValue, fieldsIn, hash, slotById, slotState, type FieldRef, type SlotRef } from './engine';
import { FIGURE, RowButton, RowText, StateDot } from './parts';
import { useOpen } from './place';
import { useExample } from './state';
import { Sheet, type SheetLine } from './Sheet';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted';
const TERMS = 'grid gap-x-3 gap-y-1.5 text-[13px] text-ink [grid-template-columns:max-content_minmax(0,1fr)]';

/** The paper's page beside what was read from it, or a plain word that it is not in hand. */
function Paper({ slot, read, meta }: { slot: SlotRef; read: FieldRef[]; meta: string }) {
  const { state } = useExample();
  const open = useOpen();
  const inHand = slotState(slot, state) === 'in';
  const lines = read.map((y): SheetLine => {
    const now = fieldState(y, state);
    return { id: y.id, label: y.item.l, value: fieldValue(y, state), state: now === 'set' ? 'ok' : now === 'no' ? 'no' : 'wait' };
  });

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div className="min-w-0 rounded-xl bg-sunken p-4">
        {inHand ? (
          <Sheet large title={slot.line.t} page={1} lines={lines} onPick={open.field} />
        ) : (
          <div className="grid min-h-60 place-content-center justify-items-center gap-1 text-[13px] text-ink-muted">
            <b className="text-[15px] font-semibold text-ink">Not in hand yet</b>
            <span>{meta}</span>
          </div>
        )}
      </div>
      <aside className="grid content-start gap-2.5">
        {inHand ? (
          <>
            <h3 className={LABEL}>Read from it</h3>
            {read.length ? (
              <ul className="overflow-hidden rounded-[10px] ring-1 ring-[var(--ring)]">
                {read.map((y, i) => (
                  <li key={y.id} className={i > 0 ? 'border-t border-hairline' : undefined}>
                    <RowButton onClick={() => open.field(y.id)}>
                      <RowText>{y.item.l}</RowText>
                      <span className={FIGURE}>{fieldValue(y, state)}</span>
                    </RowButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">Nothing read.</p>
            )}
            <h3 className={LABEL}>File</h3>
            <dl className={TERMS}>
              <dt className="text-ink-muted">Pages</dt>
              <dd>{slot.line.pages ?? 4 + (hash(slot.line.t) % 30)}</dd>
              <dt className="text-ink-muted">Used in</dt>
              <dd>{slot.fn.name}</dd>
            </dl>
          </>
        ) : (
          <>
            <h3 className={LABEL}>Status</h3>
            <dl className={TERMS}>
              <dt className="text-ink-muted">State</dt>
              <dd>{meta}</dd>
            </dl>
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * A paper, opened large over the workspace: its page with the words that
 * were read marked, what was read from it, and what can be done with it.
 * Pressing a value closes the paper and shows that value where it lives.
 */
export function DocumentViewer() {
  const { state, dispatch } = useExample();
  const toast = useToast();
  const slot = state.viewing ? slotById(state.viewing) : undefined;
  const now = slot ? slotState(slot, state) : 'none';
  const meta = now === 'in' ? 'In hand' : now === 'asked' ? `Asked${slot?.line.due ? ` · due ${slot.line.due}` : ''}` : 'Not asked';
  const read = slot ? fieldsIn(slot.fn).filter((y) => y.item.from === slot.line.t) : [];

  return (
    <Modal
      open={Boolean(slot)}
      onClose={() => dispatch({ type: 'view', id: null })}
      width="lg"
      title={
        slot ? (
          <>
            <StateDot state={now} />
            <span className="ml-2">{slot.line.t}</span>
            <span className="ml-2 font-normal text-ink-muted">{meta}</span>
          </>
        ) : null
      }
      footer={
        !slot ? null : now === 'in' ? (
          <>
            <Button onClick={() => toast('Downloads the file.')}>Download</Button>
            <Button variant="primary" onClick={() => toast('Opens the file.')}>
              Open the file
            </Button>
          </>
        ) : now === 'asked' ? (
          <Button variant="primary" onClick={() => toast('Reminder sent.')}>
            Remind
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: 'mark', what: 'asked', ids: [slot.id] });
              toast('Asked.');
            }}
          >
            Ask for it
          </Button>
        )
      }
    >
      {slot ? <Paper slot={slot} read={read} meta={meta} /> : null}
    </Modal>
  );
}
