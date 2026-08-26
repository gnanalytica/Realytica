import { useMemo, useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronUp, Gauge, Quote, ShieldQuestion } from 'lucide-react';
import type { CriticFinding, CriticVerdict, VerificationSummary } from '@realytica/shared';
import { Badge, Card, CardBody, CardHeader, EmptyState, ProgressBar, cn, type Tone } from './ui/kit';

/**
 * The critic's output — grouped so the claims a reader should distrust surface
 * first, not last. `unsupportedSpecifics` is the whole point of this file: a
 * fabricated fee or service code reads exactly like a real one, so it gets its
 * own bordered, monospaced treatment rather than blending into prose.
 *
 * `findFlaggedCriticFinding` and `CriticFlagBanner` are exported for reuse —
 * anywhere else in the app that renders something the critic checked (a proof
 * route, a pathway, an insight, a research finding) must show the same flag
 * inline, not leave it discoverable only from this panel.
 */

const VERDICT_RANK: Record<CriticVerdict, number> = { contradicted: 0, unsupported: 1, partly_supported: 2, supported: 3 };

const VERDICT_LABEL: Record<CriticVerdict, string> = {
  contradicted: 'Contradicted',
  unsupported: 'Unsupported',
  partly_supported: 'Partly supported',
  supported: 'Supported',
};

const VERDICT_TONE: Record<CriticVerdict, Tone> = {
  contradicted: 'critical',
  unsupported: 'serious',
  partly_supported: 'warning',
  supported: 'good',
};

const VERDICT_EXPLANATION: Record<CriticVerdict, string> = {
  contradicted: 'The evidence on file says something different from this claim.',
  unsupported: 'Nothing on file backs this claim — treat it as unverified, not necessarily false.',
  partly_supported: 'Part of this claim checks out; part of it goes further than the evidence supports.',
  supported: 'The evidence on file backs this claim.',
};

const TARGET_KIND_LABEL: Record<CriticFinding['targetKind'], string> = {
  proof_route: 'Proof route',
  pathway: 'Document pathway',
  insight: 'Insight',
  research_finding: 'Research finding',
  copilot_answer: 'Copilot answer',
};

function groundingTone(score: number): Tone {
  if (score >= 90) return 'good';
  if (score >= 70) return 'brand';
  if (score >= 40) return 'warning';
  return 'critical';
}

function groundingReading(score: number, checkedCount: number): string {
  if (checkedCount === 0) return 'The critic had nothing to check on this run.';
  if (score >= 90) return 'Nearly everything checked holds up against this case’s own evidence.';
  if (score >= 70) return 'Most checked claims hold up — read the flagged ones below before acting on them.';
  if (score >= 40) return 'A meaningful share of checked claims are not backed by the evidence on file.';
  return 'Most checked claims could not be verified against the evidence — treat this run’s output with real caution.';
}

/** Looks up the critic finding behind a flagged target, for inline use outside this panel. */
export function findFlaggedCriticFinding(
  verification: VerificationSummary | undefined,
  targetKind: CriticFinding['targetKind'],
  targetId: string,
): CriticFinding | undefined {
  if (!verification || !verification.flaggedIds.includes(targetId)) return undefined;
  return verification.findings.find((f) => f.targetKind === targetKind && f.targetId === targetId);
}

/**
 * Compact, unmissable inline warning for anywhere a critic-checked item is
 * rendered outside this panel — a proof route in the pathways list, an
 * insight card, a research finding. Same visual language every time, so a
 * flag is recognisable wherever it shows up.
 */
