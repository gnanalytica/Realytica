import { CONDITION_OPERATORS, describeGroup, type FlowCondition, type FlowConditionGroup } from '@realytica/shared';
import { Button, Input, Select, cn } from '../../components/ui/kit';

/**
 * Editing a test.
 *
 * The row reads left to right as the sentence it becomes — path, operator,
 * value — and the sentence is printed underneath from `describeGroup`, which
 * is the same function the rest of the app uses to say what a condition means.
 * Two renderings that could disagree is how a flow comes to do something its
 * own description says it will not.
 */

const OPERATOR_LABEL: Record<FlowCondition['operator'], string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  greater_than: 'is more than',
  less_than: 'is less than',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_true: 'is true',
  is_false: 'is false',
};

const UNARY = new Set<FlowCondition['operator']>(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

export function ConditionEditor({
  group,
  onChange,
  className,
}: {
  group: FlowConditionGroup;
  onChange: (next: FlowConditionGroup) => void;
  className?: string;
}) {
  const set = (index: number, patch: Partial<FlowCondition>) =>
    onChange({ ...group, conditions: group.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <Select
          value={group.match}
          className="w-28"
          aria-label="How the tests combine"
          onChange={(e) => onChange({ ...group, match: e.target.value as FlowConditionGroup['match'] })}
        >
          <option value="all">All of</option>
          <option value="any">Any of</option>
        </Select>
        <span className="text-[12px] text-ink-muted">these must hold</span>
      </div>

      {group.conditions.map((condition, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <Input
            value={condition.path}
            placeholder="count"
            aria-label="What to test"
            className="w-40 font-mono text-[12px]"
            onChange={(e) => set(i, { path: e.target.value })}
          />
          <Select
            value={condition.operator}
            aria-label="How to test it"
            className="w-36"
            onChange={(e) => set(i, { operator: e.target.value as FlowCondition['operator'] })}
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
            ))}
          </Select>
          {UNARY.has(condition.operator) ? null : (
            <Input
              value={condition.value ?? ''}
              placeholder="0"
              aria-label="Compared with"
              className="w-28"
              onChange={(e) => set(i, { value: e.target.value })}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove this test"
            onClick={() => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
          >
            ×
          </Button>
        </div>
      ))}

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange({ ...group, conditions: [...group.conditions, { path: '', operator: 'is_not_empty' }] })}
      >
        Add a test
      </Button>

      <p className="text-[11.5px] text-ink-muted">
        Carries on when <span className="text-ink-secondary">{describeGroup(group)}</span>.
      </p>
    </div>
  );
}
