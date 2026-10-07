import { useEffect, useMemo, useRef, useState } from 'react';
import { AttachControls, type VoiceInfo } from './chat/AttachControls';
import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { AlertCircle, ArrowUp, CheckCircle2, Info, Lock, MessageCircle, Paperclip, SearchX, X } from 'lucide-react';
import { PLAN_STEP, askedOn, chatSessions, choiceMayBePressed, groupActivity, splitThread, undoSentence } from '@realytica/shared';
import type { AgentStep, ChatChoice, ChatTurnPlace, ChoicePin, CopilotTurn, EvidenceItem, ProjectChatTurn, ScreenResult, TurnSpend, ValuationRun, VerificationSummary } from '@realytica/shared';
import { CriticFlagBanner, findFlaggedCriticFinding } from './VerificationPanel';
import { AiMark, Badge, Button, Modal, cn } from './ui/kit';
import { EASE_ENTER, SPRING, motion } from '../lib/motion';
import { AnswerBody } from './chat/AnswerBody';
import { ChatList } from './chat/ChatList';
import { boxAfter, composing, leftOutSaid, pasteIsFiles, stageFiles } from './chat/carried-question';
import { PlanCard, openPlans, stopPlan, type PlanShown } from './chat/PlanCard';
import { TurnChanges } from './chat/TurnChanges';
import { chatDay, chatRows, followsThread, liveChatId, liveTurns, planDrawnUnder, planStepAsks } from './chat/chat-list';
import { TurnVisual } from './chat/TurnVisual';
import { relativeTime } from '../lib/format';

/**
 * When the turn happened, and nothing else.
 *
 * This was "✧ Agent-generated · 2h ago" under every assistant turn. In a panel
 * where every reply is machine-written, saying so on each one is a label that
 * never varies, and it sat under a strip of chips that repeated the answer's
 * own citations. The time is the part that differs between turns and the part
 * somebody scrolling back is looking for.
 */
function TurnTime({ at, spend }: { at: string; spend?: TurnSpend }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-micro text-ink-muted">
      <span>{relativeTime(at)}</span>
      {/*
        What the turn cost, where the money was spent.
        
        Tracked per run since telemetry was written and visible only on the
        Observability page — an admin surface nobody is reading while deciding
        whether to ask a follow-up.
        
        Shown only when a published or operator rate actually covered the
        route. The pricing module prices an unknown model at zero, and "$0.00"
        beside a call that cost real money reads as free rather than as
        unpriced — so an inexact figure says that instead of quoting itself.
      */}
      {spend ? (
        <span title={spend.exact ? 'Priced at this route’s published rate' : 'No rate on file for this model'}>
          · {spend.exact ? formatSpend(spend.usd) : 'cost not priced'}
        </span>
      ) : null}
    </div>
  );
}

/** Turns are cents, not dollars. A "$0.02" column of zeros tells nobody anything. */
function formatSpend(usd: number): string {
  if (usd <= 0) return 'under a cent';
  const cents = usd * 100;
  if (cents < 1) return 'under a cent';
  return cents < 100 ? `${cents.toFixed(cents < 10 ? 1 : 0)}¢` : `$${usd.toFixed(2)}`;
}