export function CriticFlagBanner({ finding, compact }: { finding: CriticFinding; compact?: boolean }) {
  const tone = VERDICT_TONE[finding.verdict];
  return (
    <div
      className={cn(
        'rounded-lg p-2.5 ring-1 ring-inset',
        tone === 'critical' ? 'bg-critical/10 ring-critical/40' : 'bg-serious/10 ring-serious/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <AlertOctagon size={13} className={tone === 'critical' ? 'text-critical' : 'text-ink'} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink">
          Critic flagged this claim — {VERDICT_LABEL[finding.verdict]}
        </span>
      </div>
      {!compact ? <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{finding.reasoning}</p> : null}
      {finding.unsupportedSpecifics.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {finding.unsupportedSpecifics.map((s, i) => (
            <li
              key={i}
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-critical ring-1 ring-inset ring-critical/30"
            >
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FindingCard({ finding }: { finding: CriticFinding }) {
  const [expanded, setExpanded] = useState(finding.verdict === 'contradicted' || finding.verdict === 'unsupported');
  const tone = VERDICT_TONE[finding.verdict];
  const flagged = finding.verdict === 'unsupported' || finding.verdict === 'contradicted';
  return (
    <div
      className={cn(
        'rounded-lg ring-1 ring-inset',
        flagged ? 'bg-critical/5 ring-critical/30' : tone === 'warning' ? 'bg-warning/5 ring-warning/30' : 'ring-[var(--ring)]',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tone}>{VERDICT_LABEL[finding.verdict]}</Badge>
            <Badge tone="neutral">{TARGET_KIND_LABEL[finding.targetKind]}</Badge>
            <span className="truncate text-[13px] font-semibold text-ink">{finding.targetLabel}</span>
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-relaxed text-ink">
            <Quote size={12} className="mt-1 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="italic">&ldquo;{finding.claim}&rdquo;</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-ink-muted">{Math.round(finding.confidence * 100)}%</span>
          {expanded ? <ChevronUp size={14} className="text-ink-muted" /> : <ChevronDown size={14} className="text-ink-muted" />}
        </div>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-hairline px-3.5 py-3">
          <p className="text-xs leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink">{VERDICT_EXPLANATION[finding.verdict]}</span> {finding.reasoning}
          </p>

          {finding.unsupportedSpecifics.length > 0 ? (
            <div className="rounded-lg bg-critical/10 p-3 ring-1 ring-inset ring-critical/40">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-critical">
                <AlertOctagon size={12} aria-hidden="true" />
                Specifics the evidence does not support ({finding.unsupportedSpecifics.length})
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {finding.unsupportedSpecifics.map((s, i) => (
                  <li
                    key={i}
                    className="rounded bg-surface px-2 py-1 font-mono text-xs text-critical ring-1 ring-inset ring-critical/30"
                  >
                    {s}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-ink-secondary">
                A reader acting on this claim would be acting on these figures or codes specifically — none of them trace to
                the case's evidence.
              </p>
            </div>
          ) : null}

          {finding.checkedAgainst.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Checked against</p>
              <ul className="flex flex-wrap gap-1.5">
                {finding.checkedAgainst.map((c, i) => (
                  <li key={i} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function VerificationPanel({ verification }: { verification: VerificationSummary | undefined }) {
  const grouped = useMemo(() => {
    if (!verification) return [];
    return [...verification.findings].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
  }, [verification]);

  const flaggedCount = verification?.flaggedIds.length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Verification"
        subtitle="The critic's adversarial check of every claim the other agents made against this case's own evidence"
        icon={<ShieldQuestion size={16} />}
      />
      <CardBody className="flex flex-col gap-4">
        {!verification ? (
          <EmptyState
            icon={<ShieldQuestion size={24} />}
            title="No verification run yet"
            description="Run the agents to have the critic check every claim, route and figure against this case's evidence before you rely on it."
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-sm flex-1">
                <ProgressBar
                  value={verification.groundingScore}
                  tone={groundingTone(verification.groundingScore)}
                  label={
                    <span className="flex items-center gap-1">
                      <Gauge size={11} /> Grounding score
                    </span>
                  }
                />
                <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                  {groundingReading(verification.groundingScore, verification.checkedCount)}
                </p>
              </div>
              <div className="flex shrink-0 gap-4">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">Checked</div>
                  <div className="mt-1 text-2xl font-semibold leading-tight text-ink">{verification.checkedCount}</div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">Flagged</div>
                  <div className={cn('mt-1 text-2xl font-semibold leading-tight', flaggedCount > 0 ? 'text-critical' : 'text-ink')}>
                    {flaggedCount}
                  </div>
                </div>
              </div>
            </div>

            {grouped.length === 0 ? (
              <p className="text-[13px] text-ink-secondary">The critic ran but found nothing to check on this pass.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {grouped.map((f) => (
                  <li key={f.id}>
                    <FindingCard finding={f} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
