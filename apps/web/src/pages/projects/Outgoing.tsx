import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import {
  OUTGOING_BODY,
  OUTGOING_KINDS,
  OUTGOING_KIND_LABEL,
  OUTGOING_NOT_APPROVED,
  OUTGOING_SUBJECT,
  cockpitPath,
  maySeeOutgoing,
  meetingCalled,
  meetingDay,
  meetingsHeld,
  outgoingAboutSaid,
  outgoingNeeds,
  outgoingOf,
  outgoingSourceStands,
  outgoingStatements,
  plural,
  reviewPapers,
  sameEmail,
  type DdProject,
  type OutgoingAbout,
  type OutgoingDraft,
  type OutgoingKind,
  type OutgoingSource,
  type OutgoingStatement,
} from '@realytica/shared';
import { MeetingNotesLink } from '../../components/meetings/MeetingNotes';
import { AiMark, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, cn, useToast } from '../../components/ui/kit';
import { outgoingApi, saveOutgoingDocx, type OutgoingShown } from '../../lib/outgoing-api';
import { useMe } from '../../lib/useMe';
import { useRoster } from '../../lib/useRoster';
import { formatWhen } from './shared';
import type { ProjectOutlet } from './ProjectLayout';

/** A thing that waits for a person: blue, the colour of what is proposed and not yet accepted. */
const WAITING = 'bg-provenance/10 text-provenance-ink ring-1 ring-inset ring-provenance/25';
const STANDS = 'bg-good/10 text-[var(--status-good-text)] ring-1 ring-inset ring-good/25';
const DOUBT = 'bg-warning/15 text-[var(--status-warning-text)] ring-1 ring-inset ring-warning/35';
const CHIP = 'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-mini font-medium leading-4';

function Standing({ draft }: { draft: OutgoingDraft }) {
  return <span className={cn(CHIP, draft.status === 'approved' ? STANDS : WAITING)}>{draft.status === 'approved' ? 'Approved' : 'Draft, not approved'}</span>;
}

/** The body as it is read: a heading, a numbered item on a line of its own, or statements that run together as a paragraph. */
type Block = { kind: 'heading'; statement: OutgoingStatement } | { kind: 'item'; statement: OutgoingStatement } | { kind: 'text'; statements: OutgoingStatement[] };

function blocksOf(statements: OutgoingStatement[]): Block[] {
  const out: Block[] = [];
  let paragraph = -1;
  for (const statement of statements) {
    const last = out[out.length - 1];
    if (statement.heading) out.push({ kind: 'heading', statement });
    else if (/^\d+[.)]\s/.test(statement.text)) out.push({ kind: 'item', statement });
    else if (last?.kind === 'text' && statement.paragraph === paragraph) last.statements.push(statement);
    else out.push({ kind: 'text', statements: [statement] });
    paragraph = statement.paragraph;
  }
  return out;
}

/**
 * One statement of a draft. The numbers after it are what it rests on, and
 * each opens that source below. While the draft is a draft, a statement with
 * nothing behind it is tinted blue for a person to check, and one that writes
 * a figure its source does not is tinted amber.
 */
function Said({ statement, checking, onMark }: { statement: OutgoingStatement; checking: boolean; onMark: (n: number) => void }) {
  const doubt = checking && statement.unheld;
  const own = checking && statement.own;
  return (
    <span className={cn((doubt || own) && 'rounded px-0.5 [box-decoration-break:clone]', doubt ? 'bg-warning/15' : own ? 'bg-provenance/10' : undefined)}>
      {statement.text}
      {statement.marks.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onMark(n)}
          title={`Source ${n}`}
          className="mx-0.5 inline-grid h-4 min-w-4 translate-y-[-1px] place-items-center rounded bg-sunken px-1 align-baseline font-mono text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)] hover:bg-brand-soft hover:text-brand"
        >
          {n}
        </button>
      ))}
      {doubt ? <span className="ml-1 text-mini font-medium text-[var(--status-warning-text)]">figure not in its source</span> : null}{' '}
    </span>
  );
}

