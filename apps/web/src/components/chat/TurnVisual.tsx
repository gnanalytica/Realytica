import { useState } from 'react';
import { BarChart3, ChevronDown } from 'lucide-react';
import type { PropertyCase } from '@realytica/shared';
import { AnchorWeightChart, ComparablesChart, RiskProfileChart, ValueRangeChart } from '../charts';
import { cn } from '../ui/kit';

/**
 * The picture behind an answer, drawn from the case rather than from the model.
 *
 * Twenty chart components existed and chat could reach none of them, so
 * questions with inherently visual answers — what is the range resting on,
 * where does the risk sit, which comparables — came back as paragraphs of
 * numbers.
 *
 * The obvious way to fix that is to let the model emit a chart spec. This
 * deliberately does not. A spec is a value the model authored, so a wrong one
 * is a wrong chart with our styling on it, and the models this deployment
 * runs are free-tier and cannot be relied on to honour an output contract at
 * all — the block parser is built around that same fact. Instead the chart is
 * chosen by WHICH TOOL the turn actually called, and every number in it comes
 * from the case store. The model picks the subject; it cannot pick the
 * figures, and it cannot fabricate a chart for data the case does not hold.
 *
 * That also means the chart cannot contradict the surface it came from: it is
 * the same component, over the same data, as the valuation and risk views.
 */
export function TurnVisual({
  toolNames,
  caseData,
}: {
  /** Tool names the turn called, from `CopilotTurn.toolCalls`. */
  toolNames: string[];
  caseData: PropertyCase;
}) {
  const [open, setOpen] = useState(false);
  const result = caseData.result;
  if (!result) return null;

  const called = new Set(toolNames);
  const visual = pick(called, caseData);
  if (!visual) return null;

  return (
    <div className="mt-2 rounded-lg bg-surface ring-1 ring-inset ring-[var(--ring)]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-mini text-ink-secondary hover:text-ink coarse:min-h-11"
      >
        <BarChart3 size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{visual.label}</span>
        <ChevronDown size={13} className={cn('shrink-0 transition-transform duration-quick', open && 'rotate-180')} />
      </button>
      {/*
       * Folded by default. The answer is the answer; this is the working
       * behind it, and expanding every chat turn into a chart would bury the
       * conversation under its own evidence.
       */}
      {open ? <div className="border-t border-hairline px-2.5 py-2.5">{visual.node}</div> : null}
    </div>
  );
}

function pick(called: Set<string>, caseData: PropertyCase): { label: string; node: React.ReactNode } | null {
  const result = caseData.result;
  if (!result) return null;
  const currency = caseData.identity.currency;

  // Ordered by specificity, not by preference: a turn that asked for anchors
  // AND risks was asking about the valuation, and one chart is the point.
  if (called.has('get_anchors') && result.anchors.length > 0) {
    return {
      label: 'The range, and what each method contributed',
      node: (
        <div className="flex flex-col gap-3">
          <ValueRangeChart
            low={result.indicativeValue.low}
            mid={result.indicativeValue.mid}
            high={result.indicativeValue.high}
            currency={currency}
            askingPrice={caseData.identity.askingPrice ?? null}
          />
          <AnchorWeightChart anchors={result.anchors} currency={currency} />
        </div>
      ),
    };
  }

  if (called.has('list_comparables') && result.comparables.length > 0) {
    return {
      label: `${result.comparables.length} comparable${result.comparables.length === 1 ? '' : 's'} used in this range`,
      node: <ComparablesChart comparables={result.comparables} currency={currency} />,
    };
  }

  if (called.has('get_risks') && result.risks.length > 0) {
    return {
      label: 'Where the risk sits, by severity and category',
      node: <RiskProfileChart risks={result.risks} />,
    };
  }

  return null;
}
