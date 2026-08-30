import { useMemo, useState } from 'react';
import { ArrowLeftRight, GitCompareArrows } from 'lucide-react';
import type { PromptDescriptor, PromptVersion } from '@realytica/shared';
import { Badge, Button, Select, Toggle, cn } from '../ui/kit';
import { activeVersion, builtInVersion, versionsNewestFirst } from './InvariantList';

/**
 * Line diff between two versions of one prompt.
 *
 * The question this answers is almost always the same one — *what have we
 * changed from the shipped text?* — so the default comparison is built-in
 * against active rather than the two most recent versions. Someone arriving
 * here because a run looked wrong wants the distance from the known-good
 * baseline, not the last incremental tweak.
 *
 * Written by hand rather than pulled in as a dependency: an LCS line diff is
 * forty lines, and a diligence tool should not add a package to the
 * dependency surface to draw one.
 *
 * Additions and removals are distinguished by a gutter marker and a word in
 * the legend as well as by colour. Colour alone would make the single most
 * consequential screen in this feature unreadable to a colour-blind reviewer,
 * and "which lines did this version delete" is exactly the question that must
 * never depend on hue.
 */

export type DiffOp = 'context' | 'add' | 'remove';

export interface DiffRow {
  op: DiffOp;
  text: string;
  /** 1-based line number in the left (older) text; absent on additions. */
  leftNo?: number;
  /** 1-based line number in the right (newer) text; absent on removals. */
  rightNo?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Above this many cells the quadratic table is not worth building. Prompts run
 * to tens of lines, so this is a guard against pathological input rather than
 * a case anyone will meet; when it trips, the whole text is reported as
 * replaced, which is true if uninformative — never a silently truncated diff.
 */
const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  // A trailing newline should not read as an extra empty line in the diff.
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalised === '' ? [] : normalised.split('\n');
}

/**
 * Longest-common-subsequence line diff.
 *
 * Common prefix and suffix are trimmed first — that is what makes an edit to
 * one line of a sixty-line preamble cost almost nothing — and the LCS table is
 * built only over the differing middle. Ordering convention within a changed
 * hunk is removals before additions, so a rewritten line reads "was / now".
 */
export function diffLines(left: string, right: string): DiffRow[] {
  const a = splitLines(left);
  const b = splitLines(right);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ op: 'context', text: a[i], leftNo: i + 1, rightNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (let i = 0; i < n; i++) rows.push({ op: 'remove', text: midA[i], leftNo: start + i + 1 });
    for (let j = 0; j < m; j++) rows.push({ op: 'add', text: midB[j], rightNo: start + j + 1 });
  } else {
    // dp[i * (m + 1) + j] = length of the LCS of midA[i..] and midB[j..].
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
            : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        rows.push({ op: 'context', text: midA[i], leftNo: start + i + 1, rightNo: start + j + 1 });
        i++;
        j++;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
        rows.push({ op: 'remove', text: midA[i], leftNo: start + i + 1 });
        i++;
      } else {
        rows.push({ op: 'add', text: midB[j], rightNo: start + j + 1 });
        j++;
      }
    }
    while (i < n) {
      rows.push({ op: 'remove', text: midA[i], leftNo: start + i + 1 });
      i++;
    }
    while (j < m) {
      rows.push({ op: 'add', text: midB[j], rightNo: start + j + 1 });
      j++;
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    rows.push({ op: 'context', text: a[endA + k], leftNo: endA + k + 1, rightNo: endB + k + 1 });
  }

  return rows;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  return {
    added: rows.filter((r) => r.op === 'add').length,
    removed: rows.filter((r) => r.op === 'remove').length,
    unchanged: rows.filter((r) => r.op === 'context').length,
  };
}

/* ------------------------------------------------------------------ */
/* Collapsing                                                          */
/* ------------------------------------------------------------------ */

interface GapRow {
  op: 'gap';
  count: number;
}

type RenderRow = DiffRow | GapRow;

const CONTEXT_LINES = 3;

