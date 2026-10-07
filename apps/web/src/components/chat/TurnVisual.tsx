import { useState } from 'react';
import { BarChart3, ChevronDown } from 'lucide-react';
import type { ScreenResult } from '@realytica/shared';
import { RiskProfileChart, ValueRangeChart } from '../charts';
import { cn } from '../ui/kit';
import { replyRan } from './answer-blocks';
import type { ProjectHeld, ReplyKept } from './answer-blocks';

/**
 * The picture behind an answer, drawn from the file rather than from the model.
 *
 * Twenty chart components existed and chat could reach none of them, so a
 * question with an inherently visual answer came back as a paragraph of
 * numbers.
 *
 * The obvious way to fix that is to let the model emit a chart spec. This
 * deliberately does not. A spec is a value the model authored, so a wrong one
 * is a wrong chart with our styling on it, and the models this deployment
 * runs are free-tier and cannot be relied on to honour an output contract at
 * all — the block parser is built around that same fact. Instead a reply
 * shows a picture of what that reply ran (`replyRan`), and every number in it
 * comes from the project's store. The model cannot pick the figures, and it
 * cannot fabricate a chart for data the project does not hold.
 *
 * A project's screen is kept without a value range, anchors or comparables
 * (`withoutMarketData`): a value comes from a valuation run. So the screen's
 * picture is the risks it raised, and the range is drawn from the run.
 *
 * It is called for every reply, with nothing round the call, and draws
 * nothing for one that ran neither.
 */
export function TurnVisual({
  turn,
  project,
}: {
  /** The reply, as the thread keeps it. */
  turn?: ReplyKept;
  /** The project as the page holds it. */
  project?: ProjectHeld;
  /** Not read. What the chat panel passed before it passed the reply and the project. */
  toolNames?: string[];
  result?: ScreenResult;
  askingPrice?: number | null;
}) {
  const { valuation, screen } = replyRan(turn, project);
  return (
    <>
      {valuation ? (
        <Folded label="The range of this valuation">
          <ValueRangeChart low={valuation.low} mid={valuation.indicatedValue} high={valuation.high} currency={valuation.currency} />
        </Folded>
      ) : null}
      {screen && screen.risks.length > 0 ? (
        <Folded label="Risks this screen raised, by severity">
          <RiskProfileChart risks={screen.risks} />
        </Folded>
      ) : null}
    </>
  );
}

function Folded({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg bg-surface ring-1 ring-inset ring-[var(--ring)]">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-mini text-ink-secondary hover:text-ink coarse:min-h-11"
      >
        <BarChart3 size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown size={13} className={cn('shrink-0 transition-transform duration-quick', open && 'rotate-180')} />
      </button>
      {/*
       * Folded by default. The answer is the answer; this is the working
       * behind it, and expanding every chat turn into a chart would bury the
       * conversation under its own evidence.
       */}
      {open ? <div className="border-t border-hairline px-2.5 py-2.5">{children}</div> : null}
    </div>
  );
}
