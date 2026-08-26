import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Paperclip, Send, Sparkles } from 'lucide-react';
import type { IntakeGap } from '@realytica/shared';
import { api, type IntakeEnvelope } from '../lib/api';
import { Badge, Button, Card, CardBody, Input, Spinner, cn, useToast } from '../components/ui/kit';
import { DraftPanel, displayValue } from '../components/intake/DraftPanel';
import { CaseRail } from '../components/intake/CaseRail';
import { useAsync } from '../lib/useAsync';
import { useAreaUnitFor } from '../lib/units';

/**
 * The front door.
 *
 * The case form asks for six required fields before it will accept anything,
 * three of which the screening engine does not read at that stage. This asks
 * for what the engine actually needs — a locality, a property type and an area
 * — and puts a real indicative range and the real critical-document list in
 * front of someone on the third answer. Everything after that sharpens the
 * result instead of gating it.
 *
 * Two things are load-bearing and easy to lose in a redesign:
 *
 *  - The draft is always on screen. A conversation that fills in a form you
 *    cannot see is worse than the form, because you cannot correct what you
 *    cannot see was captured.
 *  - Nothing is created until the button is pressed. Opening this page,
 *    typing, and leaving creates nothing to clean up.
 */
export default function Intake() {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<IntakeEnvelope | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaUnit = useAreaUnitFor('IN');
  const { data: cases } = useAsync(() => api.listCases(), []);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api
      .startIntake()
      .then((next) => {
        if (live) setState(next);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const turns = state?.session.turns ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

  /**
   * Whether a model is actually reading what the user types.
   *
   * Read off the transcript rather than from a capability probe: an assistant
   * turn carries a `runId` exactly when a model produced it. That makes this
   * the same fact the server acted on, not a second opinion that could differ.
   */
  const modelReading = useMemo(
    () => turns.some((t) => t.role === 'assistant' && t.runId !== undefined),
    [turns],
  );
  const answeredAnything = turns.some((t) => t.role === 'user');

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || !state || sending) return;
    setSending(true);
    setDraft('');
    try {
      setState(await api.intakeTurn(state.session.id, message));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That message did not get through.', 'critical');
      setDraft(message);
    } finally {
      setSending(false);
    }
  }, [draft, state, sending, toast]);

  const answer = useCallback(
    async (gap: IntakeGap, value: string | number) => {
      if (!state) return;
      setBusyPath(gap.path);
      try {
        setState(await api.setIntakeField(state.session.id, gap.path, value));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not record that.', 'critical');
      } finally {
        setBusyPath(null);
      }
    },
    [state, toast],
  );

  const build = useCallback(async () => {
    if (!state) return;
    setBuilding(true);
    try {
      const result = await api.commitIntake(state.session.id, {});
      toast(`${result.case.reference} built and screened.`, 'good');
      navigate(`/cases/${result.case.id}/snapshot`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not build the case.', 'critical');
      setBuilding(false);
    }
  }, [state, toast, navigate]);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !state) return;
      try {
        setState(await api.uploadIntakeDocuments(state.session.id, Array.from(files)));
        toast(`${files.length} document${files.length === 1 ? '' : 's'} received.`, 'good');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Upload failed.', 'critical');
      }
    },
    [state, toast],
  );

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardBody className="text-sm text-ink-secondary">Could not start a conversation: {error}</CardBody>
        </Card>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Spinner /> Starting…
      </div>
    );
  }

  const { readout, session } = state;
  const gap = readout.nextQuestion;

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-h-[70vh] flex-col">
        <div className="mb-4 flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Start a case</h1>
          <Badge tone={modelReading ? 'brand' : 'neutral'}>
            {modelReading ? 'Reading what you write' : answeredAnything ? 'Guided — no model configured' : 'Guided'}
          </Badge>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1" data-testid="transcript">
          {turns.map((turn) => (
            <div
              key={turn.id}
              data-role={turn.role}
              className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[42rem] animate-rise-in rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  turn.role === 'user' ? 'bg-brand text-ink-inverse' : 'bg-surface text-ink ring-1 ring-inset ring-[var(--ring)]',
                )}
              >
                <p className="whitespace-pre-wrap">{turn.text}</p>
                {/*
                 * The receipt. Everything a turn captured is listed under it,
                 * so a particular can never enter the draft without the user
                 * seeing the exact message it was read out of.
                 */}
                {turn.matchedCaseIds?.length ? (
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-hairline pt-2">
                    {turn.matchedCaseIds.map((id) => {
                      const c = cases?.find((x) => x.id === id);
                      return c ? (
                        <Link
                          key={id}
                          to={`/cases/${c.id}`}
                          data-matched={c.reference}
                          className="rounded-lg bg-sunken px-2.5 py-1.5 text-[12px] text-ink transition-colors hover:bg-raised"
                        >
                          <span className="tabular text-ink-muted">{c.reference}</span> {c.label}
                        </Link>
                      ) : null;
                    })}
                  </div>
                ) : null}
                {turn.captured?.length ? (
                  <p className="mt-2 border-t border-hairline pt-2 text-[11px] text-ink-secondary">
                    Recorded: {turn.captured.map((c) => `${c.label} — ${displayValue(c, areaUnit)}`).join('; ')}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Spinner size={13} /> Reading that…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {/*
         * The current question as buttons.
         *
         * Not a fallback for the no-model case, though it is what makes that
         * case work: picking from four labelled options is faster than typing
         * a sentence even when something is reading the sentence, and it is
         * the only path that cannot be misparsed.
         */}
        {gap?.options ? (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="options">
            <span className="text-xs text-ink-muted">{gap.label}:</span>
            {gap.options.map((o) => (
              <Button key={o.value} size="sm" variant="secondary" loading={busyPath === gap.path} onClick={() => answer(gap, o.value)}>
                {o.label}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" icon={<Paperclip size={15} />} onClick={() => fileRef.current?.click()} aria-label="Attach a document" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              gap && !gap.options ? `${gap.label}…` : 'Tell me about the property'
            }
            aria-label="Message"
            className="flex-1"
          />
          <Button variant="primary" icon={<Send size={15} />} loading={sending} onClick={() => void send()} disabled={!draft.trim()}>
            Send
          </Button>
        </div>
        {gap ? (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink-secondary">{gap.label}</span> — {gap.consequence}
          </p>
        ) : null}
      </div>

      <aside data-testid="draft" aria-label="Draft" className="lg:sticky lg:top-6 lg:self-start">
        {/*
         * One rail, two jobs. Until the conversation has captured anything it
         * shows the cases you already have, because reopening one is the most
         * common thing anyone does here and making that a sentence to compose
         * would be slower than the dashboard this replaced. The moment a
         * particular lands, it becomes the draft.
         */}
        {session.fields.length === 0 ? (
          <CaseRail cases={cases ?? []} highlight={turns.flatMap((t) => t.matchedCaseIds ?? [])} />
        ) : (
        <DraftPanel
          readout={readout}
          fields={session.fields}
          onConfirm={async (path) => {
            setBusyPath(path);
            try {
              setState(await api.confirmIntakeField(session.id, path));
            } finally {
              setBusyPath(null);
            }
          }}
          onClear={async (path) => {
            setBusyPath(path);
            try {
              setState(await api.clearIntakeField(session.id, path));
            } finally {
              setBusyPath(null);
            }
          }}
          onBuild={() => void build()}
          building={building}
          busyPath={busyPath}
        />
        )}
      </aside>
    </div>
  );
}
