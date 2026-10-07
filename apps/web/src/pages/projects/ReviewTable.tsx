import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ChevronDown, Table2 } from 'lucide-react';
import {
  REVIEW_EMPTY_LABEL,
  REVIEW_QUESTION_MAX,
  REVIEW_STANDING_LABEL,
  cockpitPath,
  playbookColumnsOf,
  plural,
  reviewCell,
  reviewColumnLabel,
  reviewColumnsShown,
  reviewFileOf,
  reviewFunctions,
  reviewKinds,
  reviewPapers,
  reviewRows,
  reviewRunPlan,
  reviewRunSaid,
  reviewTableOf,
  reviewValueKeys,
  sameEmail,
  type EvidenceRecord,
  type NewReviewColumn,
  type ReviewCell,
  type ReviewColumn,
  type ReviewRowChoice,
  type ReviewTable,
} from '@realytica/shared';
import { PlaybookEditor, ValueOptions, type PlaybookDraft } from '../../components/review-table/PlaybookEditor';
import { ReviewProof, standingClass, type ProofOf } from '../../components/review-table/ReviewProof';
import { AiMark, Button, Card, Checkbox, EmptyState, Field, Modal, Select, Spinner, Textarea, cn, useToast } from '../../components/ui/kit';
import { ApiRequestError } from '../../lib/api';
import { date } from '../../lib/format';
import { reviewApi, saveReviewTable, type SavedReviewItem } from '../../lib/review-api';
import { useRoster } from '../../lib/useRoster';
import type { ProjectOutlet } from './ProjectLayout';

/** The papers on screen, as the address says them: `?kind=`, `?fn=` or `?paper=` (one id, or several with commas). */
function choiceOf(params: URLSearchParams): ReviewRowChoice {
  const paper = params.get('paper');
  if (paper) return { by: 'papers', ids: paper.split(',').filter(Boolean) };
  const kind = params.get('kind');
  if (kind) return { by: 'kind', kind };
  const fn = params.get('fn');
  return fn ? { by: 'function', fn } : { by: 'all' };
}

/** A run in hand on this page. */
interface Running {
  runId: string;
  how: 'model' | 'search';
  total: number;
  done: number;
  /** The paper being answered now. */
  on?: string;
  stopping: boolean;
}

/**
 * Review: a project's papers as rows, questions as columns.
 *
 * A listed value fills at once from what the paper's row holds. A question in
 * words is answered when somebody presses the button that says how many
 * papers and questions it is, a paper at a time, and each row is drawn as it
 * lands. Every cell opens its paper at the page with the words marked.
 */
