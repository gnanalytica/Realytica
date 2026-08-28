import { useState } from 'react';
import { AlertOctagon, FlaskConical, Play, Trophy } from 'lucide-react';
import type {
  EvalComparison,
  EvalRanking,
  EvalRunResult,
  EvalTaskKind,
  ProviderId,
} from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ProgressBar, Select, cn, useToast } from './ui/kit';

/**
 * Comparing routes on the work this product actually does.
 *
 * "Which model is better" is not answerable. "Which model reads a Karnataka
 * khata extract without inventing a survey number" is, and it is the question
 * that decides whether a cheaper route is safe for a given agent.
 *
 * Two presentation decisions follow from that, and both are deliberate.
 *
 * The headline number is score against cost, not score. A route scoring 0.94
 * at a fifth of the price is the right answer for mechanical work and the
 * wrong one where a mistake is expensive; ranking on accuracy alone hides the
 * trade that a tier assignment is actually made on.
 *
 * Fabrication is shown separately and never averaged into the score. A model
 * that confidently supplies a survey number the document does not contain has
 * not scored slightly lower — it has produced the one failure this product
 * cannot ship, and a route with any fabrication is marked regardless of where
 * its arithmetic lands.
 */

const TASK_LABEL: Record<EvalTaskKind, string> = {
  document_extraction: 'Document extraction',
  grounding: 'Grounding',
  proof_routing: 'Proof routing',
  title_reasoning: 'Title reasoning',
};

const TASK_HINT: Record<EvalTaskKind, string> = {
  document_extraction: 'Fields pulled from a document, against known-correct values.',
  grounding: 'Whether claims made are supported by the evidence supplied.',
  proof_routing: 'Whether a route names a real authority, form and procedure.',
  title_reasoning: 'Whether title-chain reasoning reaches the right finding.',
};

function usd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function RankRow({ rank, row, best }: { rank: number; row: EvalRanking; best: number }) {
  const clean = row.fabrications === 0;
  return (
    <div className={cn('border-b border-hairline py-2.5 last:border-0', rank === 1 && '-mx-3 rounded-lg bg-brand-soft px-3')}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {rank === 1 && <Trophy size={13} className="text-brand" />}
        <span className="font-mono text-sm font-medium text-ink">{row.model}</span>
        {!clean && (
          <Badge tone="critical">
            {row.fabrications} fabrication{row.fabrications === 1 ? '' : 's'}
          </Badge>
        )}
        <span className="tabular ml-auto text-[11px] text-ink-muted">
          {usd(row.totalCostUsd)} · {Math.round(row.meanDurationMs)}ms
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <ProgressBar
          value={Math.round(row.meanScore * 100)}
          tone={!clean ? 'critical' : row.meanScore >= 0.9 ? 'good' : row.meanScore >= 0.75 ? 'warning' : 'serious'}
          className="flex-1"
        />
        <span className="tabular w-12 shrink-0 text-right text-[11px] text-ink">{(row.meanScore * 100).toFixed(1)}%</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted">
        <span className="tabular font-medium text-ink-secondary">
          {Number.isFinite(row.scorePerUsd) ? row.scorePerUsd.toFixed(1) : '—'}
        </span>{' '}
        score per dollar
        {best > 0 && Number.isFinite(row.scorePerUsd) && row.scorePerUsd < best && (
          <> — {(best / row.scorePerUsd).toFixed(1)}× less efficient than the leader</>
        )}
        {!clean && <span className="text-critical"> · not recommendable at any price while it fabricates</span>}
      </p>
    </div>
  );
}

function FailureList({ results }: { results: EvalRunResult[] }) {
  const failed = results.filter((r) => r.error);
  const fabricated = results.filter((r) => (r.score?.fabrications ?? 0) > 0);
  if (failed.length === 0 && fabricated.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      {fabricated.length > 0 && (
        <div className="rounded-lg bg-critical-soft p-3 ring-1 ring-critical">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <AlertOctagon size={13} className="text-critical" />
            Fabricated fields
          </p>
          {fabricated.slice(0, 6).map((r) => (
            <p key={`${r.evalCaseId}-${r.model}`} className="text-[11px] leading-relaxed text-ink-secondary">
              <span className="font-mono">{r.model}</span> on {r.evalCaseId}:{' '}
              {(r.score?.fields ?? [])
                .filter((f) => f.fabricated)
                .map((f) => `${f.key}="${f.actual}"`)
                .join(', ')}{' '}
              — the document does not contain {(r.score?.fields ?? []).filter((f) => f.fabricated).length === 1 ? 'this field' : 'these fields'}.
            </p>
          ))}
        </div>
      )}
      {failed.length > 0 && (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          {failed.length} run(s) failed outright and were excluded from the means rather than scored zero — a crashed
          call is not a wrong answer.
        </p>
      )}
    </div>
  );
}

export function EvalPanel({
  comparison,
  onRun,
  running,
  availableTasks,
}: {
  comparison: EvalComparison | null;
  onRun?: (taskKind: EvalTaskKind) => void;
  running?: boolean;
  availableTasks: EvalTaskKind[];
}) {
  const toast = useToast();
  const [task, setTask] = useState<EvalTaskKind>(availableTasks[0] ?? 'document_extraction');
  const best = comparison?.ranking.reduce((m, r) => (Number.isFinite(r.scorePerUsd) ? Math.max(m, r.scorePerUsd) : m), 0) ?? 0;

  return (
    <Card>
      <CardHeader
        title="Route evaluation"

        icon={<FlaskConical size={16} />}
        action={
          onRun ? (
            <div className="flex items-center gap-2">
              <Select value={task} onChange={(e) => setTask(e.target.value as EvalTaskKind)} className="w-44">
                {availableTasks.map((t) => (
                  <option key={t} value={t}>
                    {TASK_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                icon={<Play size={13} />}
                loading={running}
                onClick={() => {
                  if (!onRun) return;
                  toast(`Running ${TASK_LABEL[task]} across every configured route — this spends real tokens.`, 'info');
                  onRun(task);
                }}
              >
                Run
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody>
        <p className="mb-3 text-xs leading-relaxed text-ink-secondary">{TASK_HINT[task]}</p>
        {!comparison ? (
          <EmptyState
            icon={<FlaskConical size={22} />}
            title="No comparison yet"
            description="Run an evaluation to see how each configured route performs on this product's own work, with known-correct answers taken from the deterministic engine rather than hand-labelled."
          />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
              <Badge tone="neutral">{TASK_LABEL[comparison.taskKind]}</Badge>
              <span>{comparison.results.length} run(s) across {comparison.routes.length} route(s)</span>
              {comparison.skipped.length > 0 && (
                <Badge tone="warning">{comparison.skipped.length} skipped</Badge>
              )}
            </div>
            {comparison.ranking.map((r, i) => (
              <RankRow key={`${r.provider}-${r.model}`} rank={i + 1} row={r} best={best} />
            ))}
            <FailureList results={comparison.results} />
            {comparison.skipped.length > 0 && (
              <div className="mt-3 rounded-lg bg-sunken p-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Skipped</p>
                {comparison.skipped.map((s) => (
                  <p key={s.evalCaseId} className="text-[11px] leading-relaxed text-ink-secondary">
                    {s.evalCaseId} — {s.reason}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
