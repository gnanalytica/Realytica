import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { AiMark, Button, Input, cn, useToast } from '../../components/ui/kit';
import { cardAct, cardIds, command, prompts, reply, tryLine, type Act, type Answer, type ChatMessage, type Here, type Prompt } from './chat';
import { fieldById, flagById, photoById, slotById } from './engine';
import { useOpen, usePlace } from './place';
import { useExample } from './state';

const BUBBLE = 'max-w-[96%] px-[11px] py-[9px] text-[13px] [overflow-wrap:anywhere]';
const REF =
  'min-h-7 rounded-full border border-[var(--axis)] bg-surface px-2.5 py-1 text-[12px] text-brand-strong transition-colors duration-quick ease-state hover:border-brand hover:bg-brand-soft';

type CardMessage = Extract<ChatMessage, { kind: 'card' }>;

/**
 * A change the copilot proposes. Nothing happens until it is approved; what
 * it is about can be looked at before, and what it changed after.
 */
function ProposalCard({ message, onApprove, onDismiss, onShow }: { message: CardMessage; onApprove: () => void; onDismiss: () => void; onShow: () => void }) {
  if (message.state) {
    return (
      <>
        <p className="rounded-xl bg-sunken px-3 py-[11px] text-[13px] text-ink-muted">
          {message.state === 'yes' ? 'Approved' : 'Dismissed'}: {message.t}
        </p>
        {message.state === 'yes' ? (
          <div className="flex flex-wrap gap-1.5 justify-self-start">
            <button type="button" className={REF} onClick={onShow}>
              Show what changed
            </button>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <div className="grid gap-[9px] rounded-xl bg-ai-soft px-3 py-[11px] text-[13px] text-ink ring-1 ring-inset ring-ai/30">
      {message.t}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={onApprove}>
          Approve
        </Button>
        <Button size="sm" onClick={onShow}>
          Show them
        </Button>
        <Button size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * The copilot, down the left of the workspace.
 *
 * It answers from the same files the page is drawn from, and its replies
 * here are scripted, which it says in a line that stays in sight. Asked to
 * show something, it moves the work and the proof pane there without asking.
 * Asked to change something, it puts a card in the thread and waits for it
 * to be approved.
 *
 * On a narrow screen it is a drawer and, while `open`, a dialog: it takes the
 * keyboard as it slides in, and anything it shows closes it again so the
 * thing shown can be seen.
 */
export function CopilotChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useExample();
  const place = usePlace();
  const go = useOpen();
  const toast = useToast();
  const [text, setText] = useState('');
  const thread = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);

  const picked = state.picked && state.picked.at === place.key ? state.picked : null;
  const viewing = state.viewing && state.viewing.at === place.key ? state.viewing : null;
  const here: Here = { dept: place.dept, fn: place.fn, stage: place.stage, marks: state, picked: picked?.kind === 'field' ? (fieldById(picked.id) ?? null) : null };

  /** What the person has in front of them: the open paper, or the thing picked. */
  const looking = viewing
    ? slotById(viewing.id)?.line.t
    : !picked
      ? undefined
      : picked.kind === 'field'
        ? fieldById(picked.id)?.item.l
        : picked.kind === 'photo'
          ? `Photograph: ${photoById(picked.id)?.photo.where ?? ''}`
          : flagById(picked.id, state)?.t;

  // The newest line of the thread is the one in sight.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.chat.length]);

  // The drawer takes the keyboard as it opens. It is in sight from that moment, so it can.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  const show = (act: Act) => {
    go.act(act);
    onClose();
  };

  const answer = (question: string, said: Answer) => {
    dispatch({ type: 'say', messages: [{ kind: 'said', me: true, t: question }, { kind: 'said', t: said.t, refs: said.refs }] });
    if (said.act) show(said.act);
  };

  const ask = (prompt: Prompt) => {
    if (prompt.card) dispatch({ type: 'say', messages: [{ kind: 'said', me: true, t: prompt.t }, { kind: 'card', t: prompt.card.say, card: prompt.card }] });
    else if (prompt.ask) answer(prompt.t, reply(prompt.ask, here));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line) return;
    setText('');
    answer(line, command(line, here) ?? { t: tryLine(here) });
  };

  const approve = (index: number, message: CardMessage) => {
    // What it is about is settled before the change, so "Show what changed" still finds it after.
    const about = cardAct(message.card, state);
    dispatch({ type: 'mark', what: message.card.apply === 'papers' ? 'asked' : 'accepted', ids: cardIds(message.card, state) });
    dispatch({ type: 'settle', index, state: 'yes', shown: about });
    show(about);
    toast(message.card.toast);
  };

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      aria-label="Copilot"
      className={cn(
        'absolute inset-y-0 left-0 z-20 flex min-h-0 w-[min(304px,88vw)] min-w-0 flex-col gap-2.5 border-r border-hairline bg-surface px-3.5 pb-3.5 pt-4 shadow-pop',
        'duration-base ease-enter motion-reduce:transition-none',
        'xl:visible xl:static xl:z-auto xl:w-auto xl:translate-x-0 xl:shadow-none',
        // Opening, it is in sight at once and slides in. Closing, it stays in sight until it has slid away.
        open ? 'visible translate-x-0 transition-transform' : 'invisible -translate-x-[104%] transition-[transform,visibility]',
      )}
    >
      <div className="flex items-center gap-2">
        <AiMark size="md" />
        <h2 className="flex-1 text-[15px] font-semibold text-ink">Copilot</h2>
        <button
          type="button"
          aria-label="Close the copilot"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors duration-quick ease-state hover:bg-sunken hover:text-ink coarse:size-11 xl:hidden"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      {/* Above the thread and not in it, so it never scrolls out of sight. */}
      <p className="text-[12px] text-ink-muted">The replies in this example are scripted.</p>
      <div ref={thread} role="log" aria-label="Conversation" className="grid min-h-[60px] flex-1 content-start gap-2 overflow-y-auto py-1">
        {state.chat.map((message, i) =>
          message.kind === 'card' ? (
            <ProposalCard
              key={i}
              message={message}
              onApprove={() => approve(i, message)}
              onDismiss={() => {
                dispatch({ type: 'settle', index: i, state: 'no' });
                toast('Dismissed.');
              }}
              onShow={() => show(message.shown ?? cardAct(message.card, state))}
            />
          ) : (
            <div key={i} className="grid gap-2">
              <p className={cn(BUBBLE, message.me ? 'justify-self-end rounded-[14px_4px_14px_14px] bg-ink text-ink-inverse' : 'justify-self-start rounded-[4px_14px_14px_14px] bg-sunken text-ink')}>
                {message.t}
              </p>
              {message.refs?.length ? (
                <div className="flex flex-wrap gap-1.5 justify-self-start">
                  {message.refs.map((ref) => (
                    <button key={ref.t} type="button" className={REF} onClick={() => show(ref.act)}>
                      {ref.t}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}
      </div>
      {looking ? (
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted">
          <span className="shrink-0">Looking at</span>
          <b className="truncate font-semibold text-ink">{looking}</b>
        </p>
      ) : null}
      <div className="grid gap-1.5">
        {prompts(here).map((prompt) => (
          <button
            key={prompt.t}
            type="button"
            onClick={() => ask(prompt)}
            className="min-h-[38px] rounded-[10px] border border-hairline bg-surface px-[11px] py-[9px] text-left text-[13px] text-ink transition-colors duration-quick ease-state hover:border-[var(--axis)] hover:bg-page"
          >
            {prompt.t}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask the copilot" placeholder="Ask, or tell it what to do" className="min-w-0 flex-1" />
        <Button type="submit" variant="primary">
          Send
        </Button>
      </form>
    </aside>
  );
}