/** Where a source opens: the paper at its page, the meeting's notes at the item, the decision, the action. */
function SourceLink({ project, source }: { project: DdProject; source: OutgoingSource }) {
  const from = `${source.title}${source.page ? `, page ${source.page}` : ''}`;
  const link = 'font-medium text-ink underline decoration-[var(--ring)] underline-offset-2 hover:text-brand hover:decoration-brand';
  if (source.kind === 'meeting') {
    return (
      <MeetingNotesLink meetingId={source.id} itemId={source.itemId} projectId={project.id} className="mx-0 text-[13px]">
        {source.title}
      </MeetingNotesLink>
    );
  }
  const to =
    source.kind === 'paper'
      ? cockpitPath(project.id, 'evidence', { evidenceId: source.id, ...(source.page ? { page: String(source.page) } : {}) })
      : source.kind === 'decision'
        ? cockpitPath(project.id, 'decisions', { item: source.id })
        : cockpitPath(project.id, 'actions', { actionId: source.id });
  return (
    <Link to={to} className={link}>
      {from}
    </Link>
  );
}

/** What a new draft is asked for with. */
interface Asking {
  kind: OutgoingKind;
  aboutId: string;
  to: string;
  topic: string;
}

/**
 * Outgoing: what leaves the firm. A letter, a reply, a request for
 * information, and the minutes of a meeting, each a draft filled from the
 * record with what every statement rests on.
 *
 * A draft changes nothing on the record. A person reads it and changes it
 * here, a lead or a signer approves it by name, and it is saved as a Word
 * file. Nothing is sent from here.
 */
