import { AlertOctagon } from 'lucide-react';
import type { CriticFinding, CriticVerdict, VerificationSummary } from '@realytica/shared';
import { cn, type Tone } from './ui/kit';

/**
 * The critic's flag, shown inline wherever a critic-checked item is rendered
 * (a proof route, a pathway, an insight, a research finding).
 * `unsupportedSpecifics` is the whole point of this file: a fabricated fee or
 * service code reads exactly like a real one, so it gets its own bordered,
 * monospaced treatment rather than blending into prose.
 */

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

/** Looks up the critic finding behind a flagged target. */
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
 * rendered — a proof route in the pathways list, an
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
        <span className="text-[12px] font-semibold text-ink">
          Critic flagged this claim — {VERDICT_LABEL[finding.verdict]}
        </span>
      </div>
      {!compact ? <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{finding.reasoning}</p> : null}
      {finding.unsupportedSpecifics.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {finding.unsupportedSpecifics.map((s, i) => (
            <li
              key={i}
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-micro text-critical ring-1 ring-inset ring-critical/30"
            >
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
