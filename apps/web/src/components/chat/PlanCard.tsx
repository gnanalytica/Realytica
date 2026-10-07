import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { PLAN_SENTENCE, planCountSaid, planListedIn, planStepsIn } from '@realytica/shared';
import type { ChatChoice, ChatPlan, ChoicePin, PlanStep } from '@realytica/shared';
import { ApiRequestError, request } from '../../lib/api';
import { Button, cn } from '../ui/kit';
import { saysPlanCancelled } from './chat-list';

/**
 * A plan as it stands now, drawn in the chat.
 *
 * A reply that shows a plan says it in words, and those words are what was
 * said then. This card is the plan as the run ledger has it now: which steps
 * are done and what each did, which one is running, what is left. It is
 * drawn under the last reply on screen that names the plan (`planDrawnUnder`),
 * and at the top of a chat opened after the plan was made, so a page closed
 * part way through a run comes back to "3 of 5 steps done" with what is left.
 *
 * Its buttons are the plan's own, read from the server with the plan: run it
 * or cancel it before it starts, stop it while it runs, carry on or leave
 * the rest once it has stopped. Stop does not go through the chat, which is
 * busy with the request that is running the plan. It is a small request of
 * its own, and the run hears it between steps. Every other button sends the
 * sentence a person would have typed, with the plan it means beside it.
 *
 * Where the reply over the card already lists the steps as they stand, the
 * card does not list them again: it is the buttons and one line.
 */

/** A plan as the server hands it to the page. */
export interface PlanShown {
  id: string;
  plan: ChatPlan;
  /** Its run ended before the plan did: it says it is running and nothing is writing to it. */
  cutShort: boolean;
  /** Done or cancelled. */
  over: boolean;
  choices: ChatChoice[];
}

/** The plans on a project that are not over. */
export const openPlans = (projectId: string): Promise<{ plans: PlanShown[] }> => request(`/projects/${projectId}/plans`);

/** Ask a running plan to stop. What it has done stays done. */
export const stopPlan = (projectId: string, planId: string): Promise<PlanShown> =>
  request(`/projects/${projectId}/plans/${planId}/stop`, { method: 'POST', body: JSON.stringify({}) });

/** How often a plan that is running is read again. */
const READ_EVERY_MS = 2000;

/** Where the plan stands, as far as a page that only watches can tell: enough to notice it moved. */
const standing = (shown: PlanShown): string => `${shown.plan.status}:${shown.cutShort}:${shown.plan.steps.map((step) => step.state).join('')}`;

