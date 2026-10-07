import { Button, Modal, useToast } from '../../components/ui/kit';
import { changed, fieldValue, homeOf, linesOf, readFrom, slotById, slotState, type FieldRef, type SlotRef } from './engine';
import { FIGURE, RowButton, RowText, StateDot } from './parts';
import { useOpen, usePlace } from './place';
import { useExample } from './state';
import { Sheet, sheetLine } from './Sheet';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted';
const TERMS = 'grid gap-x-3 gap-y-1.5 text-[13px] text-ink [grid-template-columns:max-content_minmax(0,1fr)]';

/** "Legal · Approvals": the function something sits in. */
const fnLabel = (x: FieldRef | SlotRef): string => `${x.dept.label} · ${x.fn.name}`;

/** The paper's pages beside what was read from them, or a plain word that it is not in hand. */
function Paper({ paper, read, meta }: { paper: SlotRef; read: FieldRef[]; meta: string }) {
  const { state } = useExample();
  const open = useOpen();
  const inHand = slotState(paper, state) === 'in';
  // One sheet for each page something was read from, each with only its own values. A paper nothing was read from shows one ruled page.
  const pages = [...new Set(read.map((x) => x.item.page ?? 1))].sort((a, b) => a - b);
  const users = [...new Set(linesOf(paper).map(fnLabel))];

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_17.5rem]">
      <div className="grid min-w-0 gap-4 rounded-xl bg-sunken p-4">
        {inHand ? (
          (pages.length ? pages : [1]).map((page) => (
            <Sheet
              key={page}
              large
              title={paper.line.t}
              page={page}
              lines={read.filter((x) => (x.item.page ?? 1) === page).map((x) => sheetLine(x, state))}
              onPick={open.field}
            />
          ))
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
                {read.map((x, i) => (
                  <li key={x.id} className={i > 0 ? 'border-t border-hairline' : undefined}>
                    <RowButton onClick={() => open.field(x.id)}>
                      {/* What the page says. Where it is used is named when that is another function; a value typed over it is named too. */}
                      <RowText sub={[x.fn !== paper.fn ? fnLabel(x) : '', changed(x, state) ? `Changed by a person to ${fieldValue(x, state) || 'nothing'}` : ''].filter(Boolean).join(' · ')}>
                        {x.item.l}
                      </RowText>
                      <span className={FIGURE}>{x.item.v}</span>
                    </RowButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">Nothing read.</p>
            )}
            <h3 className={LABEL}>File</h3>
            <dl className={TERMS}>
              {paper.line.pages ? (
                <>
                  <dt className="text-ink-muted">Pages</dt>
                  <dd>{paper.line.pages}</dd>
                </>
              ) : null}
              <dt className="text-ink-muted">Used in</dt>
              <dd>{users.join(', ')}</dd>
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
 * A paper, opened large over the workspace: its pages with the words that
 * were read marked, what every function read from it, and what can be done
 * with it. It is open only on the page it was opened on. Pressing a value
 * closes the paper and shows that value where it lives.
 */
export function DocumentViewer() {
  const { state, dispatch } = useExample();
  const here = usePlace();
  const toast = useToast();
  const line = state.viewing && state.viewing.at === here.key ? slotById(state.viewing.id) : undefined;
  const paper = line ? homeOf(line) : undefined;
  const now = paper ? slotState(paper, state) : 'none';
  const meta = now === 'in' ? 'In hand' : now === 'asked' ? `Asked${paper?.line.due ? ` · due ${paper.line.due}` : ''}` : 'Not asked';

  return (
    <Modal
      open={Boolean(paper)}
      onClose={() => dispatch({ type: 'view', viewing: null })}
      width="lg"
      title={
        paper ? (
          <>
            <StateDot state={now} />
            <span className="ml-2">{paper.line.t}</span>{' '}
            <span className="ml-1 font-normal text-ink-muted">{meta}</span>
          </>
        ) : null
      }
      footer={
        !paper ? null : now === 'in' ? (
          <>
            <Button onClick={() => toast('Downloads the file.')}>Download</Button>
            <Button variant="primary" onClick={() => toast('Opens the file.')}>
              Open the file
            </Button>
          </>
        ) : now === 'asked' ? (
          <Button variant="primary" onClick={() => toast('Sends a reminder.')}>
            Remind
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              dispatch({ type: 'mark', what: 'asked', ids: [paper.id] });
              toast('Asks for the paper.');
            }}
          >
            Ask for it
          </Button>
        )
      }
    >
      {paper ? <Paper paper={paper} read={readFrom(paper)} meta={meta} /> : null}
    </Modal>
  );
}
