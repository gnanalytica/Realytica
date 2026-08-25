import { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  Gavel,
  ListChecks,
  RefreshCw,
  Ruler,
  ShieldAlert,
  User,
} from 'lucide-react';
import type { ActionOwner, ActionPriority, RecommendedAction } from '@valytica/shared';
import type { TabProps } from '../tab-props';
import { api } from '../../../lib/api';
import { titleCase } from '../../../lib/format';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ProgressBar,
  Spinner,
  Toggle,
  cn,
  useToast,
} from '../../../components/ui/kit';

const PRIORITIES: ActionPriority[] = ['now', 'before_offer', 'before_completion'];

const PRIORITY_LABEL: Record<ActionPriority, string> = {
  now: 'Now',
  before_offer: 'Before offer',
  before_completion: 'Before completion',
};

const PRIORITY_FRAMING: Record<ActionPriority, string> = {
  now: 'Do these before anything else — they most affect whether to pursue at all.',
  before_offer: 'Resolve before you put in an offer or agree a price.',
  before_completion: 'Needed before completion, but should not block making an offer.',
};

const OWNER_ICON: Record<ActionOwner, typeof User> = {
  buyer: User,
  lawyer: Gavel,
  valuer: Ruler,
  lender: Banknote,
  seller: User,
  surveyor: Building2,
};

export default function ActionsTab({ caseData, result, refresh, runScreen, running, goToTab }: TabProps) {
  const toast = useToast();
  const [doneOverrides, setDoneOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [hideCompleted, setHideCompleted] = useState(false);

  const actions = useMemo(() => {
    if (!result) return [];
    return result.actions.map((a) => (doneOverrides[a.id] !== undefined ? { ...a, done: doneOverrides[a.id] } : a));
  }, [result, doneOverrides]);

  const total = actions.length;
  const doneCount = actions.filter((a) => a.done).length;
  const allDone = total > 0 && doneCount === total;

  async function toggleDone(action: RecommendedAction, next: boolean): Promise<void> {
    if (!result) return;
    setDoneOverrides((o) => ({ ...o, [action.id]: next }));
    setPending((p) => ({ ...p, [action.id]: true }));
    try {
      await api.setActionDone(caseData.id, action.id, next);
      toast(next ? 'Action marked done' : 'Action reopened', 'good');
      await refresh();
      setDoneOverrides((o) => {
        const nxt = { ...o };
        delete nxt[action.id];
        return nxt;
      });
    } catch {
      setDoneOverrides((o) => {
        const nxt = { ...o };
        nxt[action.id] = !next;
        return nxt;
      });
      toast('Could not update this action — please retry.', 'critical');
    } finally {
      setPending((p) => {
        const nxt = { ...p };
        delete nxt[action.id];
        return nxt;
      });
    }
  }

  if (!result) {
    return (
      <EmptyState
        icon={<ListChecks size={28} />}
        title="Not screened yet"
        description="Run the screen to get a concrete, owned, prioritised list of what to resolve before you proceed."
        action={
          <Button variant="primary" loading={running} onClick={() => void runScreen()}>
            Run screen
          </Button>
        }
      />
    );
  }

  const nowOpenCount = actions.filter((a) => a.priority === 'now' && !a.done).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 ring-1 ring-[var(--ring)]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">
            {doneCount} of {total} resolved
          </span>
          {total > 0 ? (
            <Toggle checked={hideCompleted} onChange={setHideCompleted} label="Hide completed" size="sm" />
          ) : null}
        </div>
        <ProgressBar value={total > 0 ? (doneCount / total) * 100 : 0} tone="good" showValue={false} />
        {nowOpenCount > 0 ? (
          <p className="text-xs text-ink-secondary">
            Resolving the {nowOpenCount} open &ldquo;Now&rdquo; item{nowOpenCount === 1 ? '' : 's'} is what would most
            change the verdict.
          </p>
        ) : null}
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<ListChecks size={24} />}
          title="No recommended actions"
          description="The screen did not surface any follow-up actions for this case."
        />
      ) : allDone ? (
        <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="All actions resolved"
          description="Nothing is left to resolve from this screen. Re-run the screen so the verdict and evidence reflect the progress you've made."
          action={
            <Button variant="secondary" icon={<RefreshCw size={14} />} loading={running} onClick={() => void runScreen()}>
              Re-run screen
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {PRIORITIES.map((priority) => {
            const group = actions.filter((a) => a.priority === priority);
            if (group.length === 0) return null;
            const visible = hideCompleted ? group.filter((a) => !a.done) : group;
            if (visible.length === 0) return null;
            const groupOpen = group.filter((a) => !a.done).length;
            return (
              <div key={priority} className="rounded-xl bg-surface ring-1 ring-[var(--ring)]">
                <div className="border-b border-hairline px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[13px] font-semibold text-ink">{PRIORITY_LABEL[priority]}</h3>
                    <span className="text-xs tabular text-ink-muted">
                      {groupOpen} open · {group.length} total
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-secondary">{PRIORITY_FRAMING[priority]}</p>
                </div>
                <ul>
                  {visible.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      pending={Boolean(pending[action.id])}
                      onToggleDone={(next) => void toggleDone(action, next)}
                      onJumpToRisks={() => goToTab('risks')}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  action,
  pending,
  onToggleDone,
  onJumpToRisks,
}: {
  action: RecommendedAction;
  pending: boolean;
  onToggleDone: (next: boolean) => void;
  onJumpToRisks: () => void;
}) {
  const OwnerIcon = OWNER_ICON[action.owner];
  return (
    <li className="border-b border-hairline px-4 py-3 last:border-0">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={action.done}
          disabled={pending}
          onChange={onToggleDone}
          label={
            <span className={cn('text-[13px] font-semibold text-ink', action.done && 'text-ink-muted line-through')}>
              {action.title}
            </span>
          }
        />
        {pending ? <Spinner size={12} className="mt-1" /> : null}
      </div>
      <div className={cn('ml-6 mt-1.5 flex flex-col gap-2', action.done && 'opacity-70')}>
        <p className={cn('text-xs leading-relaxed text-ink-secondary', action.done && 'line-through')}>
          {action.description}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" icon={<OwnerIcon size={11} />}>
            {titleCase(action.owner)}
          </Badge>
          <Badge tone="neutral">{titleCase(action.effort)} effort</Badge>
        </div>
        {action.unblocks.length > 0 ? (
          <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-secondary">
            {action.unblocks.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        ) : null}
        {action.relatedRiskIds.length > 0 ? (
          <Button variant="ghost" size="sm" icon={<ShieldAlert size={12} />} onClick={onJumpToRisks}>
            {action.relatedRiskIds.length} related risk{action.relatedRiskIds.length === 1 ? '' : 's'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