export default function ReviewTablePage() {
  const { project, setProject } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const roster = useRoster();
  const [params, setParams] = useSearchParams();

  /* The table goes back onto the newest project this page has seen, so a change made elsewhere meanwhile is not put back. */
  const latest = useRef({ project, setProject });
  latest.current = { project, setProject };
  const apply = useCallback((reviewTable: ReviewTable) => latest.current.setProject({ ...latest.current.project, reviewTable }), []);

  const [meta, setMeta] = useState<{ model: boolean; mayChange: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setMeta(null);
    setFailed(null);
    reviewApi
      .open(project.id)
      .then((out) => {
        if (!live) return;
        setMeta({ model: out.model, mayChange: out.mayChange });
        apply(out.reviewTable);
      })
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof Error ? e.message : 'The review table could not be opened');
      });
    return () => {
      live = false;
    };
  }, [project.id, apply, tries]);

  const model = meta?.model ?? true;
  const mayChange = meta?.mayChange ?? false;
  const table = reviewTableOf(project);
  const choice = useMemo(() => choiceOf(params), [params]);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const papers = useMemo(() => reviewPapers(project), [project]);
  const chosen = useMemo(() => reviewRows(project, choice), [project, choice]);
  const rows = useMemo(() => (unreviewedOnly ? chosen.filter((row) => !table.reviewed?.[row.id]) : chosen), [chosen, unreviewedOnly, table.reviewed]);
  const columns = useMemo(() => reviewColumnsShown(table, chosen), [table, chosen]);
  const plan = useMemo(() => reviewRunPlan(project, rows.map((row) => row.id), { model }), [project, rows, model]);
  const kind = choice.by === 'kind' ? choice.kind : undefined;
  const onePaper = choice.by === 'papers' && chosen.length === 1 ? chosen[0] : undefined;

  const show = useCallback(
    (next: ReviewRowChoice) =>
      setParams(
        (was) => {
          const out = new URLSearchParams(was);
          for (const key of ['paper', 'kind', 'fn']) out.delete(key);
          if (next.by === 'kind') out.set('kind', next.kind);
          if (next.by === 'function') out.set('fn', next.fn);
          if (next.by === 'papers' && next.ids.length) out.set('paper', next.ids.join(','));
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );

  const [open, setOpen] = useState<'add' | 'saved' | 'papers' | 'export' | null>(null);
  const [columnOpen, setColumnOpen] = useState<ReviewColumn | null>(null);
  const [draft, setDraft] = useState<PlaybookDraft | null>(null);
  const [proof, setProof] = useState<ProofOf | null>(null);
  const [busy, setBusy] = useState(false);

  /** One change to the table: made, drawn, and said when it fails. */
  const change = useCallback(
    async (act: () => Promise<{ reviewTable: ReviewTable }>, failedAs: string): Promise<boolean> => {
      setBusy(true);
      try {
        apply((await act()).reviewTable);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : failedAs, 'critical');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apply, toast],
  );

  /* ---- a run: one paper a call, each row drawn as it lands ---------- */

  const [running, setRunning] = useState<Running | null>(null);
  const stopAsked = useRef(false);
  const inHand = useRef<string | null>(null);

  /**
   * One paper of a run. A deployment lets one person make only so many model
   * calls a minute, and a quick run of many papers reaches that: told to
   * wait, it waits the time it is given and asks again, three times at most.
   */
  async function answered(runId: string, evidenceId: string) {
    for (let again = 0; ; again += 1) {
      try {
        return await reviewApi.answerPaper(project.id, runId, evidenceId);
      } catch (e) {
        if (!(e instanceof ApiRequestError) || e.status !== 429 || again >= 3 || stopAsked.current) throw e;
        const seconds = Number(/in (\d+)s/.exec(e.message)?.[1] ?? 10);
        await new Promise((resolve) => setTimeout(resolve, Math.min(60, seconds + 1) * 1000));
      }
    }
  }

  async function run() {
    stopAsked.current = false;
    let started: Awaited<ReturnType<typeof reviewApi.startRun>>;
    // Held while the run is being started, so a second press does not start a second one.
    setBusy(true);
    try {
      started = await reviewApi.startRun(project.id, rows.map((row) => row.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The run could not be started', 'critical');
      return;
    } finally {
      setBusy(false);
    }
    apply(started.reviewTable);
    const { run: mine } = started;
    inHand.current = mine.id;
    setRunning({ runId: mine.id, how: mine.with, total: mine.papers.length, done: 0, stopping: false });
    let done = 0;
    /** Papers that came back with nothing kept, and how many of them in a row. */
    let unanswered = 0;
    let inARow = 0;
    let why = '';
    for (const paper of mine.papers) {
      if (stopAsked.current || inHand.current !== mine.id) break;
      setRunning((was) => (was ? { ...was, on: paper.evidenceId } : was));
      let said: string | undefined;
      try {
        const out = await answered(mine.id, paper.evidenceId);
        apply(out.reviewTable);
        said = out.failed;
      } catch (e) {
        said = e instanceof Error ? e.message : 'The paper could not be answered';
      }
      if (said) {
        unanswered += 1;
        inARow += 1;
        why = said;
      } else {
        inARow = 0;
        done += 1;
      }
      setRunning((was) => (was ? { ...was, done } : was));
      // Two papers in a row with no answer is the model, not the papers: stop asking it.
      if (inARow >= 2) break;
    }
    if (inHand.current !== mine.id) return;
    inHand.current = null;
    setRunning(null);
    const count = `${done} of ${plural(mine.papers.length, 'paper')} ${mine.with === 'model' ? 'answered' : 'searched'}`;
    if (unanswered) toast(`${why} ${count}.`, 'warning');
    else toast(stopAsked.current ? `Stopped. ${count}.` : `${count}.`, 'good');
  }

  function stop() {
    if (!running) return;
    stopAsked.current = true;
    setRunning({ ...running, stopping: true });
    void reviewApi.stopRun(project.id, running.runId).then((out) => apply(out.reviewTable), () => undefined);
  }

  /* Leaving the page stops the asking. What was answered stays. */
  useEffect(
    () => () => {
      const runId = inHand.current;
      if (!runId) return;
      inHand.current = null;
      void reviewApi.stopRun(project.id, runId).catch(() => undefined);
    },
    [project.id],
  );

  const who = (email: string) => roster.find((person) => sameEmail(person.email, email))?.name ?? email.split('@')[0] ?? email;

  if (failed) {
    return (
      <Card>
        <EmptyState icon={<Table2 size={18} />} title="The review table could not be opened" description={failed} action={<Button onClick={() => setTries((n) => n + 1)}>Try again</Button>} />
      </Card>
    );
  }

  if (!papers.length) {
    return (
      <Card>
        <EmptyState
          icon={<Table2 size={18} />}
          title="No papers on the file yet"
          description="Papers filed in Documents are the rows here."
          action={
            <Link to={cockpitPath(project.id, 'evidence')} className="text-[13px] font-medium text-brand">
              Open Documents
            </Link>
          }
        />
      </Card>
    );
  }

  const rowsValue = choice.by === 'kind' ? `kind:${choice.kind}` : choice.by === 'function' ? `fn:${choice.fn}` : choice.by === 'papers' ? 'papers' : 'all';

  return (
    <div className="space-y-3">
      {/* Two rows on a phone, one where there is room: which papers, then what to do with the table. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40 sm:max-w-56">
          <Select
            aria-label="Which papers to show"
            value={rowsValue}
            disabled={Boolean(running)}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'choose') setOpen('papers');
              else if (value.startsWith('kind:')) show({ by: 'kind', kind: value.slice(5) });
              else if (value.startsWith('fn:')) show({ by: 'function', fn: value.slice(3) });
              else if (value === 'all') show({ by: 'all' });
            }}
          >
            <option value="all">All papers</option>
            {choice.by === 'papers' ? <option value="papers">Chosen papers</option> : null}
            <optgroup label="Kind of paper">
              {/* The kind in view is listed even when the file has no paper of it, so the choice always says what is on screen. */}
              {[...new Set([...reviewKinds(project), ...(kind ? [kind] : [])])].map((name) => (
                <option key={name} value={`kind:${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Function">
              {reviewFunctions(project).map((fn) => (
                <option key={fn.key} value={`fn:${fn.key}`}>
                  {fn.label}
                </option>
              ))}
            </optgroup>
            <option value="choose">Choose papers…</option>
          </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink coarse:min-h-11">
          <input type="checkbox" checked={unreviewedOnly} onChange={(e) => setUnreviewedOnly(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[var(--brand)] coarse:h-5 coarse:w-5" />
          Not reviewed only
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mayChange ? (
            <>
              <Button onClick={() => setOpen('saved')} disabled={Boolean(running)}>
                Playbooks
              </Button>
              <Button onClick={() => setOpen('add')} disabled={Boolean(running)}>
                Add column
              </Button>
            </>
          ) : null}
          {columns.length && rows.length ? (
            <div className="relative">
              <Button onClick={() => setOpen(open === 'export' ? null : 'export')} aria-expanded={open === 'export'}>
                Export <ChevronDown size={13} />
              </Button>
              {open === 'export' ? (
                <>
                  <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(null)} />
                  <ul className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg bg-surface p-1 shadow-pop ring-1 ring-[var(--ring)]">
                    {(['csv', 'xlsx'] as const).map((format) => (
                      <li key={format}>
                        <button
                          type="button"
                          className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken coarse:min-h-11"
                          onClick={() => {
                            setOpen(null);
                            void saveReviewTable(project.id, format, rows.map((row) => row.id), project.reference).catch((e: unknown) =>
                              toast(e instanceof Error ? e.message : 'The table could not be exported', 'critical'),
                            );
                          }}
                        >
                          {format === 'csv' ? 'CSV' : 'Excel (.xlsx)'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {running ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-sunken px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
          <Spinner size={14} className="text-provenance-ink" />
          <span className="text-[13px] text-ink">
            {running.how === 'model' ? 'Asking' : 'Searching'}: {running.done} of {plural(running.total, 'paper')}
          </span>
          <div className="flex-grow" />
          <Button size="sm" onClick={stop} disabled={running.stopping}>
            {running.stopping ? 'Stopping after this paper' : 'Stop'}
          </Button>
        </div>
      ) : mayChange && plan.papers.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-sunken px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
          {model ? <AiMark size="sm" /> : null}
          <span className="text-[13px] font-medium text-ink">{reviewRunSaid(plan)}</span>
          {!model ? <span className="text-[12px] text-ink-muted">No model set up</span> : null}
          {plan.left ? <span className="text-[12px] text-ink-muted">{plural(plan.left, 'more paper')} after this run</span> : null}
          <div className="flex-grow" />
          <Button variant="primary" size="sm" onClick={() => void run()} disabled={busy}>
            {model ? 'Ask' : 'Search the pages'}
          </Button>
        </div>
      ) : null}

      {!columns.length ? (
        <Card>
          <EmptyState
            icon={<Table2 size={18} />}
            title={chosen.length ? 'No columns yet' : 'No papers match'}
            description={chosen.length ? 'A column is a listed value, or a question asked of each paper.' : undefined}
            action={
              !chosen.length ? (
                <Button onClick={() => show({ by: 'all' })}>Show all papers</Button>
              ) : mayChange ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => setOpen('add')}>
                    Add a column
                  </Button>
                  <Button onClick={() => setOpen('saved')}>Run a playbook</Button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState title="Every paper here is reviewed" action={<Button onClick={() => setUnreviewedOnly(false)}>Show reviewed papers</Button>} />
        </Card>
      ) : (
        /* The table scrolls sideways inside this frame, with the paper's name held. The page itself never does. */
        <div className="max-w-full overflow-x-auto rounded-2xl bg-surface shadow-card ring-1 ring-[var(--ring)]">
          <table className="w-max min-w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-b border-r border-hairline bg-surface px-3 py-2 align-bottom text-[12px] font-medium text-ink-muted">
                  Paper
                </th>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className="border-b border-r border-hairline p-0 align-bottom font-normal last:border-r-0">
                    <button
                      type="button"
                      onClick={() => setColumnOpen(column)}
                      className={cn('block px-3 py-2 text-left hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand', column.kind === 'question' ? 'w-64' : 'w-40')}
                    >
                      <span className="line-clamp-2 text-[12px] font-medium text-ink-secondary">{reviewColumnLabel(column)}</span>
                      {column.kind === 'question' && !model ? <span className="block text-[11px] text-ink-muted">No model set up</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const mark = table.reviewed?.[row.id];
                const file = reviewFileOf(row);
                return (
                  <tr key={row.id}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-hairline bg-surface px-3 py-2 align-top font-normal">
                      {/* The width is the inner box's: a table lets a cell grow to its longest word, and this column is held on a phone. */}
                      <div className="w-32 [@container(min-width:40rem)]:w-52">
                        <Link to={cockpitPath(project.id, 'evidence', { evidenceId: row.id })} className="line-clamp-2 text-[13px] font-medium text-ink hover:text-brand">
                          {row.title}
                        </Link>
                        {kind ? null : <span className="block truncate text-[11px] text-ink-muted">{row.documentType ?? 'No kind yet'}</span>}
                        {mayChange ? (
                          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-secondary coarse:min-h-11">
                            <input
                              type="checkbox"
                              checked={Boolean(mark)}
                              disabled={busy}
                              onChange={(e) => void change(() => reviewApi.setReviewed(project.id, row.id, e.target.checked), 'The row could not be marked')}
                              className="h-3.5 w-3.5 shrink-0 accent-[var(--brand)] coarse:h-5 coarse:w-5"
                            />
                            Reviewed
                          </label>
                        ) : mark ? (
                          <span className="mt-1.5 block text-[12px] text-ink-secondary">Reviewed</span>
                        ) : null}
                        {mark ? (
                          <span className="block truncate text-[11px] text-ink-muted">
                            {who(mark.by)}, {date(mark.at)}
                          </span>
                        ) : null}
                      </div>
                    </th>
                    {columns.map((column) => {
                      const cell = reviewCell(project, column, row, { model });
                      const asking = running?.on === row.id && column.kind === 'question' && cell.kind === 'empty' && (cell.why === 'not_asked' || cell.why === 'no_model');
                      return (
                        <td key={column.id} className={cn('border-b border-r border-hairline p-0 align-top last:border-r-0', column.kind === 'question' ? 'w-64' : 'w-40')}>
                          <CellView
                            cell={cell}
                            wide={column.kind === 'question'}
                            asking={asking ? (running?.how ?? 'model') : undefined}
                            onOpen={file && (cell.kind === 'value' || cell.kind === 'answer' || cell.kind === 'found') ? () => setProof({ row, file, label: reviewColumnLabel(column), cell }) : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {proof ? <ReviewProof projectId={project.id} proof={proof} onClose={() => setProof(null)} /> : null}

      {open === 'add' ? (
        <AddColumn
          kind={kind}
          taken={table.columns.flatMap((column) => (column.kind === 'value' ? [column.key] : []))}
          busy={busy}
          onClose={() => setOpen(null)}
          onAdd={async (wanted) => {
            if (await change(() => reviewApi.addColumns(project.id, wanted), 'The column could not be added')) setOpen(null);
          }}
        />
      ) : null}

      {open === 'papers' ? (
        <ChoosePapers
          papers={papers}
          picked={choice.by === 'papers' ? choice.ids : chosen.map((row) => row.id)}
          onClose={() => setOpen(null)}
          onShow={(ids) => {
            show({ by: 'papers', ids });
            setOpen(null);
          }}
        />
      ) : null}

      {open === 'saved' ? (
        <Saved
          onePaper={onePaper}
          canSave={columns.length > 0}
          busy={busy}
          onClose={() => setOpen(null)}
          onRun={async (item) => {
            let next: ReviewRowChoice | undefined;
            const ok = await change(async () => {
              const out = await reviewApi.runSaved(project.id, item.id, onePaper?.id);
              next = out.show;
              return out;
            }, 'It could not be run');
            if (!ok) return;
            if (next) show(next);
            setOpen(null);
          }}
          onSaveColumns={() => {
            setOpen(null);
            setDraft({ name: '', ...(kind ? { paper: kind } : {}), columns: playbookColumnsOf(columns) });
          }}
        />
      ) : null}

      {draft ? <PlaybookEditor draft={draft} onClose={() => setDraft(null)} onSaved={() => setDraft(null)} /> : null}

      {columnOpen ? (
        <ColumnActions
          column={columnOpen}
          mayChange={mayChange && !running}
          busy={busy}
          onClose={() => setColumnOpen(null)}
          onAskAgain={async () => {
            if (await change(() => reviewApi.askAgain(project.id, columnOpen.id, rows.map((row) => row.id)), 'The answers could not be cleared')) setColumnOpen(null);
          }}
          onSave={async () => {
            if (columnOpen.kind !== 'question') return;
            try {
              await reviewApi.save({ kind: 'ask', question: columnOpen.question });
              toast('Question saved to the library', 'good');
              setColumnOpen(null);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'The question could not be saved', 'critical');
            }
          }}
          onRemove={async () => {
            if (await change(() => reviewApi.removeColumn(project.id, columnOpen.id), 'The column could not be removed')) setColumnOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One cell. A value or an answer is a button that opens its page. An empty
 * cell says why it is empty, in the quiet ink, and opens nothing.
 */
function CellView({ cell, wide, asking, onOpen }: { cell: ReviewCell; wide: boolean; asking?: 'model' | 'search'; onOpen?: () => void }) {
  if (cell.kind === 'off') {
    return (
      <span className="block px-3 py-2 text-[12px] text-ink-muted" title="Not for this kind of paper">
        <span aria-hidden>—</span>
        <span className="sr-only">Not for this kind of paper</span>
      </span>
    );
  }
  if (cell.kind === 'empty') {
    if (asking) {
      return (
        <span className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-provenance-ink">
          <Spinner size={12} className="text-provenance-ink" /> {asking === 'model' ? 'Asking' : 'Searching'}
        </span>
      );
    }
    return <span className="block px-3 py-2 text-[12px] text-ink-muted">{REVIEW_EMPTY_LABEL[cell.why]}</span>;
  }
  const text = cell.kind === 'value' ? cell.display : cell.kind === 'answer' ? cell.text : `“${cell.quote}”`;
  const body = (
    <>
      <span
        className={cn(
          'block text-[13px] leading-snug',
          wide ? 'line-clamp-4' : 'line-clamp-2',
          cell.kind === 'found' ? 'text-ink-secondary' : 'text-ink',
          cell.kind === 'value' && cell.standing === 'set_aside' && 'text-ink-muted line-through',
        )}
      >
        {text}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        {cell.kind === 'answer' || (cell.kind === 'value' && cell.aiRead) ? (
          <>
            <AiMark size="xs" />
            <span className="sr-only">AI-read</span>
          </>
        ) : null}
        {cell.page ? <span className="font-mono text-ink-muted">p.{cell.page}</span> : null}
        {cell.kind === 'value' ? <span className={cn('font-medium', standingClass(cell.standing))}>{REVIEW_STANDING_LABEL[cell.standing]}</span> : null}
        {cell.kind === 'answer' && cell.unverified ? <span className="font-medium text-[var(--status-warning-text)]">Unverified</span> : null}
        {cell.kind === 'answer' && cell.scanned && !cell.unverified ? <span className="text-ink-muted">From a scan</span> : null}
        {cell.kind === 'found' ? <span className="text-ink-muted">Search</span> : null}
      </span>
    </>
  );
  if (!onOpen) return <span className="block px-3 py-2">{body}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      // The words it rests on, under the pointer. Opening the cell shows them on the page.
      title={cell.kind !== 'found' && cell.quote ? `“${cell.quote}”` : undefined}
      className="block w-full px-3 py-2 text-left hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
    >
      {body}
    </button>
  );
}

function AddColumn({ kind, taken, busy, onClose, onAdd }: { kind?: string; taken: readonly string[]; busy: boolean; onClose: () => void; onAdd: (wanted: NewReviewColumn[]) => void }) {
  const [key, setKey] = useState('');
  const [question, setQuestion] = useState('');
  const asked = question.replace(/\s+/g, ' ').trim();
  const carried = kind ? reviewValueKeys(kind).filter((k) => k.carried && !taken.includes(k.key)) : [];
  const wanted: NewReviewColumn[] = [...(key ? [{ kind: 'value' as const, key }] : []), ...(asked.length >= 3 ? [{ kind: 'question' as const, question: asked, ...(kind ? { paper: kind } : {}) }] : [])];
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a column"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!wanted.length} onClick={() => onAdd(wanted)}>
            Add column
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="A listed value">
          <Select value={key} onChange={(e) => setKey(e.target.value)}>
            <ValueOptions paper={kind} taken={taken} />
          </Select>
        </Field>
        {carried.length > 1 ? (
          <button type="button" disabled={busy} onClick={() => onAdd(carried.map((k) => ({ kind: 'value', key: k.key })))} className="text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50">
            Add all {carried.length} listed values of this kind
          </button>
        ) : null}
        <Field label="A question" hint={kind ? `Asked of: ${kind}` : undefined}>
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Is there a right of way?" maxLength={REVIEW_QUESTION_MAX} />
        </Field>
      </div>
    </Modal>
  );
}

function ChoosePapers({ papers, picked, onClose, onShow }: { papers: EvidenceRecord[]; picked: readonly string[]; onClose: () => void; onShow: (ids: string[]) => void }) {
  const [ids, setIds] = useState<Set<string>>(new Set(picked));
  return (
    <Modal
      open
      onClose={onClose}
      title="Choose papers"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ids.size} onClick={() => onShow(papers.filter((row) => ids.has(row.id)).map((row) => row.id))}>
            Show {plural(ids.size, 'paper')}
          </Button>
        </>
      }
    >
      <ul className="-my-1 divide-y divide-hairline">
        {papers.map((row) => (
          <li key={row.id}>
            <Checkbox
              checked={ids.has(row.id)}
              onChange={(on) =>
                setIds((was) => {
                  const next = new Set(was);
                  if (on) next.add(row.id);
                  else next.delete(row.id);
                  return next;
                })
              }
              label={
                <>
                  <span className="block text-[13px] text-ink">{row.title}</span>
                  <span className="block text-[11px] text-ink-muted">{row.documentType ?? 'No kind yet'}</span>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** The workspace's saved asks and playbooks, to run on the papers in view. */
function Saved({
  onePaper,
  canSave,
  busy,
  onClose,
  onRun,
  onSaveColumns,
}: {
  onePaper?: EvidenceRecord;
  canSave: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (item: SavedReviewItem) => void;
  onSaveColumns: () => void;
}) {
  const [library, setLibrary] = useState<{ items: SavedReviewItem[]; mayAdd: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    reviewApi.library().then(
      (out) => live && setLibrary(out),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : 'The library could not be read'),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal
      open
      onClose={onClose}
      title={onePaper ? `Run on ${onePaper.title}` : 'Playbooks and saved asks'}
      footer={
        <>
          <Link to="/libraries" className="mr-auto text-[12px] font-medium text-brand">
            Open the library
          </Link>
          {canSave && library?.mayAdd ? <Button onClick={onSaveColumns}>Save these columns as a playbook</Button> : null}
        </>
      }
    >
      {failed ? (
        <p className="text-[13px] text-ink-secondary">{failed}</p>
      ) : !library ? (
        <Spinner />
      ) : !library.items.length ? (
        <p className="text-[13px] text-ink-secondary">Nothing saved yet. Save a question from its column, or a table’s columns as a playbook.</p>
      ) : (
        <ul className="-my-1 divide-y divide-hairline">
          {library.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{item.kind === 'playbook' ? item.name : item.question}</p>
                <p className="text-[11px] text-ink-muted">{item.kind === 'playbook' ? `${item.paper ?? 'Any paper'}, ${plural(item.columns.length, 'column')}` : 'Saved ask'}</p>
              </div>
              <Button size="sm" disabled={busy} onClick={() => onRun(item)}>
                Run
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ColumnActions({
  column,
  mayChange,
  busy,
  onClose,
  onAskAgain,
  onSave,
  onRemove,
}: {
  column: ReviewColumn;
  mayChange: boolean;
  busy: boolean;
  onClose: () => void;
  onAskAgain: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={column.kind === 'question' ? 'Question' : 'Listed value'} width="sm">
      <div className="space-y-3">
        <p className="text-[13px] text-ink">{reviewColumnLabel(column)}</p>
        {column.kind === 'question' ? <p className="text-[12px] text-ink-muted">Asked of: {column.paper ?? 'every paper'}</p> : null}
        {mayChange ? (
          <div className="flex flex-wrap gap-2">
            {column.kind === 'question' ? (
              <>
                <Button disabled={busy} onClick={onAskAgain}>
                  Ask again
                </Button>
                <Button disabled={busy} onClick={onSave}>
                  Save this question
                </Button>
              </>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={onRemove}>
              Remove column
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
