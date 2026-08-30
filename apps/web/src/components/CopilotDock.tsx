import { useCallback, useState } from 'react';
import { MessageSquare, PanelRightClose } from 'lucide-react';
import type { PropertyCase, ScreenResult } from '@realytica/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { agentAvailable } from '../lib/agent-availability';
import { CopilotPanel } from './CopilotPanel';
import { Button, cn } from './ui/kit';

/**
 * The copilot, docked beside whatever the analyst is looking at.
 *
 * The chat tab remains the full conversation surface; this is the same
 * conversation (one thread per case, not one per pane) kept in reach while
 * someone is inside a department workboard. What the dock adds is *context*:
 * every question it sends carries the group and view on screen, so "what's
 * wrong here?" means the Approvals workboard rather than the whole case.
 *
 * The context string is injected into the model's prompt only — it is never
 * stored on the turn — so the conversation history stays a record of what the
 * analyst actually asked.
 */
export function CopilotDock({
  caseData,
  result,
  refresh,
  viewContext,
  goToTab,
  className,
}: {
  caseData: PropertyCase;
  result: ScreenResult | null;
  refresh: () => void | Promise<void>;
  viewContext: string;
  /** Lets a chat command ("open compliance") and a cited-node chip move the canvas. */
  goToTab: (key: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const [asking, setAsking] = useState(false);
  const { data: capability } = useAsync(() => api.agentCapability(), []);

  // Same rule as the chat tab: whether the copilot's route can run, not
  // whether Anthropic credentials specifically exist. Undefined while loading,
  // so nothing flashes a switched-off notice at someone whose model is fine.
  const canAnswer = agentAvailable(capability, 'analyst_copilot');
  const agentsOff = canAnswer === false;

  const conversation = caseData.intelligence?.conversation ?? [];
  const evidence = result?.evidence ?? [];

  const handleAsk = useCallback(
    async (question: string) => {
      setAsking(true);
      try {
        const response = await api.askCopilot(caseData.id, question, viewContext);
        await refresh();
        const target = response.navigations?.[0]?.target;
        if (target) goToTab(target);
      } finally {
        setAsking(false);
      }
    },
    [caseData.id, refresh, viewContext, goToTab],
  );

  const handleClear = useCallback(async () => {
    await api.clearConversation(caseData.id);
    await refresh();
  }, [caseData.id, refresh]);

  if (!open) {
    return (
      <div className={cn('shrink-0 border-l border-hairline p-2', className)}>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open copilot"
          title="Open copilot"
          icon={<MessageSquare size={15} />}
          onClick={() => setOpen(true)}
        />
      </div>
    );
  }

  return (
    <aside className={cn('w-[22rem] shrink-0 flex-col gap-3 border-l border-hairline p-4', className)} aria-label="Copilot">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <MessageSquare size={14} /> Copilot
          </div>
          {/* The one line that makes this pane different from the chat tab:
              it says what "here" will mean in the next question. */}
          <p className="mt-0.5 truncate text-mini text-ink-muted">Looking at: {viewContext}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Collapse copilot"
          title="Collapse copilot"
          icon={<PanelRightClose size={14} />}
          onClick={() => setOpen(false)}
        />
      </div>
      <CopilotPanel
        conversation={conversation}
        evidence={evidence}
        suggestions={agentsOff ? [] : [`What matters most in ${viewContext.toLowerCase()}?`]}
        onAsk={handleAsk}
        onClear={conversation.length > 0 ? handleClear : undefined}
        busy={asking}
        disabled={agentsOff}
        disabledReason={agentsOff ? 'No model is configured for this deployment.' : undefined}
        verification={caseData.intelligence?.verification}
        onOpenNode={nodeId => goToTab(`diligence?view=graph&node=${encodeURIComponent(nodeId)}`)}
      />
    </aside>
  );
}