function TurnBubble({
  turn,
  evidence,
  nodes,
  applied,
  screenResult,
  valuationRuns,
  onPick,
  mayPress,
  verification,
  onOpenNode,
  onOpenEvidence,
  onOpenDocument,
  extras,
  here,
  plansDrawn,
  under,
  busy,
  attached,
  planStep,
}: {
  turn: CopilotTurn;
  /** A sentence a plan said to the chat to carry out a step, and which step: nobody typed it. */
  planStep?: { step: number; of: number };
  /** A reply is on its way: a choice pressed now would send a second message and stop the first. */
  busy?: boolean;
  /** The files going with a message that is being answered, by name. */
  attached?: string[];
  /** Drawn under the reply's words, where its choices are: the plan it names, as the plan stands now. */
  under?: ReactNode;
  /** A plan is drawn as a card with its own buttons, as the plan stands now. The choices a reply offered for it then are not drawn too. */
  plansDrawn?: boolean;
  /** The page on screen. A question asked on another one says which. */
  here?: ChatTurnPlace;
  evidence: EvidenceItem[];
  nodes?: Array<{ id: string; label: string }>;
  applied?: string[];
  screenResult?: ScreenResult;
  valuationRuns?: ValuationRun[];
  /** Send a message on the person's behalf when they pick an offered choice. */
  onPick?: (text: string, sitting?: ChoicePin) => void;
  /** Whether a choice under this turn is a button. One that may not be pressed is drawn as the words it says. */
  mayPress?: (choice: ChatChoice) => boolean;
  verification?: VerificationSummary;
  onOpenNode?: (nodeId: string) => void;
  /** Open a cited paper, at the page the citation names when it names one. */
  onOpenEvidence?: (id: string, page?: number) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
  extras?: ReactNode;
}) {
  /*
   * A citation the answer made mid-sentence renders there, on the claim it
   * supports. What is left is either already inline as a link, or is an id
   * this project does not hold — and only the second kind needs saying,
   * because it is the one a reader would otherwise take on trust.
   */
  const inlineEvidence = new Set(Array.from(turn.text.matchAll(/\[ev:([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g), m => m[1]));
  const known = new Set((evidence ?? []).map(e => e.id));
  const uncitedMissing = turn.citedEvidenceIds.filter(id => !inlineEvidence.has(id) && !known.has(id));
  const consulted = Array.from(new Set((turn.toolCalls ?? []).map(t => t.summary.trim()).filter(Boolean)));
  // A critic flag has to travel with the claim it concerns. Surfacing it only
  // in the verification panel would let someone read an unsupported answer
  // cleanly here and never see the warning sitting on another screen.
  const flagged = findFlaggedCriticFinding(verification, 'copilot_answer', turn.id);
  const choices = plansDrawn ? turn.choices?.filter((choice) => !choice.sitting?.plan) : turn.choices;
  if (turn.role === 'user') {
    /*
     * The thread stays when the page changes, so a question asked on Title
     * and its answer are still here on Approvals. One quiet line over the
     * question says where it was asked. A question asked on the page on
     * screen says nothing, and that is most of them. A sentence a plan said
     * to carry out a step says that instead.
     */
    const asked = planStep ? `The plan, step ${planStep.step} of ${planStep.of}` : askedOn(turn.place, here);
    return (
      <div className="flex flex-col items-end gap-1 pl-8">
        {asked ? <p className="text-micro text-ink-muted">{asked}</p> : null}
        {/*
          `whitespace-pre-wrap`, which the assistant side has always had and
          this side never did — so a pasted multi-line question collapsed into
          one run-on line and stopped resembling what the person typed.
          A word longer than the bubble is wide (a file name, a survey number
          run together) breaks inside it.
        */}
        <div
          className={cn(
            'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] leading-relaxed text-ink ring-1 ring-inset [overflow-wrap:anywhere]',
            // The plan's own colour for what the plan said, the person's for what they did.
            planStep ? 'bg-ai-soft/60 ring-ai/25' : 'bg-sunken ring-[var(--ring)]',
          )}
        >
          {turn.text}
          {attached?.length ? (
            <span className={cn('flex flex-col gap-0.5 text-mini text-ink-secondary', turn.text && 'mt-1')}>
              {attached.map((name, i) => (
                <span key={`${name}-${i}`} className="flex min-w-0 items-center gap-1">
                  <Paperclip size={11} aria-hidden className="shrink-0" />
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // A refusal for lack of evidence is the product working as intended, not a
  // failure — it gets its own calm, informative treatment rather than the
  // error styling other panels use for a broken state.
  if (turn.refusedForLackOfEvidence) {
    return (
      <div className="flex gap-2.5">
        <AiMark className="mt-0.5" />
        <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-brand-soft px-3.5 py-2.5 ring-1 ring-inset ring-brand/20">
          <div className="mb-1 flex items-center gap-1.5 text-mini font-semibold text-brand">
            <SearchX size={12} /> No answer — the evidence doesn&rsquo;t support one
          </div>
          <p className="text-[13px] leading-relaxed text-ink">{turn.text}</p>
          <p className="mt-1 text-mini text-ink-secondary">
            That&rsquo;s a legitimate outcome, not an error — nothing on file backs a confident answer yet.
          </p>
          <TurnTime at={turn.at} spend={turn.spend} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      {/*
        A face for the other side of the conversation.
        
        Every assistant turn rendered as an unlabelled slab the width of the
        column, so a long answer read as a document pane rather than as
        something said to you — and two consecutive answers ran together with
        nothing between them. The mark is small and constant; it is the
        cheapest thing that makes a column of text read as a dialogue.
      */}
      <AiMark className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[12px] font-semibold leading-5 text-ink">Copilot</p>
        {turn.unanswered ? (
          /*
           * The question was not answered, and what follows is the standing
           * briefing rather than a reply.
           *
           * Without this the two are indistinguishable: a rate-limited copilot
           * fell through to "today on this project…", which rendered in the
           * same voice and the same place as a real answer. Somebody asking
           * what a buyer would pay read an unrelated open finding and had no
           * way to know their question had never been reached. Said before the
           * text, not after, because it changes how the text should be read.
           */
          <p className="mb-2 flex items-start gap-1.5 border-b border-[var(--ring)] pb-2 text-mini leading-snug text-ink-secondary">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              {turn.unanswered} Below is where the file stands, not a reply to what you asked.
            </span>
          </p>
        ) : null}
        <AnswerBody
          text={turn.text}
          evidence={evidence}
          nodes={nodes}
          rests={turn.restsOn}
          onOpenEvidence={onOpenEvidence}
          onOpenNode={onOpenNode}
        />
        {/*
          Deduped. The agent loops up to eight times and routinely consults
          the same tool twice — the observed answer showed "Looking up get
          evidence by id" side by side with itself, which reads as a
          rendering fault rather than as work. What a reader wants from this
          row is WHICH sources were consulted, not how many round trips it
          took to consult them.
        */}
        {consulted.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {consulted.map(label => (
              <Badge key={label} tone="neutral">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
        {flagged ? (
          <div className="mt-2">
            <CriticFlagBanner finding={flagged} compact />
          </div>
        ) : null}
        {/*
          What the turn CHANGED, in the transcript.
          
          A command tool executes directly — that is deliberate, because a
          command the person gave in their own words has the person as its
          actor. But it was reported only by a toast, which vanishes, so the
          record of a risk being marked mitigated lived nowhere the reader
          could scroll back to. A conversation that mutates a case and keeps
          no account of it is the wrong shape for a diligence file.
        */}
        <TurnVisual turn={turn} project={{ lastScreenResult: screenResult, valuationRuns: valuationRuns ?? [] }} />
        {turn.metrics && turn.metrics.length > 0 ? (
          /*
           * What the turn changed, as figures.
           *
           * The one thing a receipt cannot say in a sentence without becoming
           * the paragraph this panel is trying to stop being. Three rows, no
           * prose column: how much evidence there is, how much of it is
           * attached to something, and whether the pack moved. The last two
           * are the pair that matters — documents on the register with nothing
           * to attach them to leave the pack where it was, and only these
           * numbers say so.
           */
          <dl className="mt-2 flex flex-col gap-0.5 rounded-lg bg-sunken px-2.5 py-1.5">
            {turn.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-mini text-ink-secondary">{m.label}</dt>
                <dd className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-[12px] font-medium text-ink">{m.value}</span>
                  {m.delta ? <span className="text-mini text-ink-muted">{m.delta}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {turn.unsupportedClaims && turn.unsupportedClaims.length > 0 ? (
          /*
           * Figures the file does not support, named beside the answer that
           * used them. A flag, not a block: the person decides what to make
           * of it, but an invented number must never render in the same
           * voice as a verified one.
           */
          <p className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-mini leading-snug text-ink ring-1 ring-inset ring-warning/45">
            Not on the file: {turn.unsupportedClaims.join(' · ')}. Nothing in the registers, the screen or the
            valuations carries {turn.unsupportedClaims.length === 1 ? 'this figure' : 'these figures'} — treat
            {turn.unsupportedClaims.length === 1 ? ' it' : ' them'} as unverified until evidence lands.
          </p>
        ) : null}
        {choices && choices.length > 0 && onPick ? (
          /*
           * Options offered because the message did not resolve to one thing.
           * Rendered as buttons rather than a list in the prose because the
           * point is that the person picks — a numbered list they have to
           * retype is the same dead end with better manners. Picking sends
           * the message they would have written, so nothing here writes on
           * its own.
           */
          <ul className="mt-2 flex flex-col gap-1.5">
            {choices.map((choice) =>
              mayPress && !mayPress(choice) ? (
                /*
                 * A choice that accepts or sets aside, under a reply that is
                 * no longer the last thing said, or in an earlier chat being
                 * read. It stays as the words it offered and is not a button:
                 * pressed here it would read as part of what was said then.
                 */
                <li key={choice.id} className="flex flex-col gap-0.5 px-3 py-1">
                  <span className="text-[13px] text-ink-secondary">{choice.label}</span>
                  {choice.detail ? <span className="text-mini leading-snug text-ink-muted">{choice.detail}</span> : null}
                </li>
              ) : (
              <li key={choice.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(choice.send, choice.sitting)}
                  className={cn(
                    'group flex w-full flex-col gap-0.5 rounded-lg bg-surface px-3 py-2 text-left',
                    'ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick',
                    'hover:bg-brand-soft hover:ring-brand/30 coarse:min-h-11',
                    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface disabled:hover:ring-[var(--ring)]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[13px] text-ink group-hover:text-brand group-disabled:text-ink">{choice.label}</span>
                    {choice.kind ? (
                      <span className="shrink-0 text-[11px] font-medium text-ink-muted">{choice.kind}</span>
                    ) : null}
                  </span>
                  {choice.detail ? (
                    <span className="text-mini leading-snug text-ink-secondary">{choice.detail}</span>
                  ) : null}
                </button>
              </li>
              ),
            )}
          </ul>
        ) : null}
        {under}
        {applied && applied.length > 0 ? (
          <div className="mt-2 rounded-lg bg-good/10 px-2.5 py-2 ring-1 ring-inset ring-good/25">
            <div className="flex items-center gap-1.5 text-mini font-semibold text-good">
              <CheckCircle2 size={12} /> Applied to the case
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {applied.map((line, i) => (
                <li key={i} className="text-[12px] leading-snug text-ink">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/*
          No trailing chip strip.

          It listed the records and sources an answer touched — a `scope` chip,
          then "Legal", then "Approval / Compliance DD" — under every turn.
          Once ids in the prose became links, those chips were the same records
          a second time, further from the claim they belonged to and stacked
          three rows deep beneath a two-line answer. A citation reads best
          exactly where it was made.

          Dangling references are the one thing that still has to surface here:
          an id the answer cited that this project does not hold never becomes
          an inline link, so without this line it would vanish and leave a
          claim looking sourced.
        */}
        {uncitedMissing.length > 0 ? (
          <p className="mt-1.5 text-mini text-ink-muted">
            Referenced {uncitedMissing.length === 1 ? 'a source' : `${uncitedMissing.length} sources`} not on this
            project.
          </p>
        ) : null}
        <TurnTime at={turn.at} spend={turn.spend} />
        {extras}
      </div>
    </div>
  );
}

/**
 * What the agent is doing, while it does it.
 *
 * Three dots covered a loop of up to eight tool iterations — reading a deed,
 * walking the graph, pulling the compliance checks — and a wait that long
 * with no account of itself is indistinguishable from a hang. The server has
 * always emitted these steps; nothing was listening.
 *
 * The dots stay for the gap before the first step arrives, and on a
 * deployment where the response is buffered rather than streamed, which is
 * the same thing from here.
 */
function TypingIndicator({ steps }: { steps: AgentStep[] }) {
  const current = steps[steps.length - 1];
  // Tool steps only. `message` and `plan` steps carry the model's own
  // narration, which is the answer being drafted — showing it here would
  // print a rough version of the reply above the reply.
  const done = steps.filter(s => s.kind === 'tool_result').length;

  return (
    <div className="flex animate-rise-in gap-2.5">
      <AiMark className="mt-0.5" busy />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[12px] font-semibold leading-5 text-ink">Copilot</p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="size-1.5 rounded-full bg-ai"
                animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.14, ease: 'easeInOut' }}
              />
            ))}
          </span>
          {current ? <span className="text-shimmer min-w-0 truncate text-[13px]">{current.label}</span> : <span className="text-shimmer text-[13px]">Thinking</span>}
        </div>
        {done > 0 ? (
          <span className="text-mini text-ink-muted">
            {done} source{done === 1 ? '' : 's'} read
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionChip({ text, disabled, onClick }: { text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full bg-surface px-3 py-1 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)] shadow-card',
        'transition-[color,box-shadow,transform] duration-quick ease-state hover:text-ink hover:ring-[var(--text-muted)] active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-11',
      )}
    >
      {text}
    </button>
  );
}

/**
 * Chat panel over the analyst copilot. An assistant turn shows its cited
 * evidence inline, and a turn where the agent declined for lack of evidence
 * reads as a good outcome rather than an error — Realytica's whole promise is
 * Evidence Before Assertion, so "the evidence doesn't support an answer" is a
 * correct, valuable response, not a dead end.
 */
export function CopilotPanel({
  conversation,
  evidence,
  suggestions,
  onAsk,
  onDeleteChats,
  busy,
  disabled,
  disabledReason,
  verification,
  onOpenNode,
  onOpenDocument,
  onOpenEvidence,
  fallback,
  sessionId,
  sessionStartedAt,
  sessionActor,
  continues,
  place,
  draft,
  onDraftTaken,
  onNewChat,
  onContinueChat,
  onRenameChat,
  leadTurn,
  fill,
  nodes,
  appliedByTurn,
  steps,
  onOpenCommands,
  onPickChoice,
  screenResult,
  valuationRuns,
  emptyTitle,
  emptyHint,
  placeholder,
  allowAttach,
  voice,
  onCheckVoice,
  renderTurnExtras,
  compact,
  onCancel,
  dock,
  plans,
  pending,
  askError,
  className,
}: {
  conversation: CopilotTurn[];
  /** The room around the panel. Given here, not by a box around it, so files dropped anywhere on the chat's column land on the panel. */
  className?: string;
  /**
   * The message that was sent: its words and the names of its files. It is
   * drawn at the foot of this chat until its reply is in the thread. After
   * Stop it stays there, with nothing being answered, until the thread says
   * whether it was kept. A message sent meanwhile is drawn under it.
   */
  pending?: Array<{ text: string; files: string[] }>;
  /** Why the last message did not go, wherever it was sent from: typed here, a pressed choice, Undo, a plan's button, the command bar. */
  askError?: string | null;
  /**
   * Draw plans in this chat: the project they are kept on, and what to do
   * when one moved while this page was only watching it (the thread then has
   * turns this page has not got).
   */
  plans?: { projectId: string; onChanged?: () => void };
  evidence: EvidenceItem[];
  suggestions: string[];
  onAsk: (question: string, files?: File[]) => Promise<void> | void;
  /** Delete every chat on the project, for everyone. Present only for somebody who may do it. It is the last line of the list of chats, and is asked about first, here. */
  onDeleteChats?: () => Promise<void> | void;
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  verification?: VerificationSummary;
  /** When set, graph-node citations render as chips that focus the explorer. */
  onOpenNode?: (nodeId: string) => void;
  /** Open a cited document in the proof pane. */
  onOpenDocument?: (documentId: string) => void;
  /** Open one evidence item, at the page its citation names: what an inline citation chip does when tapped. */
  onOpenEvidence?: (id: string, page?: number) => void;
  /**
   * What this column shows when there is no copilot to talk to.
   *
   * Chat is the centre of the cockpit, so on a deployment with no model
   * configured the most prominent element on every case page was an apology.
   * A dead hero is worse than no hero: it makes a working product look
   * broken. The fallback is the case's own next steps — the thing the reader
   * would have asked the copilot for first.
   */
  fallback?: ReactNode;
  /**
   * The sitting opened with this project, so chat starts on it rather than on
   * everything the file has ever carried. Absent shows the whole thread, which
   * is what a caller that does not mint one gets.
   */
  sessionId?: string;
  /**
   * When this sitting began. A turn the server wrote outside a chat request —
   * the note after a document filed on the register was read — carries no
   * sitting, and still belongs in the chat the person has open.
   */
  sessionStartedAt?: string;
  /** The person signed in, as their turns are signed. A note the server wrote for somebody else's upload is not in this chat. */
  sessionActor?: string;
  /** The earlier chat this sitting carries on, by its id: its turns are the top of the chat on screen. */
  continues?: string;
  /** The page on screen, so a question asked on another one can say which. */
  place?: ChatTurnPlace;
  /** Words to put in the message box for the person to read and send, with the files that went with them when a send is handed back. */
  draft?: { text: string; files?: File[] } | null;
  /** Called once the words are in the box, so they are handed over once and not again when this panel is drawn afresh. */
  onDraftTaken?: () => void;
  /** Start a chat with nothing in it. */
  onNewChat?: () => void;
  /** Make an earlier chat the current one: what is typed next is added to it. */
  onContinueChat?: (sessionId: string) => void;
  /** Name a chat. An empty name hands it back to its first question. */
  onRenameChat?: (sessionId: string, name: string) => Promise<void> | void;
  /**
   * Shown first when present: cards still waiting from an earlier sitting,
   * so reopening a file never hides work that is one approval away.
   */
  leadTurn?: CopilotTurn;
  /** Take the height of the container rather than capping at 26rem. */
  fill?: boolean;
  /** The case's graph, so a cited node id can render as its label. */
  nodes?: Array<{ id: string; label: string }>;
  /**
   * What each turn changed on the case, keyed by turn id.
   *
   * Held by the caller rather than on the turn because it is a property of
   * the exchange, not of the stored conversation — the API returns it once,
   * with the response, and the case row is the record of the change itself.
   */
  appliedByTurn?: Record<string, string[]>;
  /** Live progress for the turn in flight, newest last. */
  steps?: AgentStep[];
  /** Open the command bar — bound to `/` on an empty composer. */
  onOpenCommands?: () => void;
  /**
   * The last screen on this file, so a turn can draw the chart behind its
   * answer.
   *
   * Passed rather than fetched: the chart has to be the same numbers the rest
   * of the surface is showing, and a second read could disagree with the first.
   */
  screenResult?: ScreenResult;
  /** The valuations run on this file, for the range under the reply that ran one. */
  valuationRuns?: ValuationRun[];
  /**
   * Send an offered choice. Takes the pinned record with it, because two DDs
   * can carry checks with identical titles and the text alone cannot say
   * which one was on the button.
   */
  onPickChoice?: (text: string, sitting?: ChoicePin) => void;
  emptyTitle?: string;
  emptyHint?: string;
  placeholder?: string;
  allowAttach?: boolean;
  /** Whether a voice note can be put into words here, and where its sound goes. Absent where this chat takes none, and until the server has said. */
  voice?: VoiceInfo;
  /** Ask the server that again. Given where this chat takes voice notes: the microphone is then offered before the answer is in, and after an ask that was refused. */
  onCheckVoice?: () => Promise<VoiceInfo>;
  renderTurnExtras?: (turn: CopilotTurn) => ReactNode;
  /** Phone cockpit: hide extra chips, icon-only send, tighter spacing. */
  compact?: boolean;
  /** Cancel the in-flight turn. Shown as Stop while busy. */
  onCancel?: () => void;
  /** Live sitting — the named field or scope, docked above the composer. */
  dock?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  /** What was left out of the files last added, and why. */
  const [leftOut, setLeftOut] = useState<string | null>(null);
  /** Files are being dragged over the chat. */
  const [dropping, setDropping] = useState(false);
  // A drag enters again at every element it crosses, so the state is counted, not switched.
  const dragDepth = useRef(0);
  /** An earlier chat being read, by its id; null while the current one is on screen. */
  const [viewing, setViewing] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-measured on every change of the value, not just on typing: the box is
  // also cleared programmatically after a send, and a composer that stayed
  // six lines tall over an empty field would eat the conversation.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  /*
   * The thread is followed to its foot: when a message is sent, when a reply
   * lands, and while the working row grows with what it reports. A person
   * who scrolls up to read is left there until they come back to the foot.
   */
  const following = useRef(true);
  const lastTop = useRef(0);
  function handleThreadScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    following.current = followsThread(following.current, { top: el.scrollTop, lastTop: lastTop.current, fromFoot: el.scrollHeight - el.clientHeight - el.scrollTop });
    lastTop.current = el.scrollTop;
  }
  useEffect(() => {
    following.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation.length, busy]);
  const stepsSeen = steps?.length ?? 0;
  useEffect(() => {
    if (busy && stepsSeen > 0 && following.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [busy, stepsSeen]);

  async function submit(question: string, attached = files): Promise<void> {
    const trimmed = question.trim();
    if (busy || disabled) return;
    if (!trimmed && attached.length === 0) return;
    setError(null);
    setText('');
    setFiles([]);
    setLeftOut(null);
    // What is typed goes to the current chat, so that is the one to be looking at when the answer comes.
    setViewing(null);
    try {
      await onAsk(trimmed, attached.length ? attached : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the copilot. Please retry.');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // A key pressed while an input method is composing belongs to it.
    if (composing(e.nativeEvent)) return;
    /*
     * `/` on an empty composer opens the command bar.
     *
     * Both surfaces are the person acting and they already share a
     * vocabulary; this is the convention every chat product has taught
     * people to expect, and without it the only way to reach the bar was a
     * keyboard shortcut with no discoverable affordance — and none at all on
     * a phone, which has no ⌘K.
     *
     * Only on an EMPTY composer. Mid-sentence a slash is a date, a ratio or
     * a survey number, and stealing it would make "plot 112/3" unaskable.
     */
    if (e.key === '/' && text.length === 0 && onOpenCommands) {
      e.preventDefault();
      onOpenCommands();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // A held key repeats, and a repeat is nobody's decision to send: words handed in from outside wait in the box for the person.
      if (!e.repeat) void submit(text);
    }
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    void submit(text);
  }

  /*
   * Two logs, shown as two tabs.
   *
   * The thread arrives holding both what somebody asked and what the file
   * recorded — every work-pane edit writes a synthetic turn and a one-word
   * reply. Measured on the seeded project that was twenty-four turns, all of
   * them echoes: a conversation panel replaying your own clicks.
   *
   * Split on the way in rather than at the source, so nothing has to be
   * migrated and a turn written before this lands in the right half by itself.
   */
  const { conversation: spoken, activity } = useMemo(
    () => splitThread(conversation as unknown as ProjectChatTurn[]),
    [conversation],
  );
  const [tab, setTab] = useState<'chat' | 'activity'>('chat');

  // Words handed in from outside wait in the box, with the keyboard on them. Sending them is the person's to do.
  // What is already in the box is the person's own and stays: a send handed back goes over words typed since, and its files join the ones staged.
  useEffect(() => {
    if (!draft?.text && !draft?.files?.length) return;
    setText((was) => boxAfter(was, draft.text));
    if (draft.files?.length) setFiles((was) => stageFiles(was, draft.files!, true).files);
    setTab('chat');
    composerRef.current?.focus();
    onDraftTaken?.();
  }, [draft, onDraftTaken]);

  // A message sent from anywhere is answered in the current chat: a choice under an earlier chat, a plan's button, the command bar while Activity is on screen.
  useEffect(() => {
    if (!busy) return;
    setViewing(null);
    setTab('chat');
    setError(null);
  }, [busy]);

  /*
   * Files join the ones waiting to go, however they came: the paperclip, the
   * camera, the microphone, a drop on the chat, a paste into the box. Past
   * what one message takes the rest are left out, and so is a dropped or
   * pasted file of a kind the paperclip does not offer. The box says which.
   */
  function addFiles(added: File[], picked = false): void {
    if (!added.length) return;
    const took = stageFiles(filesRef.current, added, picked);
    filesRef.current = took.files;
    setFiles(took.files);
    setLeftOut(leftOutSaid(took));
  }

  // While the paperclip is shut, nothing is taken: a reply is on its way, or there is no copilot here.
  const takesFiles = Boolean(allowAttach) && !disabled && !busy;
  const filesDragged = (e: DragEvent): boolean => Boolean(allowAttach) && e.dataTransfer.types.includes('Files');
  const dropTarget = {
    onDragEnter: (e: DragEvent) => {
      if (!filesDragged(e)) return;
      dragDepth.current += 1;
      setDropping(true);
    },
    // Taking the drag over is what stops the browser opening the file in place of the page, here and when nothing is taken.
    onDragOver: (e: DragEvent) => {
      if (!filesDragged(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = takesFiles ? 'copy' : 'none';
    },
    onDragLeave: (e: DragEvent) => {
      if (!filesDragged(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!filesDragged(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      if (!takesFiles) return;
      addFiles([...e.dataTransfer.files]);
      // The files are staged over the box: the keyboard goes there, for the words to send with them.
      setTab('chat');
      composerRef.current?.focus();
    },
  };

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const clip = e.clipboardData;
    if (!takesFiles || !pasteIsFiles({ files: clip.files.length, text: clip.getData('text/plain'), types: clip.types })) return;
    // A file or a screenshot: it is attached, and its name is not typed into the box.
    e.preventDefault();
    addFiles([...clip.files]);
  }

  /*
   * Deleting every chat is asked about first. The keyboard is put in the
   * message box before the question opens, because the question hands it
   * back to wherever it was when it closes: after deleting, and after keeping
   * them, that is the box.
   *
   * It is not offered while a reply is on its way. The reply would land after
   * the delete, and the box, shut until it does, cannot take the keyboard.
   */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const askDelete = () => {
    composerRef.current?.focus();
    setConfirmDelete(true);
  };
  async function deleteChats(): Promise<void> {
    if (!onDeleteChats) return;
    setDeleting(true);
    try {
      await onDeleteChats();
      setViewing(null);
      setTab('chat');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The chats could not be deleted.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  /*
   * The thread, cut into sittings.
   *
   * Chat shows THIS sitting — the one minted when the project was opened — so
   * it starts empty on what you are doing now instead of at the bottom of
   * every exchange the file has ever carried. `viewing` holds an earlier
   * sitting when somebody goes looking for one; null means the live one.
   */
  const sessions = useMemo(
    () => chatSessions(conversation as unknown as ProjectChatTurn[]),
    [conversation],
  );
  // The chat on screen is this sitting's, or the earlier chat it carries on while that one is still there.
  const liveId = liveChatId(sessions, { sessionId, continues });
  const own = useMemo(
    () => liveTurns(spoken, sessions, { sessionId, startedAt: sessionStartedAt, continues, actor: sessionActor }),
    [spoken, sessions, sessionId, sessionStartedAt, continues, sessionActor],
  );
  const live = useMemo(() => (leadTurn ? [leadTurn, ...own] : own), [leadTurn, own]);
  const rows = useMemo(() => chatRows(sessions, own, liveId), [sessions, own, liveId]);
  // An earlier chat that is no longer there (the thread was cleared, or it became the current one) is not being read.
  const reading = viewing && viewing !== liveId ? sessions.find((s) => s.id === viewing) : undefined;
  const viewed = reading ? reading.turns : live;

  // Chat opens by default even when empty: it is what the composer below is
  // for, and landing on a log nobody asked for is how this started.
  const shown = useMemo(() => (tab === 'chat' ? viewed : []) as unknown as CopilotTurn[], [tab, viewed]);

  /*
   * Plans. One that is not over is read from the project's run ledger when
   * the chat opens and whenever the thread changes. A plan is drawn once:
   * under the last reply on screen that names it, or, where no reply on
   * screen does, at the top of this chat. The second place is what a person
   * who closed the page part way through a run comes back to.
   */
  const planProject = plans?.projectId;
  const [openNow, setOpenNow] = useState<PlanShown[]>([]);
  useEffect(() => {
    if (!planProject) return;
    let live = true;
    openPlans(planProject).then(
      // One this page has shown stays when it ends, so a plan watched to its end says it is done and does not vanish.
      (got) => live && setOpenNow((was) => [...got.plans, ...was.filter((seen) => !got.plans.some((open) => open.id === seen.id))]),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [planProject, conversation.length, busy]);
  const planUnder = useMemo(() => {
    const at = planDrawnUnder(shown);
    return { at, named: new Set(at.values()) };
    // `shown` is the chat on screen: this one, or the earlier one being read.
  }, [shown]);
  // The sentences a plan said to the chat to carry out its steps. They are drawn as the plan's, not as the person's.
  const planSaid = useMemo(() => planStepAsks(shown), [shown]);
  // A plan of this person's that no reply on screen names. Somebody else's is in their chat, not this one.
  const planLead = tab === 'chat' && !reading ? openNow.filter((open) => !planUnder.named.has(open.id) && (!sessionActor || open.plan.by === sessionActor)) : [];
  const planStepsSeen = (steps ?? []).filter((step) => step.toolName === PLAN_STEP);
  // The plan this request is carrying out, named by its steps as they arrive. Stop then stops the plan, and the reply still comes with what was done.
  const planInHand = busy && planProject ? planStepsSeen.at(-1)?.detail : undefined;
  const [planStopAsked, setPlanStopAsked] = useState(false);
  useEffect(() => {
    if (!busy) setPlanStopAsked(false);
  }, [busy]);
  const planFresh = `${conversation.length}:${busy ? 1 : 0}:${planStepsSeen.length}`;
  const planCard = (planId: string, more: { said?: string; lead?: boolean; initial?: PlanShown }): ReactNode =>
    planProject ? (
      <PlanCard
        key={planId}
        projectId={planProject}
        planId={planId}
        initial={more.initial ?? openNow.find((open) => open.id === planId)}
        said={more.said}
        lead={more.lead}
        busy={busy}
        readOnly={Boolean(reading)}
        fresh={planFresh}
        onPick={(text, pin) => void onPickChoice?.(text, pin)}
        onChanged={plans?.onChanged}
      />
    ) : null;
  const planLeadCards = planLead.length ? <div className="flex flex-col gap-2">{planLead.map((open) => planCard(open.id, { lead: true, initial: open }))}</div> : null;

  const showEmptyState = shown.length === 0 && tab === 'chat' && !busy && !pending?.length && !reading;
  const current = rows.find((row) => row.current);

  return (
    <div className={cn('relative flex flex-col', compact ? 'gap-2' : 'gap-3', fill && 'h-full min-h-0', className)} {...dropTarget}>
      {dropping && takesFiles ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl bg-brand-soft/85 ring-2 ring-inset ring-brand">
          <p className="flex items-center gap-2 text-[13px] font-medium text-brand">
            <Paperclip size={16} aria-hidden /> Drop here to attach
          </p>
        </div>
      ) : null}
      {/*
        The unavailable notice moved DOWN, to the composer.
        
        Chat is the centre of the cockpit, so a banner above the conversation
        made the most prominent element on every case page an apology for
        something the reader cannot fix and did not ask about. It belongs
        beside the box you would type in — which is where you find out, and
        the only place the answer changes what you do next.
      */}

      {/*
        The strip only appears once the file has a history to separate. On a
        fresh project there is one log and a tab bar over it would be chrome
        naming a distinction that does not exist yet.
      */}
      {activity.length > 0 || rows.length > 0 ? (
        <div className="relative flex shrink-0 items-center gap-1 border-b border-hairline px-1 pb-1.5">
          {(activity.length > 0 ? (['chat', 'activity'] as const) : (['chat'] as const)).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              /* The count sits in its own span, and the accessible name is
                 computed by concatenating text nodes without the margin
                 between them — so the tab was announced as "Activity6". */
              aria-label={
                key === 'activity'
                  ? `Activity — ${activity.length} ${activity.length === 1 ? 'entry' : 'entries'}`
                  : 'Chat'
              }
              className={cn(
                'relative rounded-lg px-2.5 py-1 text-[12px] capitalize transition-colors duration-quick coarse:min-h-11 coarse:px-3',
                tab === key ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {tab === key ? (
                <motion.span layoutId="chat-tab" aria-hidden className="absolute inset-0 rounded-lg bg-sunken ring-1 ring-inset ring-[var(--ring)]" transition={SPRING.snappy} />
              ) : null}
              <span className="relative">
                {key}
                {key === 'activity' ? <span className="ml-1 font-mono tabular-nums opacity-70">{activity.length}</span> : null}
              </span>
            </button>
          ))}
          {/*
            The chats of this project, behind the one control that was the
            list of earlier chats: this chat and the earlier ones by name,
            "New chat" above them, and a search once there are many.

            Only once there is a chat to name. On a file nobody has spoken on
            the control would open a list of nothing — the same reason the
            Chat/Activity strip waits for something to separate.
          */}
          {rows.length > 0 && onNewChat ? (
            <ChatList
              rows={rows}
              label={reading ? (reading.name ?? reading.title) : current?.named ? current.title : 'This chat'}
              onPick={(row) => {
                setViewing(row.current ? null : row.id);
                setTab('chat');
              }}
              onNew={() => {
                setViewing(null);
                setTab('chat');
                onNewChat();
                // A new chat is for typing in.
                composerRef.current?.focus();
              }}
              onRename={onRenameChat}
              onDeleteAll={onDeleteChats && !busy && !disabled ? askDelete : undefined}
            />
          ) : null}
        </div>
      ) : null}
      {reading ? (
        /*
          An earlier chat is read-only in the sense that matters: what you
          type still goes to the current one, so a question asked while
          reading history does not silently graft itself onto a conversation
          that finished days ago. Carrying it on is a thing somebody asks for
          by name, and it then becomes the current chat.
        */
        <div className="flex shrink-0 items-center gap-3 rounded-lg bg-sunken px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-mini text-ink-secondary">Earlier chat · {chatDay(reading.lastAt)}</span>
          {onContinueChat ? (
            <button
              type="button"
              onClick={() => {
                onContinueChat(reading.id);
                setViewing(null);
                // The button goes with its banner. The keyboard goes to the box the chat is carried on in.
                composerRef.current?.focus();
              }}
              className="shrink-0 text-mini font-medium text-brand hover:underline coarse:min-h-11"
            >
              Continue this chat
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setViewing(null);
              composerRef.current?.focus();
            }}
            className="shrink-0 text-mini font-medium text-ink-secondary hover:text-ink hover:underline coarse:min-h-11"
          >
            Back
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleThreadScroll}
        className={cn(
          'flex min-h-[9rem] flex-col gap-2.5 overflow-y-auto pr-1',
          fill ? 'min-h-0 flex-1' : 'max-h-[26rem]',
        )}
      >
        {showEmptyState && disabled && fallback ? (
          fallback
        ) : showEmptyState ? (
          /*
            An opening, not a placeholder.
            
            The suggestions were chips in a centred cluster, which reads as
            decoration beside a caption. Stacked as full-width rows they read
            as the first thing to do, and each one is drawn from what the case
            actually holds — so this is the shortest description of the file
            anybody gets, as well as the way in.

            Sat at the bottom rather than centred. Centred, it floated in the
            middle of a tall empty column with the composer far below it, so
            the two halves of one action — read the suggestion, type the
            question — were at opposite ends of the pane. Above the composer
            they read as one thing, and the empty space goes where empty space
            belongs, which is above the content rather than around it.
          */
          <div className={cn('flex flex-1 flex-col justify-end gap-3', compact ? 'py-3' : 'py-6')}>
            {planLeadCards}
            <div className="flex items-center gap-2.5">
              <AiMark size="md" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{emptyTitle ?? 'Ask about this case'}</p>
                <p className="text-xs leading-relaxed text-ink-secondary">
                  {emptyHint ?? 'Answers come from its own evidence, with the source attached.'}
                </p>
              </div>
            </div>
            {suggestions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {(compact ? suggestions.slice(0, 3) : suggestions).map((s, i) => (
                  <motion.button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => void submit(s)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: EASE_ENTER, delay: 0.05 * i }}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 text-left text-[13px] text-ink-secondary shadow-card',
                      'ring-1 ring-inset ring-[var(--ring)] transition-[color,box-shadow] duration-quick',
                      'hover:text-ink hover:shadow-tile hover:ring-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50',
                      'coarse:min-h-11',
                    )}
                  >
                    <MessageCircle size={14} className="shrink-0 text-ink-muted transition-colors group-hover:text-brand" />
                    <span className="min-w-0 flex-1">{s}</span>
                    <ArrowUp size={13} className="shrink-0 rotate-45 text-ink-muted transition-transform duration-quick ease-state group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand" />
                  </motion.button>
                ))}
              </div>
            ) : null}
          </div>
        ) : tab === 'activity' ? (
          /*
            One line an event, not two bubbles.
            Each of these was a blue user bubble, a grey "Recorded." reply, a
            citation chip and an "Agent-generated" tag — four elements to say a
            field was saved. What a reader wants from a log is when and what,
            newest first, and the ability to stop reading.
          */
          <ol className="space-y-0.5">
            {[...groupActivity(activity)].reverse().map((entry) => (
              <li
                key={entry.turn.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 py-1 text-[12px]"
              >
                <span className="font-mono text-mini tabular-nums text-ink-muted">{relativeTime(entry.at)}</span>
                <span className="min-w-0 text-ink-secondary">
                  {entry.summary}
                  {entry.count > 1 ? (
                    <span className="ml-1 font-mono text-mini text-ink-muted">×{entry.count}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <>
            {planLeadCards}
            {shown.map((turn) => (
              /*
                `animate-rise-in` on each turn, which the design system
                already defines and reduced-motion already neutralises. A
                conversation where answers appear instantaneously reads as a
                page repainting; a small rise reads as something arriving.
              */
              <div key={turn.id} className="animate-rise-in">
              <TurnBubble
                verification={verification}
                turn={turn}
                here={place}
                evidence={evidence}
                nodes={nodes}
                applied={appliedByTurn?.[turn.id]}
                screenResult={screenResult}
                valuationRuns={valuationRuns}
                onPick={(text, sitting) => void onPickChoice?.(text, sitting)}
                busy={busy}
                planStep={planSaid.get(turn.id)}
                mayPress={(choice) => choiceMayBePressed(choice, turn, own, Boolean(reading))}
                onOpenNode={onOpenNode}
                onOpenEvidence={onOpenEvidence}
                onOpenDocument={onOpenDocument}
                extras={renderTurnExtras?.(turn)}
                plansDrawn={Boolean(planProject)}
                under={
                  <>
                    {planUnder.at.has(turn.id) ? planCard(planUnder.at.get(turn.id)!, { said: turn.text }) : null}
                    {turn.changed ? (
                      <TurnChanges
                        changed={turn.changed}
                        busy={busy}
                        onUndo={
                          onPickChoice
                            ? () => {
                                // The undo is said in the chat that is current: that is the one to be looking at when it comes.
                                setViewing(null);
                                const changed = turn.changed!;
                                void onPickChoice(undoSentence(changed), { undo: { turnId: turn.id } });
                              }
                            : undefined
                        }
                      />
                    ) : null}
                  </>
                }
              />
              </div>
            ))}
            {/* What was just sent, in the chat it was sent to, until the thread holds it with its reply or it is handed back. */}
            {reading
              ? null
              : pending?.map((message, n) => (
                  <div key={n} className="animate-rise-in">
                    <TurnBubble
                      turn={{ id: `being-answered-${n}`, role: 'user', text: message.text, at: '', citedEvidenceIds: [] }}
                      attached={message.files}
                      evidence={evidence}
                    />
                  </div>
                ))}
            {busy ? <TypingIndicator steps={steps ?? []} /> : null}
          </>
        )}
      </div>

      {!compact && !showEmptyState && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline pt-2">
          {suggestions.map((s) => (
            <SuggestionChip key={s} text={s} disabled={disabled || busy} onClick={() => void submit(s)} />
          ))}
        </div>
      ) : null}

      {dock ? <div className="shrink-0">{dock}</div> : null}

      {disabled ? (
        <div className="flex items-start gap-2 rounded-lg bg-sunken px-2.5 py-2 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
          <Info size={13} className="mt-px shrink-0 text-ink-muted" />
          <span>
            {disabledReason ?? 'No model is configured for this deployment.'} Everything else on this case works.
          </span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-mini text-ink-secondary ring-1 ring-inset ring-[var(--ring)]"
              >
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="text-ink-muted hover:text-ink"
                  onClick={() => {
                    setFiles((prev) => prev.filter((x) => x !== f));
                    setLeftOut(null);
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {leftOut ? (
          <p className="px-1 text-mini text-[var(--status-warning-text)]" role="status">
            {leftOut}
          </p>
        ) : null}
        <div
          className={cn(
            'flex flex-col rounded-2xl bg-surface shadow-card ring-1 ring-inset ring-[var(--ring)]',
            'transition-[box-shadow] duration-quick ease-state focus-within:ring-2 focus-within:ring-brand focus-within:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.10)]',
            (disabled || busy) && 'opacity-90',
          )}
        >
          <textarea
            aria-label="Ask the copilot"
            placeholder={disabled ? 'Copilot unavailable' : placeholder ?? (onOpenCommands ? 'Ask about this case, or / for commands' : 'Ask about this case…')}
            value={text}
            rows={1}
            disabled={disabled || busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className={cn(
              'max-h-[9rem] min-h-[2.75rem] w-full resize-none bg-transparent px-3.5 pb-1 pt-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-muted coarse:text-base',
            )}
            ref={composerRef}
          />
          <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
            {allowAttach ? (
              <AttachControls disabled={!takesFiles} voice={voice} onCheckVoice={onCheckVoice} staged={files} onAdd={(next) => addFiles(next, true)} />
            ) : null}
            <span className="flex-1" />
            {onOpenCommands && !compact ? (
              <span className="hidden pr-1 text-[11px] text-ink-muted sm:inline">
                <kbd className="font-mono">/</kbd> for commands
              </span>
            ) : null}
            {planInHand && planProject ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={planStopAsked}
                aria-label="Stop the plan"
                onClick={() => {
                  setPlanStopAsked(true);
                  stopPlan(planProject, planInHand).catch(() => setPlanStopAsked(false));
                }}
              >
                {planStopAsked ? 'Stopping' : 'Stop'}
              </Button>
            ) : busy && onCancel ? (
              <Button type="button" variant="secondary" size="sm" onClick={onCancel} aria-label="Stop">
                Stop
              </Button>
            ) : (
              <button
                type="submit"
                disabled={disabled || busy || (!text.trim() && files.length === 0)}
                aria-label="Ask"
                className={cn(
                  'grid size-8 place-items-center rounded-full bg-action text-action-ink coarse:size-11',
                  'transition-[transform,opacity,background-color] duration-quick ease-state hover:bg-action-hover active:scale-95',
                  'disabled:cursor-not-allowed disabled:opacity-30',
                )}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        {/* The rule this product keeps, said where a person types. */}
        {compact ? null : (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-muted">
            <Lock size={11} aria-hidden />
            Only people change the record. AI proposals wait for a decision.
          </p>
        )}
      </form>
      {error || askError ? (
        <p className="text-xs text-critical" role="alert">
          {error ?? askError}
        </p>
      ) : null}
      {/* Every chat on the project, for everyone, in one go: asked about once, with the answer that changes nothing in hand. */}
      <Modal
        open={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        title="Delete every chat on this project?"
        width="sm"
        footer={
          <>
            {/* The question opens with the keyboard on the answer that changes nothing. */}
            <Button data-autofocus type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Keep them
            </Button>
            <Button type="button" variant="danger" loading={deleting} onClick={() => void deleteChats()}>
              Delete all chats
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-secondary">They are removed for everyone and cannot be brought back. The Activity list goes with them.</p>
      </Modal>
    </div>
  );
}