function StepLine({ n, step, onTakeOut, disabled }: { n: number; step: PlanStep; onTakeOut?: () => void; disabled?: boolean }) {
  const did = step.state === 'running' && step.did && step.count > 1 ? `${step.did} of ${step.count} so far` : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 py-1">
      <span className="mt-[3px]" aria-hidden>
        {step.state === 'done' ? (
          <CheckCircle2 size={14} className="text-good" />
        ) : step.state === 'running' ? (
          <Loader2 size={14} className="animate-spin text-ai" />
        ) : step.state === 'failed' ? (
          <AlertCircle size={14} className="text-critical" />
        ) : (
          <Circle size={14} className="text-ink-muted" />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn('text-[13px] leading-snug', step.state === 'to_do' ? 'text-ink-secondary' : 'text-ink')}>
          <span className="tabular-nums text-ink-muted">{n}. </span>
          {step.label}
          <span className="sr-only">
            {step.state === 'done' ? '. Done.' : step.state === 'running' ? '. Running.' : step.state === 'failed' ? '. Not done.' : '. Left.'}
          </span>
        </span>
        {step.said && (step.state === 'done' || step.state === 'failed' || step.state === 'to_do') ? (
          <span className="block text-mini leading-snug text-ink-secondary">
            {step.state === 'to_do' ? 'Part done: ' : step.state === 'failed' ? 'Not done: ' : ''}
            {step.said}
          </span>
        ) : null}
        {did ? <span className="block text-mini leading-snug text-ink-secondary">{did}</span> : null}
      </span>
      {onTakeOut ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onTakeOut}
          aria-label={`Take step ${n} out: ${step.label}`}
          className="shrink-0 rounded px-1.5 text-mini font-medium text-ink-secondary hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-11"
        >
          Take out
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

export function PlanCard({
  projectId,
  planId,
  initial,
  said,
  lead,
  busy,
  readOnly,
  fresh,
  onPick,
  onChanged,
}: {
  projectId: string;
  planId: string;
  /** The plan as a list of plans already read it, so the card is drawn at once. */
  initial?: PlanShown;
  /** The words of the reply this card is under. Where they list the steps as they stand, the card does not list them again. */
  said?: string;
  /** Drawn at the top of a chat with no reply over it: it says what was asked. */
  lead?: boolean;
  /** The chat is waiting on a reply, so nothing more can be sent through it. */
  busy?: boolean;
  /** Under a reply in an earlier chat being read: the plan as it stands, and no buttons. */
  readOnly?: boolean;
  /** Changes when the thread does, or when a step of this plan begins. The plan is read again. */
  fresh?: unknown;
  onPick?: (text: string, pin?: ChoicePin) => void;
  /** The plan moved while this page was only watching it: the thread has turns this page has not got. */
  onChanged?: () => void;
}) {
  const [shown, setShown] = useState<PlanShown | null>(initial ?? null);
  const [stopping, setStopping] = useState(false);
  const last = useRef<string | null>(initial ? standing(initial) : null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const read = useCallback(
    async (watching: boolean): Promise<void> => {
      try {
        const next = await request<PlanShown>(`/projects/${projectId}/plans/${planId}`);
        const moved = last.current !== null && last.current !== standing(next);
        last.current = standing(next);
        setShown(next);
        // The page that sent the request running the plan is handed the thread when it ends. A page that only watches asks for it.
        if (watching && moved && !busyRef.current) changedRef.current?.();
      } catch (e) {
        // A plan the ledger no longer keeps is not drawn. Any other failure leaves the card as it was, for the next read.
        if (e instanceof ApiRequestError && e.status === 404) setShown(null);
      }
    },
    [projectId, planId],
  );

  useEffect(() => {
    void read(false);
  }, [read, fresh]);

  const running = Boolean(shown && shown.plan.status === 'running' && !shown.cutShort);
  const card = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!running) {
      setStopping(false);
      return;
    }
    // A plan that starts to run lists its steps, and is taller for it: the whole card is brought into view once, with its Stop.
    card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const timer = window.setInterval(() => void read(true), READ_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [running, read]);

  if (!shown) return null;
  const { plan, cutShort } = shown;
  const steps = planStepsIn(plan);
  const listed = Boolean(said && !running && planListedIn(said, plan));
  // A plan that is over, under a reply that says so with every step: there is nothing to add.
  if (listed && shown.over) return null;
  // One cancelled before any of it ran, under the reply that showed it: one line, so the steps over it do not read as still on offer.
  if (plan.status === 'cancelled' && !steps.some((step) => step.state === 'done' || step.said)) {
    // At the top of a chat it is not under anything: it goes. So it does under a reply that says as much itself.
    if (lead || (said && saysPlanCancelled(said))) return null;
    return (
      <p className="mt-2 rounded-lg bg-sunken px-3 py-1.5 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]" role="status">
        This plan was cancelled. Nothing of it was done.
      </p>
    );
  }

  const stopAsked = stopping || Boolean(plan.stopAsked);
  const stands = running
    ? stopAsked
      ? 'Stopping once what is in hand is done'
      : 'Running'
    : cutShort
      ? 'Cut short'
      : plan.status === 'shown'
        ? 'Not started'
        : plan.status === 'stopped'
          ? 'Stopped'
          : plan.status === 'done'
            ? 'Done'
            : 'Cancelled';
  // Blue for a plan that waits on the person or is at work, amber for one that stopped short, green for one that is done.
  const tone = running || plan.status === 'shown' ? 'ai' : cutShort || plan.status === 'stopped' ? 'warning' : plan.status === 'done' ? 'good' : 'quiet';
  const mayChange = plan.status === 'shown' && !readOnly && steps.length > 1;
  const takeOut = (n: number): void => onPick?.(PLAN_SENTENCE.take_out(n), { plan: { id: shown.id, act: 'take_out', step: n } });

  async function stop(): Promise<void> {
    setStopping(true);
    try {
      const next = await stopPlan(projectId, planId);
      last.current = standing(next);
      setShown(next);
    } catch {
      // The next read says where it stands.
      setStopping(false);
    }
  }

  return (
    <section
      ref={card}
      aria-label="Plan"
      className={cn(
        'mt-2 rounded-xl px-3 py-2 ring-1 ring-inset',
        tone === 'ai' ? 'bg-ai-soft/60 ring-ai/25' : tone === 'warning' ? 'bg-warning/10 ring-warning/40' : tone === 'good' ? 'bg-good/10 ring-good/25' : 'bg-sunken ring-[var(--ring)]',
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-mini" role="status">
        <span className={cn('font-semibold', tone === 'ai' ? 'text-ai-ink' : tone === 'good' ? 'text-good' : 'text-ink')}>
          {lead ? 'A plan from earlier' : 'Plan'} · {stands}
        </span>
        <span className="text-ink-secondary">{plan.status === 'shown' ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` : planCountSaid(plan)}</span>
      </p>
      {lead ? <p className="mt-0.5 text-mini leading-snug text-ink-secondary">You asked: “{plan.asked}”</p> : null}
      {plan.stoppedBecause && !running && !listed ? <p className="mt-0.5 text-mini leading-snug text-ink-secondary">{plan.stoppedBecause}</p> : null}
      {cutShort && !listed ? <p className="mt-0.5 text-mini leading-snug text-ink-secondary">Its run ended before the plan did. What was done stays done.</p> : null}

      {listed ? null : (
        <ol className="mt-1.5">
          {steps.map((step, i) => (
            <StepLine key={step.id} n={i + 1} step={step} disabled={busy} onTakeOut={mayChange ? () => takeOut(i + 1) : undefined} />
          ))}
        </ol>
      )}

      {readOnly || shown.choices.length === 0 ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {shown.choices.map((choice, i) => {
            const act = choice.sitting?.plan?.act;
            if (act === 'stop') {
              return (
                <Button key={choice.id} type="button" size="sm" disabled={stopAsked} onClick={() => void stop()}>
                  {stopAsked ? 'Stopping' : 'Stop'}
                </Button>
              );
            }
            return (
              <Button key={choice.id} type="button" size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => onPick?.(choice.send, choice.sitting)}>
                {choice.label}
              </Button>
            );
          })}
          {/* The steps are numbered in the reply over the card, so a step is taken out by its number. */}
          {listed && mayChange ? (
            <span className="ml-auto flex flex-wrap items-center gap-1 text-mini text-ink-secondary">
              Take out step
              {steps.map((step, i) => (
                <button
                  key={step.id}
                  type="button"
                  disabled={busy}
                  onClick={() => takeOut(i + 1)}
                  aria-label={`Take step ${i + 1} out: ${step.label}`}
                  className="grid size-6 place-items-center rounded-md bg-surface font-medium tabular-nums text-ink ring-1 ring-inset ring-[var(--ring)] hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50 coarse:size-11"
                >
                  {i + 1}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      )}
      {plan.status === 'shown' && !listed && !readOnly ? (
        <p className="mt-1.5 text-mini leading-snug text-ink-secondary">Running it accepts nothing it raises: every value still waits for you.</p>
      ) : null}
    </section>
  );
}