/** Long unchanged stretches become one "… n unchanged lines" marker, never a silent omission. */
function collapse(rows: DiffRow[]): RenderRow[] {
  const out: RenderRow[] = [];
  let run: DiffRow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length <= CONTEXT_LINES * 2 + 1) {
      out.push(...run);
    } else {
      const head = out.length === 0 ? [] : run.slice(0, CONTEXT_LINES);
      const tailStart = run.length - CONTEXT_LINES;
      out.push(...head);
      out.push({ op: 'gap', count: tailStart - head.length });
      out.push(...run.slice(tailStart));
    }
    run = [];
  };

  for (const row of rows) {
    if (row.op === 'context') run.push(row);
    else {
      flush();
      out.push(row);
    }
  }
  // A trailing run is collapsed with no tail: nothing follows it that needs context.
  if (run.length > CONTEXT_LINES + 1) {
    out.push(...run.slice(0, CONTEXT_LINES));
    out.push({ op: 'gap', count: run.length - CONTEXT_LINES });
    run = [];
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

function versionOptionLabel(v: PromptVersion, prompt: PromptDescriptor): string {
  const marks: string[] = [];
  if (v.builtIn) marks.push('built-in');
  if (v.id === prompt.activeVersionId) marks.push('active');
  return `v${v.version} — ${v.label}${marks.length ? ` (${marks.join(', ')})` : ''}`;
}

const MARKER: Record<DiffOp, string> = { add: '+', remove: '−', context: ' ' };
const OP_WORD: Record<DiffOp, string> = { add: 'added', remove: 'removed', context: 'unchanged' };

export function PromptDiff({ prompt, className }: { prompt: PromptDescriptor; className?: string }) {
  const versions = versionsNewestFirst(prompt);
  const builtIn = builtInVersion(prompt);
  const active = activeVersion(prompt);

  // Uncontrolled, but re-derived whenever the prompt changes — keying the
  // component by prompt.key in the parent is what makes that safe.
  const [leftId, setLeftId] = useState<string>(builtIn?.id ?? versions[versions.length - 1]?.id ?? '');
  const [rightId, setRightId] = useState<string>(active?.id ?? versions[0]?.id ?? '');
  const [onlyChanges, setOnlyChanges] = useState(true);

  // Resolved with a fallback rather than held as authoritative state: a version
  // can be deleted while it is selected here, and a diff pane that silently
  // renders nothing is worse than one that drops back to the baseline pair.
  const left = prompt.versions.find((v) => v.id === leftId) ?? builtIn;
  const right = prompt.versions.find((v) => v.id === rightId) ?? active;

  const rows = useMemo(() => diffLines(left?.content ?? '', right?.content ?? ''), [left?.content, right?.content]);
  const stats = diffStats(rows);
  const shown = onlyChanges ? collapse(rows) : rows;

  /*
   * The guardrail delta, not just the text delta.
   *
   * Two versions can differ by one deleted sentence and that sentence can be
   * the anti-fabrication rule. Someone reading a diff to decide whether a
   * change is safe should not have to recognise which line mattered, so the
   * change in guarantees is stated above the text.
   */
  const guardrailsLost = useMemo(() => {
    if (!left || !right) return [];
    const keptOnLeft = new Set(left.invariants.filter((i) => i.satisfied).map((i) => i.id));
    return right.invariants.filter((i) => !i.satisfied && keptOnLeft.has(i.id));
  }, [left, right]);

  if (prompt.versions.length < 2) {
    return (
      <div className={cn('rounded-lg bg-sunken p-4 text-xs leading-relaxed text-ink-secondary', className)}>
        There is only the built-in version, so there is nothing to compare it against. A diff appears here as soon as
        a second version exists.
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-mini font-medium text-ink-secondary">From (baseline)</span>
          <Select value={left?.id ?? ''} onChange={(e) => setLeftId(e.target.value)} aria-label="Baseline version">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {versionOptionLabel(v, prompt)}
              </option>
            ))}
          </Select>
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="mb-0.5"
          icon={<ArrowLeftRight size={13} />}
          onClick={() => {
            setLeftId(right?.id ?? rightId);
            setRightId(left?.id ?? leftId);
          }}
        >
          Swap
        </Button>
        <label className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-mini font-medium text-ink-secondary">To</span>
          <Select value={right?.id ?? ''} onChange={(e) => setRightId(e.target.value)} aria-label="Compared version">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {versionOptionLabel(v, prompt)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {guardrailsLost.length > 0 ? (
        <div className="rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40" data-testid="diff-guardrail-delta">
          <p className="text-xs font-semibold text-critical">
            This change gives up {guardrailsLost.length} guardrail{guardrailsLost.length > 1 ? 's' : ''} the baseline
            keeps.
          </p>
          <ul className="mt-1 space-y-0.5">
            {guardrailsLost.map((g) => (
              <li key={g.id} className="text-mini leading-relaxed text-ink-secondary">
                <span className="font-medium text-ink">{g.label}</span> — {g.rationale}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Badge tone="good">
            <span aria-hidden="true" className="font-mono">
              +
            </span>
            {stats.added} added
          </Badge>
          <Badge tone="critical">
            <span aria-hidden="true" className="font-mono">
              &minus;
            </span>
            {stats.removed} removed
          </Badge>
          <span className="text-ink-muted">{stats.unchanged} unchanged</span>
        </div>
        <Toggle checked={onlyChanges} onChange={setOnlyChanges} label="Collapse unchanged lines" size="sm" />
      </div>

      {stats.added === 0 && stats.removed === 0 ? (
        <div className="rounded-lg bg-sunken p-4 text-xs text-ink-secondary">
          These two versions have identical text. They may still differ in label, notes or recorded guardrail results.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg ring-1 ring-inset ring-[var(--ring)]">
          <table className="w-full border-collapse font-mono text-mini leading-[1.6]">
            <caption className="sr-only">
              Line diff from {left ? `version ${left.version}` : 'nothing'} to{' '}
              {right ? `version ${right.version}` : 'nothing'}
            </caption>
            <tbody>
              {shown.map((row, index) =>
                row.op === 'gap' ? (
                  <tr key={`gap-${index}`} className="bg-sunken">
                    <td colSpan={4} className="px-3 py-1 text-center text-micro text-ink-muted">
                      &middot;&middot;&middot; {row.count} unchanged line{row.count > 1 ? 's' : ''} &middot;&middot;&middot;
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={`${row.op}-${row.leftNo ?? 'x'}-${row.rightNo ?? 'x'}-${index}`}
                    className={cn(
                      row.op === 'add' && 'bg-good/10',
                      row.op === 'remove' && 'bg-critical/10',
                    )}
                  >
                    <td className="w-10 select-none border-r border-hairline px-1.5 text-right align-top text-micro text-ink-muted">
                      {row.leftNo ?? ''}
                    </td>
                    <td className="w-10 select-none border-r border-hairline px-1.5 text-right align-top text-micro text-ink-muted">
                      {row.rightNo ?? ''}
                    </td>
                    <td
                      className={cn(
                        'w-5 select-none px-1 text-center align-top font-semibold',
                        row.op === 'add' && 'text-[var(--status-good-text)]',
                        row.op === 'remove' && 'text-critical',
                        row.op === 'context' && 'text-ink-muted',
                      )}
                      aria-hidden="true"
                    >
                      {MARKER[row.op]}
                    </td>
                    <td
                      className={cn(
                        'whitespace-pre-wrap break-words px-2 align-top',
                        row.op === 'context' ? 'text-ink-secondary' : 'text-ink',
                      )}
                    >
                      <span className="sr-only">{OP_WORD[row.op]}: </span>
                      {row.text === '' ? ' ' : row.text}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-mini leading-relaxed text-ink-muted">
        <GitCompareArrows size={12} className="mt-0.5 shrink-0" />
        <span>
          Markers rather than colour carry the meaning: <span className="font-mono">+</span> is a line this version
          adds, <span className="font-mono">&minus;</span> a line it removes. Line numbers are shown for the baseline
          and the compared version in that order.
        </span>
      </p>
    </div>
  );
}

export default PromptDiff;
