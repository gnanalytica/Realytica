import { Card, cn } from '../../components/ui/kit';
import { WaitDot } from '../../components/workspace/WorkspaceBar';
import { showing } from './chat';
import { summary } from './engine';
import { EXAMPLE_STAGE_NOW, type ExampleStage } from './paths';
import { Bar, Blank, Capped, Group, RowButton, RowText } from './parts';
import { useOpen } from './place';
import { DEPARTMENTS, STAGES, placeLabel, runs } from './spec';
import { useExample } from './state';
import type { Department } from './types';

const HEADING = 'px-1 text-left text-[12px] font-semibold text-ink-secondary';

/** One department at one stage: how much of its paper is in hand, and whether something waits there. */
function Cell({ dept, stage }: { dept: Department; stage: ExampleStage }) {
  const { state } = useExample();
  const open = useOpen();
  const sum = summary(dept, stage, state);
  return (
    <button
      type="button"
      aria-label={`${placeLabel(dept, stage)}, ${sum.ready}% ready`}
      onClick={() => open.to(dept, null, { stage })}
      className={cn(
        'grid w-full gap-[5px] rounded-[10px] border bg-surface px-2.5 py-2 text-left text-[12px] text-ink-secondary transition-colors duration-quick ease-state',
        stage === EXAMPLE_STAGE_NOW ? 'border-brand ring-1 ring-inset ring-brand' : 'border-hairline hover:border-[var(--text-muted)]',
      )}
    >
      <Bar value={sum.ready} />
      <span className="flex items-center gap-1.5">
        {sum.ready}% ready
        {sum.waiting.length ? <WaitDot /> : null}
      </span>
    </button>
  );
}

/**
 * The project as a whole: every department against every stage, and what
 * the copilot has suggested that still waits for a person: values it read,
 * descriptions of photographs, answers, entries in a chain. Each cell opens
 * that department at that stage; each thing waiting opens where it lives.
 */
export function Overview() {
  const { state } = useExample();
  const open = useOpen();
  const waiting = DEPARTMENTS.filter((dept) => runs(dept, EXAMPLE_STAGE_NOW)).flatMap((dept) => summary(dept, EXAMPLE_STAGE_NOW, state).waiting);

  return (
    <>
      <h1 className="mt-1 text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">Overview</h1>
      <Card className="overflow-x-auto p-2">
        <table className="w-full min-w-[540px] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <td />
              {STAGES.map((stage) => (
                <th key={stage.key} scope="col" className={HEADING}>
                  {stage.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((dept) => (
              <tr key={dept.key}>
                <th scope="row" className={HEADING}>
                  {dept.label}
                </th>
                {STAGES.map((stage) => (
                  <td key={stage.key} className="p-0">
                    {runs(dept, stage.key) ? (
                      <Cell dept={dept} stage={stage.key} />
                    ) : (
                      <div className="rounded-[10px] border border-dashed border-[var(--axis)] px-2.5 py-2 text-[12px] text-ink-muted">Not running</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Group title="Waiting to be accepted" note={String(waiting.length)}>
        {waiting.length ? (
          <Capped id="overview:waiting" items={waiting} cap={5}>
            {(waits) => (
              <li key={waits.id} className="border-t border-hairline">
                <RowButton onClick={() => open.act(showing(waits))}>
                  <RowText sub={waits.sub || undefined}>{waits.t}</RowText>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-secondary">
                    {waits.dept.label} · {waits.fn.name}
                  </span>
                </RowButton>
              </li>
            )}
          </Capped>
        ) : (
          <Blank>Nothing is waiting.</Blank>
        )}
      </Group>
    </>
  );
}
