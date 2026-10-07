import { Link } from 'react-router-dom';
import { Table2 } from 'lucide-react';
import { AiMark, Button, cn } from '../../components/ui/kit';
import { DepartmentPicker, FunctionTabs, StageTrack, type FunctionTab, type PickerItem, type TrackStage } from '../../components/workspace/WorkspaceBar';
import { summary, waitingIn } from './engine';
import { examplePath } from './paths';
import { useOpen, usePlace } from './place';
import { DEPARTMENTS, PROJECT_NAME, STAGES, fnsOf, runs, when } from './spec';
import { useExample } from './state';

const OVERVIEW = 'overview';
const SUMMARY = 'summary';

/**
 * The top of the work, which stays put while the page under it scrolls.
 *
 * One line says which project this is, that its data is made up, and the way
 * to the product itself. The next says where you are (the department) and
 * when (the stage being looked at). Under them, one tab for each function
 * the department has work in at that stage. A dot on a department or a tab
 * means something the copilot suggested there still waits for a person.
 */
export function WorkBar({ scrolled, copilotOpen, onCopilot }: { scrolled: boolean; copilotOpen: boolean; onCopilot: () => void }) {
  const place = usePlace();
  const open = useOpen();
  const { state } = useExample();

  const departments: PickerItem[] = DEPARTMENTS.filter((dept) => runs(dept, place.stage)).map((dept) => {
    const sum = summary(dept, place.stage, state);
    const waiting = sum.waiting.length;
    return { key: dept.key, label: dept.label, note: `${sum.ready}% ready${waiting ? ` · ${waiting} waiting` : ''}`, waiting: waiting > 0 };
  });
  const stages: TrackStage[] = STAGES.map((stage) => ({ key: stage.key, label: stage.label, when: when(stage.key) }));
  const dept = place.dept;
  const tabs: FunctionTab[] = dept
    ? [{ key: SUMMARY, label: 'Summary' }, ...fnsOf(dept, place.stage).map((fn) => ({ key: fn.name, label: fn.name, waiting: waitingIn(fn, state).length > 0 }))]
    : [];

  return (
    <header
      className={cn(
        'relative z-10 shrink-0 border-b border-hairline bg-surface transition-shadow duration-base ease-state',
        scrolled && 'shadow-[0_10px_18px_-16px_rgba(var(--shadow-tint),0.5)]',
      )}
    >
      <div className={cn('mx-auto grid max-w-[1440px] gap-1 px-5 pt-2', !dept && 'pb-2')}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-muted">
          <Link
            to={examplePath(undefined, undefined, { stage: place.stage })}
            title="Overview of the project"
            className="shrink-0 font-semibold uppercase tracking-[0.09em] transition-colors duration-quick ease-state hover:text-brand-strong"
          >
            {PROJECT_NAME}
          </Link>
          {/* Never cut short: on a narrow bar the label is the shorter one, whole. */}
          <span className="shrink-0 whitespace-nowrap">
            <span className="[@container(min-width:25rem)]:hidden">Made-up data</span>
            <span className="hidden [@container(min-width:25rem)]:inline">Example, made-up data</span>
          </span>
          <Link to="/" className="ml-auto shrink-0 font-medium text-brand hover:underline">
            Realytica
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* First on its line, so its menu opens from the left edge and fits a phone. */}
          <DepartmentPicker
            label={dept ? dept.label : 'Overview'}
            current={dept ? dept.key : OVERVIEW}
            groups={[[{ key: OVERVIEW, label: 'Overview', icon: Table2 }], departments]}
            onPick={(key) => open.to(DEPARTMENTS.find((d) => d.key === key) ?? null)}
          />
          {/* On a wide screen the copilot has its own column and needs no button. */}
          <Button size="sm" className="xl:hidden" icon={<AiMark size="xs" />} aria-haspopup="dialog" aria-expanded={copilotOpen} onClick={onCopilot}>
            Copilot
          </Button>
          <StageTrack
            className="flex-1 basis-60"
            stages={stages}
            picked={dept ? place.stage : null}
            onPick={(key) => {
              const stage = STAGES.find((s) => s.key === key);
              if (stage) open.stage(stage.key);
            }}
          />
        </div>
        {dept ? (
          <FunctionTabs
            tabs={tabs}
            current={place.fn ? place.fn.name : SUMMARY}
            onPick={(key) => open.to(dept, dept.functions.find((fn) => fn.name === key) ?? null)}
          />
        ) : null}
      </div>
    </header>
  );
}