export default function OutgoingPage() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const me = useMe();
  const toast = useToast();
  const roster = useRoster();
  const [params, setParams] = useSearchParams();

  /* Drafts go back onto the newest project this page has seen, so a change made elsewhere meanwhile is not put back. */
  const latest = useRef({ project, setProject });
  latest.current = { project, setProject };
  const [meta, setMeta] = useState<Pick<OutgoingShown, 'model' | 'mayDraft' | 'mayApprove'> | null>(null);
  const apply = useCallback((shown: OutgoingShown) => {
    setMeta({ model: shown.model, mayDraft: shown.mayDraft, mayApprove: shown.mayApprove });
    latest.current.setProject({ ...latest.current.project, outgoing: shown.drafts });
  }, []);

  const own = me ? maySeeOutgoing(me.role) : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!own) return;
    let live = true;
    setFailed(null);
    outgoingApi
      .open(project.id)
      .then((shown) => {
        if (live) apply(shown);
      })
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof Error ? e.message : 'Outgoing could not be opened');
      });
    return () => {
      live = false;
    };
  }, [project.id, apply, tries, own]);

  const drafts = outgoingOf(project);
  const draftId = params.get('draft');
  const draft = drafts.find((held) => held.id === draftId);
  const open = useCallback(
    (id?: string) =>
      setParams((was) => {
        const out = new URLSearchParams(was);
        if (id) out.set('draft', id);
        else out.delete('draft');
        return out;
      }),
    [setParams],
  );

  const papers = useMemo(() => reviewPapers(project), [project]);
  const meetings = useMemo(() => meetingsHeld(project), [project]);
  const who = (actor: string) => roster.find((person) => sameEmail(person.email, actor))?.name ?? actor.split('@')[0] ?? actor;

  const [busy, setBusy] = useState<string | null>(null);
  /** One change to a draft: made, drawn, and said when it fails. */
  const change = useCallback(
    async (what: string, act: () => Promise<OutgoingShown>, failedAs: string): Promise<OutgoingShown | undefined> => {
      setBusy(what);
      try {
        const shown = await act();
        apply(shown);
        if (shown.said) toast(shown.said, 'warning');
        return shown;
      } catch (e) {
        toast(e instanceof Error ? e.message : failedAs, 'critical');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [apply, toast],
  );

  /* A new draft. */
  const [asking, setAsking] = useState<Asking | null>(null);
  const needsPaper = asking?.kind === 'reply';
  const ofMeeting = asking?.kind === 'minutes';
  const canAsk = asking ? (ofMeeting || needsPaper ? Boolean(asking.aboutId) : Boolean(asking.aboutId || asking.topic.trim())) : false;
  async function start() {
    if (!asking) return;
    const about: OutgoingAbout | undefined = asking.aboutId ? { kind: ofMeeting ? 'meeting' : 'paper', id: asking.aboutId } : undefined;
    setBusy('start');
    try {
      const made = await outgoingApi.start(project.id, { kind: asking.kind, ...(about ? { about } : {}), ...(asking.to.trim() ? { to: asking.to } : {}), ...(asking.topic.trim() ? { topic: asking.topic } : {}) });
      apply(made);
      if (made.said) toast(made.said, 'warning');
      setAsking(null);
      open(made.draftId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The draft could not be made', 'critical');
    } finally {
      setBusy(null);
    }
  }

  /* One draft, being changed. */
  const [editing, setEditing] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'remove' | null>(null);
  const [allSources, setAllSources] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    setEditing(null);
    setConfirm(null);
    setAllSources(false);
    setLit(null);
  }, [draftId]);

  const statements = useMemo(() => (draft ? outgoingStatements(draft.body, draft.sources) : []), [draft]);
  const needs = useMemo(() => (draft && draft.status !== 'approved' ? outgoingNeeds(project, draft) : []), [project, draft]);

  if (own === false) {
    return (
      <Card>
        <EmptyState icon={<Send size={18} />} title="Outgoing is for the firm’s own people" description="Drafts of what the firm sends are not shared with somebody working from a grant on one project." />
      </Card>
    );
  }
  if (failed) {
    return (
      <Card>
        <EmptyState icon={<Send size={18} />} title="Outgoing could not be opened" description={failed} action={<Button onClick={() => setTries((n) => n + 1)}>Try again</Button>} />
      </Card>
    );
  }

  const mayDraft = meta?.mayDraft ?? false;
  const mayApprove = meta?.mayApprove ?? false;
  const model = meta?.model ?? true;

  const newDialog = (
    <Modal
      open={Boolean(asking)}
      onClose={() => setAsking(null)}
      title="New draft"
      footer={
        <>
          <Button variant="ghost" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void start()} disabled={!canAsk} loading={busy === 'start'}>
            Draft it
          </Button>
        </>
      }
    >
      {asking ? (
        <div className="space-y-3">
          <Field label="What to draft">
            <Select value={asking.kind} onChange={(e) => setAsking({ ...asking, kind: e.target.value as OutgoingKind, aboutId: '' })}>
              {OUTGOING_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {OUTGOING_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
          {ofMeeting ? (
            <Field label="Meeting" hint={meetings.length ? 'The minutes are put together from the notes this file keeps. No model words them.' : 'No meeting is kept on this file yet. Paste a meeting’s notes in the chat first.'}>
              <Select value={asking.aboutId} onChange={(e) => setAsking({ ...asking, aboutId: e.target.value })} disabled={!meetings.length}>
                <option value="">Choose a meeting</option>
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    {meetingCalled(meeting)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <Field label={needsPaper ? 'The paper it answers' : 'The paper it is about'} hint={needsPaper && !papers.length ? 'No paper is on this file yet. File the letter first.' : undefined}>
                <Select value={asking.aboutId} onChange={(e) => setAsking({ ...asking, aboutId: e.target.value })}>
                  <option value="">{needsPaper ? 'Choose a paper' : 'No paper'}</option>
                  {papers.map((paper) => (
                    <option key={paper.id} value={paper.id}>
                      {paper.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To">
                <Input value={asking.to} onChange={(e) => setAsking({ ...asking, to: e.target.value })} maxLength={120} placeholder="Who it goes to" />
              </Field>
              <Field label="What it is about" hint="Decisions, actions and values the words name are laid out as its sources.">
                <Input value={asking.topic} onChange={(e) => setAsking({ ...asking, topic: e.target.value })} maxLength={OUTGOING_SUBJECT} placeholder={asking.kind === 'rfi' ? 'the revised drawings' : asking.kind === 'reply' ? 'the points to answer' : 'asking for the khata extract'} />
              </Field>
            </>
          )}
          {!ofMeeting && !model ? <p className="text-xs text-ink-muted">No model is set up, so the body is yours to write. The frame and the sources are filled from the record.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
  const newButton = mayDraft ? (
    <Button variant="primary" onClick={() => setAsking({ kind: 'letter', aboutId: '', to: '', topic: '' })}>
      New draft
    </Button>
  ) : null;

  /* ---------------------------------------------------------------- */
  /* Every draft                                                       */
  /* ---------------------------------------------------------------- */

  if (!draft) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 basis-64 text-[13px] text-ink-secondary">Letters, replies, requests for information and minutes, filled from the record. Nothing is sent from here.</p>
          {newButton}
        </div>
        {draftId && meta ? <p className="text-[13px] text-[var(--status-warning-text)]">That draft is no longer on this file.</p> : null}
        {!meta ? (
          <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-ink-muted">
            <Spinner size={14} /> Opening
          </div>
        ) : drafts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Send size={18} />}
              title="Nothing drafted yet"
              description="Ask in the chat, as in “draft a reply to the contractor’s letter on the delay” or “draft the minutes of the last meeting”, or start one here."
              action={newButton}
            />
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--ring)]">
              {[...drafts].reverse().map((held) => (
                <li key={held.id}>
                  <button type="button" onClick={() => open(held.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-sunken coarse:min-h-11">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="block truncate text-[13px] font-medium text-ink">{held.subject || OUTGOING_KIND_LABEL[held.kind]}</span>
                      <span className="block truncate text-[12px] text-ink-muted">
                        {OUTGOING_KIND_LABEL[held.kind]} · {held.ref}
                        {held.to ? ` · to ${held.to}` : ''} · {meetingDay(held.dated)}
                      </span>
                    </span>
                    <Standing draft={held} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {newDialog}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* One draft                                                         */
  /* ---------------------------------------------------------------- */

  const approved = draft.status === 'approved';
  const written = statements.some((statement) => !statement.heading);
  const used = new Set(statements.flatMap((statement) => statement.marks));
  const ownCount = statements.filter((statement) => statement.own).length;
  const about = outgoingAboutSaid(project, draft.about);
  const everySource = Boolean(editing) || !written || allSources;
  const sources = everySource ? draft.sources : draft.sources.filter((source) => used.has(source.n));
  /** A mark in the body, pressed: its source below is brought into view and picked out. */
  const mark = (n: number) => {
    setLit(n);
    document.getElementById(`outgoing-source-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  async function save() {
    if (!editing || !draft) return;
    const was = draft.status;
    const shown = await change('save', () => outgoingApi.change(project.id, draft.id, editing), 'The change could not be saved');
    if (!shown) return;
    setEditing(null);
    if (was === 'approved' && shown.drafts.find((held) => held.id === draft.id)?.status === 'draft') toast('Changed after it was approved, so it is a draft again.', 'warning');
  }

  async function exportIt() {
    if (!draft) return;
    setBusy('export');
    try {
      await saveOutgoingDocx(project, draft);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The Word file could not be made', 'critical');
    } finally {
      setBusy(null);
    }
  }

  const frame: Array<{ label: string; value: ReactNode }> = [
    { label: 'Reference', value: draft.ref },
    { label: 'Date', value: meetingDay(draft.dated) },
    { label: 'To', value: draft.to || <span className="text-[var(--status-warning-text)]">Not said yet</span> },
    { label: 'Subject', value: draft.subject || <span className="text-[var(--status-warning-text)]">Not said yet</span> },
    ...(about && draft.about && draft.kind !== 'minutes'
      ? [
          {
            label: draft.kind === 'reply' ? 'In reply to' : 'About',
            value:
              draft.about.kind === 'paper' ? (
                <Link to={cockpitPath(project.id, 'evidence', { evidenceId: draft.about.id })} className="text-brand hover:underline">
                  {about}
                </Link>
              ) : (
                <Link to={cockpitPath(project.id, 'actions', { actionId: draft.about.id })} className="text-brand hover:underline">
                  {about}
                </Link>
              ),
          },
        ]
      : []),
    ...(draft.kind === 'minutes' && draft.about ? [{ label: 'Meeting', value: <MeetingNotesLink meetingId={draft.about.id} projectId={project.id} className="mx-0 text-[13px]">{about ?? 'notes'}</MeetingNotesLink> }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={() => open()} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] font-medium text-ink-secondary hover:bg-sunken hover:text-ink coarse:min-h-11">
          <ArrowLeft size={14} /> All drafts
        </button>
        <h2 className="min-w-0 flex-1 basis-40 truncate text-[15px] font-semibold text-ink">
          {OUTGOING_KIND_LABEL[draft.kind]} <span className="font-normal text-ink-muted">{draft.ref}</span>
        </h2>
        <Standing draft={draft} />
      </div>

      {/* How it stands, and what a person can do with it. */}
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2', approved ? STANDS : WAITING)}>
        <p className="min-w-0 flex-1 basis-64 text-[13px]">
          {approved ? (
            <>
              Approved for sending by <span className="font-medium">{draft.approvedName ?? who(draft.approvedBy ?? '')}</span>
              {draft.approvedAt ? `, ${formatWhen(draft.approvedAt)}` : ''}. Nothing is sent from here: the Word file is yours to send.
            </>
          ) : (
            <>
              <span className="font-medium">{OUTGOING_NOT_APPROVED}.</span> The Word file says so on every page until a lead or a signer approves it.
            </>
          )}
        </p>
        {mayDraft && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setEditing({ to: draft.to, subject: draft.subject, body: draft.body })} disabled={Boolean(busy)}>
              Edit
            </Button>
            {approved ? (
              <Button size="sm" onClick={() => void change('reopen', () => outgoingApi.reopen(project.id, draft.id), 'The approval could not be taken back')} loading={busy === 'reopen'} disabled={Boolean(busy)}>
                Take approval back
              </Button>
            ) : mayApprove ? (
              <Button size="sm" variant="primary" onClick={() => setConfirm('approve')} disabled={Boolean(busy) || needs.length > 0}>
                Approve for sending
              </Button>
            ) : null}
            <Button size="sm" onClick={() => void exportIt()} loading={busy === 'export'} disabled={Boolean(busy)}>
              Export to Word
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('remove')} disabled={Boolean(busy)}>
              Remove
            </Button>
          </div>
        ) : null}
      </div>
      {!approved && mayDraft && !mayApprove ? <p className="px-1 text-[12px] text-ink-muted">A lead or a signer on this project approves what goes out. You can draft it and change it.</p> : null}

      {needs.length && !editing ? (
        <div className={cn('rounded-xl px-3 py-2 text-[13px]', DOUBT)}>
          <p className="font-medium">Before it can be approved</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-secondary">
            {needs.map((need) => (
              <li key={need}>{need}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardBody className="space-y-4">
          {editing ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="To">
                  <Input value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} maxLength={120} />
                </Field>
                <Field label="Subject">
                  <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} maxLength={OUTGOING_SUBJECT} />
                </Field>
              </div>
              <Field label="Body" hint="One statement a line, and a blank line between paragraphs. End a statement with the number of a source below, as in [1], to rest it on that source.">
                <Textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={14} maxLength={OUTGOING_BODY} className="min-h-[280px]" />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => void save()} loading={busy === 'save'}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)} disabled={Boolean(busy)}>
                  Cancel
                </Button>
                {approved ? <span className="text-[12px] text-[var(--status-warning-text)]">Saving a change puts it back to draft.</span> : null}
              </div>
            </div>
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[max-content_1fr]">
                {frame.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd className="min-w-0 break-words text-ink max-sm:mb-1.5">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-[var(--ring)] pt-4">
                {written ? (
                  <div className="space-y-3">
                    {!approved ? (
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                        {draft.written === 'model' ? (
                          <span className="inline-flex items-center gap-1 text-ai-ink">
                            <AiMark size="xs" /> Written by a model, held to the sources
                          </span>
                        ) : draft.written === 'code' ? (
                          <span>Put together from the meeting’s notes, word for word</span>
                        ) : draft.written === 'person' ? (
                          <span>Changed by a person since it was drafted</span>
                        ) : null}
                        <span>A number is what a statement rests on.</span>
                        {ownCount ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block size-2.5 rounded-sm bg-provenance/30" /> {plural(ownCount, 'statement has', 'statements have')} nothing on the record behind {ownCount === 1 ? 'it' : 'them'}. Check {ownCount === 1 ? 'it' : 'them'}.
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <div className="max-w-[72ch] space-y-2.5 text-[14px] leading-relaxed text-ink">
                      {blocksOf(statements).map((block, at) =>
                        block.kind === 'heading' ? (
                          <h3 key={at} className="pt-1 text-[13px] font-semibold text-ink">
                            {block.statement.text}
                          </h3>
                        ) : block.kind === 'item' ? (
                          <p key={at} className="pl-5 -indent-5">
                            <Said statement={block.statement} checking={!approved} onMark={mark} />
                          </p>
                        ) : (
                          <p key={at}>
                            {block.statements.map((statement) => (
                              <Said key={statement.line} statement={statement} checking={!approved} onMark={mark} />
                            ))}
                          </p>
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-ink">The body is not written yet.</p>
                    <p className="text-[13px] text-ink-secondary">
                      {model ? 'A model can write it from the record, or you can. ' : 'No model is set up, so it is yours to write. '}
                      {draft.sources.length ? `${plural(draft.sources.length, 'source is', 'sources are')} laid out below to write from.` : 'Nothing on the record was found for it.'}
                    </p>
                    {mayDraft ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {model ? (
                          <Button size="sm" variant="primary" onClick={() => void change('write', () => outgoingApi.write(project.id, draft.id), 'The draft could not be written')} loading={busy === 'write'} disabled={Boolean(busy)}>
                            Write it from the record
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => setEditing({ to: draft.to, subject: draft.subject, body: draft.body })} disabled={Boolean(busy)}>
                          Write it yourself
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* What the record holds for it. */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-[13px] font-semibold text-ink">Sources</h3>
            {written && !editing && draft.sources.length > used.size ? (
              <button type="button" onClick={() => setAllSources((was) => !was)} className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
                {allSources ? 'Show only the ones used' : `Show all ${draft.sources.length}`}
              </button>
            ) : null}
          </div>
          {sources.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">
              {draft.sources.length ? 'No statement rests on a source yet.' : 'Nothing on the record was found for it. Every statement will be the drafter’s own.'}
            </p>
          ) : (
            <ol className="space-y-1">
              {sources.map((source) => {
                const stands = outgoingSourceStands(project, source);
                return (
                  <li key={source.n} id={`outgoing-source-${source.n}`} className={cn('flex gap-2.5 rounded-lg px-2 py-1.5 text-[13px]', lit === source.n && 'bg-brand-soft ring-1 ring-inset ring-brand/30')}>
                    <span className="mt-0.5 inline-grid h-4 min-w-4 shrink-0 place-items-center rounded bg-sunken px-1 font-mono text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">{source.n}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <SourceLink project={project} source={source} />
                        {source.waiting ? <span className={cn(CHIP, WAITING)}>Waiting to be accepted</span> : null}
                        {!stands ? <span className={cn(CHIP, DOUBT)}>No longer stands</span> : null}
                        {source.scanned ? <span className="text-mini text-ink-muted">From a scan</span> : null}
                      </p>
                      <p className={cn('break-words text-ink-secondary', !stands && 'line-through')}>{source.passage ? `“${source.says}”` : source.says}</p>
                      {source.quote && !source.passage ? <p className="break-words text-[12px] text-ink-muted">“{source.quote}”</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-[12px] text-ink-muted">The Word file lists the sources the body uses, numbered in the order it uses them, each with its paper and page.</p>
        </CardBody>
      </Card>

      <p className="px-1 text-[12px] text-ink-muted">
        Drafted by {who(draft.createdBy)}, {formatWhen(draft.createdAt)}
        {draft.changedAt ? `. Changed by ${who(draft.changedBy ?? '')}, ${formatWhen(draft.changedAt)}` : ''}. A draft changes nothing on the record.
      </p>

      <Modal
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        title="Approve for sending"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy === 'approve'}
              onClick={() => {
                void change('approve', () => outgoingApi.approve(project.id, draft.id), 'It could not be approved').then(() => setConfirm(null));
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          You are approving {draft.ref} for sending{me?.name ? `, as ${me.name}` : ''}. The Word file will carry your name and the time. Nothing is sent from here, and a change after this puts it back to draft.
        </p>
      </Modal>
      <Modal
        open={confirm === 'remove'}
        onClose={() => setConfirm(null)}
        title="Remove this draft"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'remove'}
              onClick={() => {
                void change('remove', () => outgoingApi.remove(project.id, draft.id), 'The draft could not be removed').then((shown) => {
                  setConfirm(null);
                  if (shown) open();
                });
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-secondary">{draft.ref} is taken off this file. The trail keeps a line that it was removed.</p>
      </Modal>
      {newDialog}
    </div>
  );
}
