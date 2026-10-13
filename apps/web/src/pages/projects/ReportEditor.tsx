/**
 * The report, live.
 *
 * The design problem here is not "how do we make it editable" — it is how to
 * make it editable without it quietly becoming a second copy of the facts. A
 * DD report mixes two kinds of sentence: a reading of the registers ("14 open
 * findings, 3 critical") and somebody's judgement ("proceed subject to the DC
 * conversion order"). One text box gets the first wrong the moment anybody
 * types; wholesale regeneration gets the second wrong the moment anybody
 * regenerates.
 *
 * So the document is blocks, and a block is one of three things. The UI's
 * whole job is making which one obvious at a glance, without a legend:
 *
 * - **Live** — a coloured rail, a "live" chip, the row count, and no cursor.
 *   It re-renders from the project on every keystroke elsewhere, so setting a
 *   check non-compliant three panes away updates it while you watch.
 * - **Yours** — no rail, a text cursor, saves on blur.
 * - **Detached** — a dashed rail and a date. It used to be live and it says so,
 *   because a paragraph that reads like a register summary and silently
 *   stopped being one is the failure this whole design exists to avoid.
 *
 * A live block reads the registers or the fields (`report-fields.ts`). One
 * that reads fields prints each value with where it stands and a footnote
 * saying where it came from, and detached it is frozen as it read that day:
 * its values are not retyped. A person's own words are a note, capped, with
 * their name and the day under it.
 *
 * An issued report stops moving entirely and grows a "what changed since"
 * panel instead. That falls out of the freeze almost free and is the question
 * a person actually has three weeks after sending a pack.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '../../lib/useMe';
import { FieldBlockDialog, ReportChartView, ReportFootnotes } from '../../components/report/ReportFieldBlock';
import { ReportPhotos, ReportTableView } from '../../components/report/ReportTableView';
import { StationReportPhotos } from '../../components/report/StationReportPhotos';
import { TitleChainDiagram } from '../../components/charts';
import { Check, FileDown, GripVertical, Link2, Link2Off, Lock, Plus, Printer, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  engagementForReport,
  REPORT_BOUND_SOURCES,
  REPORT_KIND_LABEL,
  REPORT_SECTION_STATE_LABEL,
  REPORT_SOURCE_LABEL,
  REPORT_SOURCE_READS,
  isFieldSource,
  isFrozenFieldBlock,
  isLiveBlock,
  isStatusSource,
  readReportBlock,
  reportIsFrozen,
  reportNoteCap,
  titleGraphFromProject,
  type DdProject,
  type GeneratedReport,
  type ReportBlock,
  type ReportBoundSourceKind,
  type ReportDriftRow,
  type ReportSectionState,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { exportReportDocx } from '../../lib/report-export';
import { Badge, Button, Callout, Field, INTERACTIVE, InfoTip, Input, Modal, Select, SubmitButton, cn, useToast } from '../../components/ui/kit';
import { daySaid } from '@realytica/shared';
import { reportSummary } from '../../lib/report-summary';
import { countSaid } from '@realytica/shared';

interface Props {
  project: DdProject;
  report: GeneratedReport;
  /** Re-reads the project, which is what makes every live block update. */
  onChanged: () => void | Promise<void>;
  onOpenRecord?: (recordId: string) => void;
}

export function ReportEditor({ project, report, onChanged, onOpenRecord }: Props) {
  // Somebody working from a grant edits a report within their reach, and neither freezes a section nor issues it: those are the firm's.
  const outside = useMe()?.role === 'collaborator';
  const toast = useToast();
  const frozen = reportIsFrozen(report.status);
  const [busy, setBusy] = useState<string | null>(null);
  const [drift, setDrift] = useState<ReportDriftRow[] | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [addingFields, setAddingFields] = useState(false);
  const [signerName, setSignerName] = useState(engagementForReport(project, report.id)?.lead ?? '');
  const [signerRole, setSignerRole] = useState('');
  const approved = report.body.blocks.filter((b) => b.state === 'approved').length;
  const unapproved = report.body.blocks.length - approved;

  // The summary is recomputed on every render rather than read off the stored
  // report: it is the document's own reading of itself, and a stale one at the
  // top would undermine every live block below it.
  const summary = reportSummary(project, report);

  useEffect(() => {
    if (!frozen) {
      setDrift(null);
      return;
    }
    let alive = true;
    void api
      .reportDrift(project.id, report.id)
      .then((r) => alive && setDrift(r.rows))
      .catch(() => alive && setDrift([]));
    return () => {
      alive = false;
    };
  }, [frozen, project.id, project.updatedAt, report.id]);

  async function run(key: string, work: () => Promise<unknown>, note?: string) {
    setBusy(key);
    try {
      await work();
      await onChanged();
      if (note) toast(note, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That change could not be made', 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">{report.title}</h2>
          {summary ? <p className="mt-1 max-w-[70ch] text-[13px] text-ink-secondary">{summary}</p> : null}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          <Badge tone={frozen ? 'neutral' : 'good'}>{frozen ? report.status : 'live'}</Badge>
          <InfoTip label="Sections with a coloured rail read the registers or the fields and update as the project does. The rest are your notes. Detaching a live section stops it updating, and the report says so." />
          <Button
            variant="ghost"
            icon={<FileDown size={13} />}
            disabled={busy !== null}
            onClick={() =>
              void run('export', () => exportReportDocx(project, report), 'Word document downloaded')
            }
          >
            Word
          </Button>
          {/* A link, not a script that opens a window: a press always opens the print page, where a pop-up blocker would have eaten the window. */}
          <a
            href={`/projects/${project.id}/reports/${report.id}/print`}
            target="_blank"
            rel="noopener"
            className={cn('inline-flex h-9 select-none items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium text-ink-secondary hover:bg-sunken hover:text-ink coarse:min-h-11', INTERACTIVE)}
          >
            <Printer size={13} aria-hidden />
            Print or save as PDF
          </a>
          {/* Issuing a report is the firm's: somebody working from a grant is not shown a button the server refuses. */}
          {!frozen && !outside ? (
            <Button variant="primary" icon={<Lock size={13} />} disabled={busy !== null} onClick={() => setIssuing(true)}>
              Issue
            </Button>
          ) : null}
        </div>
      </header>

      {!frozen && report.body.blocks.length ? (
        <p className="text-[12px] text-ink-secondary">
          <span className="font-medium text-ink">{approved} of {report.body.blocks.length}</span> sections approved.
          {' '}Changing what a section says puts it back to drafted.
        </p>
      ) : null}

      {frozen && report.signedBy ? (
        <p className="text-[12px] text-ink-secondary">
          Signed by <span className="font-medium text-ink">{report.signedBy}</span>
          {report.signedRole ? `, ${report.signedRole}` : ''}
          {report.signedAt ? ` on ${daySaid(report.signedAt)}` : ''}.
        </p>
      ) : null}

      {frozen ? (
        <Callout tone="neutral" title={`Issued ${daySaid(report.signedAt ?? report.generatedAt)}`}>
          This is the report as issued. It will not change.
          {drift === null ? null : drift.length === 0 ? (
            <> Nothing in the registers has moved since.</>
          ) : (
            <> {countSaid(drift.length, 'section')} would read differently now:</>
          )}
        </Callout>
      ) : null}

      {frozen && drift && drift.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-hairline bg-sunken p-3">
          {drift.map((row) => (
            <div key={row.blockId} className="text-[13px]">
              <span className="font-medium text-ink">{row.heading}</span>{' '}
              <span className="text-ink-muted">
                {row.wasCount} → {row.nowCount}
              </span>
              {row.added.map((line) => (
                <div key={line} className="pl-3 text-[var(--status-good-text)]">+ {line}</div>
              ))}
              {row.removed.map((line) => (
                <div key={line} className="pl-3 text-ink-muted line-through">− {line}</div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {report.body.blocks.map((block, index) => (
          <BlockRow
            key={block.id}
            project={project}
            report={report}
            block={block}
            index={index}
            total={report.body.blocks.length}
            frozen={frozen}
            busy={busy === block.id}
            onOpenRecord={onOpenRecord}
            onRun={(work, note) => run(block.id, work, note)}
          />
        ))}
      </div>

      {!frozen ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" disabled={busy !== null} onClick={() => setAddingFields(true)}>
            <Plus size={13} /> Add fields
          </Button>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run('add', () => api.insertReportBlock(project.id, report.id, { heading: 'Note', text: '' }))}
          >
            <Plus size={13} /> Add a note
          </Button>
        </div>
      ) : null}

      {addingFields ? (
        <FieldBlockDialog
          open
          busy={busy !== null}
          onClose={() => setAddingFields(false)}
          onDone={(source, heading) =>
            void run(
              'add',
              async () => {
                await api.insertReportBlock(project.id, report.id, { heading, source });
                setAddingFields(false);
              },
              'Added. It reads the fields from now on.',
            )
          }
        />
      ) : null}

      <Modal
        open={issuing}
        onClose={() => setIssuing(false)}
        title="Issue and sign this report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssuing(false)}>Cancel</Button>
            <SubmitButton
              busy={busy === 'issue'}
              needs={signerName.trim() ? [] : ['Who signs it']}
              onClick={() =>
                void run(
                  'issue',
                  async () => {
                    await api.issueReport(project.id, report.id, { signerName: signerName.trim(), signerRole: signerRole.trim() || undefined });
                    setIssuing(false);
                  },
                  'Issued and signed. This report no longer changes.',
                )
              }
            >
              Issue and sign
            </SubmitButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            Live sections freeze as they read now. A later version is a new report.
          </p>
          {unapproved > 0 ? (
            <Callout tone="warning" title={`${unapproved} section${unapproved === 1 ? ' is' : 's are'} not approved`}>
              You can still issue it; the sign-off is yours.
            </Callout>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Signed by" required>
              <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Name, as you sign" />
            </Field>
            <Field label="Capacity">
              <Input value={signerRole} onChange={(e) => setSignerRole(e.target.value)} placeholder="e.g. Partner, Chartered Engineer" />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

const STATE_TONE: Record<ReportSectionState, 'neutral' | 'info' | 'good'> = {
  drafted: 'neutral',
  checked: 'info',
  approved: 'good',
};

/** Drafted, checked, approved: one click each, and who did it. */
function SectionState({
  block,
  frozen,
  busy,
  onSet,
}: {
  block: ReportBlock;
  frozen: boolean;
  busy: boolean;
  onSet: (state: ReportSectionState) => void;
}) {
  const current: ReportSectionState = block.state ?? 'drafted';
  const who = block.stateBy && block.state && block.state !== 'drafted'
    ? `${REPORT_SECTION_STATE_LABEL[current]} by ${block.stateBy}${block.stateAt ? ` on ${daySaid(block.stateAt)}` : ''}`
    : undefined;
  if (frozen) {
    return (
      <Badge tone={STATE_TONE[current]} title={who}>
        {REPORT_SECTION_STATE_LABEL[current]}
      </Badge>
    );
  }
  return (
    <div className="inline-flex items-center rounded-md bg-sunken p-0.5" role="group" aria-label="Section state" title={who}>
      {(['drafted', 'checked', 'approved'] as ReportSectionState[]).map((state) => (
        <button
          key={state}
          type="button"
          disabled={busy}
          aria-pressed={current === state}
          onClick={() => current !== state && onSet(state)}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] coarse:min-h-11',
            current === state
              ? state === 'approved'
                ? 'bg-[rgb(var(--status-good-rgb)/0.15)] font-semibold text-ink'
                : 'bg-surface font-semibold text-ink shadow-card'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {current === state && state === 'approved' ? <Check size={11} /> : null}
          {REPORT_SECTION_STATE_LABEL[state]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface RowProps {
  project: DdProject;
  report: GeneratedReport;
  block: ReportBlock;
  index: number;
  total: number;
  frozen: boolean;
  busy: boolean;
  onOpenRecord?: (recordId: string) => void;
  onRun: (work: () => Promise<unknown>, note?: string) => void;
}

function BlockRow({ project, report, block, index, total, frozen, busy, onOpenRecord, onRun }: RowProps) {
  const outside = useMe()?.role === 'collaborator';
  const live = isLiveBlock(block);
  const reads = isFieldSource(block.source?.kind);
  // A block detached from fields keeps its table as it stood, and is shown, not typed into.
  const held = isFrozenFieldBlock(block);
  const [choosing, setChoosing] = useState(false);
  const resolved = useMemo(() => readReportBlock(project, block, frozen), [project, block, frozen]);
  const titleGraph = useMemo(
    () => (live && block.source?.kind === 'title_chain' ? titleGraphFromProject(project) : null),
    [live, block.source?.kind, project],
  );
  const label = block.heading ?? (block.source ? REPORT_SOURCE_LABEL[block.source.kind] : 'Untitled');

  return (
    <section
      className={cn(
        'group relative rounded-lg border border-hairline bg-surface p-3 pl-4 transition-colors',
        live && 'border-l-[3px] border-l-brand',
        block.detachedAt && 'border-l-[3px] border-l-transparent [border-left-style:dashed] border-l-axis',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <HeadingField
          value={label}
          disabled={frozen || busy}
          onCommit={(heading) => {
            if (heading === label) return;
            onRun(() => api.editReportBlock(project.id, report.id, block.id, { heading }));
          }}
        />
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            live · {resolved.lines.length}
          </span>
        ) : block.detachedAt ? (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-muted">
            {held ? 'frozen' : 'detached'} from {block.detachedFrom ? REPORT_SOURCE_LABEL[block.detachedFrom].toLowerCase() : 'the registers'} on{' '}
            {daySaid(block.detachedAt)}, no longer updates
          </span>
        ) : (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-muted">a note</span>
        )}
        <SectionState
          block={block}
          frozen={frozen}
          busy={busy}
          onSet={(state) => onRun(() => api.setReportSectionState(project.id, report.id, block.id, state))}
        />

        {!frozen ? (
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {index > 0 ? (
              <IconBtn title="Move up" disabled={busy} onClick={() => onRun(() => api.moveReportBlock(project.id, report.id, block.id, index - 1))}>
                <GripVertical size={13} className="-rotate-90" />
              </IconBtn>
            ) : null}
            {index < total - 1 ? (
              <IconBtn title="Move down" disabled={busy} onClick={() => onRun(() => api.moveReportBlock(project.id, report.id, block.id, index + 1))}>
                <GripVertical size={13} className="rotate-90" />
              </IconBtn>
            ) : null}
            {live && !outside ? (
              <IconBtn
                title={reads ? 'Freeze: keep what the fields say today. It stops updating, and is marked with the day.' : 'Detach: keep what it says now and edit it. It stops updating.'}
                disabled={busy}
                onClick={() => onRun(() => api.detachReportBlock(project.id, report.id, block.id), reads ? 'Frozen as it reads today' : 'Detached — this section is yours now')}
              >
                <Link2Off size={13} />
              </IconBtn>
            ) : null}
            {block.detachedFrom ? (
              <IconBtn
                title={held ? 'Put it back on the fields. It reads them as they are now.' : 'Put it back on the registers. What you typed here is discarded.'}
                disabled={busy}
                onClick={() => {
                  if (!confirm(held ? 'Put this section back on the fields? It will read them as they are now.' : 'Reattach this section? What you typed here is discarded and it reads the registers again.')) return;
                  onRun(() => api.reattachReportBlock(project.id, report.id, block.id), held ? 'Reading the fields again' : 'Reading the registers again');
                }}
              >
                <Link2 size={13} />
              </IconBtn>
            ) : null}
            <IconBtn
              title="Remove from the report. Nothing in the registers changes."
              disabled={busy}
              onClick={() => {
                if (!confirm(`Remove “${label}” from the report? Nothing in the registers changes.`)) return;
                onRun(() => api.removeReportBlock(project.id, report.id, block.id));
              }}
            >
              <Trash2 size={13} />
            </IconBtn>
          </div>
        ) : null}
      </div>

      {live ? (
        <>
          {!frozen ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {reads ? (
                <Button variant="ghost" icon={<SlidersHorizontal size={13} />} disabled={busy} onClick={() => setChoosing(true)}>
                  Choose fields
                </Button>
              ) : (
              <Select
                aria-label="What this section reads"
                className="!py-1 text-[12px]"
                value={block.source!.kind}
                disabled={busy}
                onChange={(e) =>
                  onRun(() =>
                    api.retuneReportBlock(project.id, report.id, block.id, {
                      ...block.source!,
                      kind: e.target.value as ReportBoundSourceKind,
                    }),
                  )
                }
              >
                {/* A section that reads fields is given its fields in the dialog, not by this list. */}
                {REPORT_BOUND_SOURCES.filter((kind) => !isFieldSource(kind)).map((kind) => (
                  <option key={kind} value={kind}>
                    {REPORT_SOURCE_LABEL[kind]}
                  </option>
                ))}
              </Select>
              )}
              {reads ? null : isStatusSource(block.source!.kind) ? (
                // A status section has nothing to narrow. What it can be is plain: as code wrote it, with no model's wording over it.
                block.wording?.length ? (
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={block.source!.plain === true}
                      disabled={busy}
                      onChange={(e) => onRun(() => api.retuneReportBlock(project.id, report.id, block.id, { ...block.source!, plain: e.target.checked }))}
                    />
                    plain words
                  </label>
                ) : null
              ) : (
                <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={block.source!.materialOnly === true}
                    disabled={busy}
                    onChange={(e) => onRun(() => api.retuneReportBlock(project.id, report.id, block.id, { ...block.source!, materialOnly: e.target.checked }))}
                  />
                  material only
                </label>
              )}
              <span className="text-[12px] text-ink-muted">{REPORT_SOURCE_READS[block.source!.kind]}</span>
            </div>
          ) : null}
          {titleGraph && titleGraph.nodes.length > 0 ? (
            <div className="mb-3 overflow-x-auto rounded-lg bg-page/50 ring-1 ring-inset ring-hairline">
              <TitleChainDiagram graph={titleGraph} summary={project.lastScreenResult?.titleGraph} />
            </div>
          ) : null}
          {titleGraph && titleGraph.nodes.length > 0 ? (
            resolved.note ? <p className="mt-1.5 text-[12px] text-ink-muted">{resolved.note}</p> : null
          ) : resolved.lines.length === 0 ? (
            <p className="text-[13px] italic text-ink-muted">
              {resolved.note ?? 'Nothing in the registers matches this section yet. It will fill in as the project does — it is not printing “none found”.'}
            </p>
          ) : resolved.table ? (
            <>
              {resolved.chart ? <ReportChartView chart={resolved.chart} /> : null}
              <ReportTableView table={resolved.table} onOpenRecord={onOpenRecord} />
              {reads && resolved.note ? <p className="mt-1.5 text-[12px] text-ink-muted">{resolved.note}</p> : null}
              <ReportFootnotes footnotes={resolved.footnotes} />
              {block.source?.kind === 'station_photographs' ? <StationReportPhotos project={project} table={resolved.table} /> : <ReportPhotos project={project} table={resolved.table} />}
            </>
          ) : (
            <>
              <ul className="space-y-1">
                {resolved.lines.map((line, i) => {
                  const recordId = resolved.recordIds[i];
                  return (
                    <li key={`${block.id}-${i}`} className="text-[13px] text-ink-secondary">
                      {recordId && onOpenRecord ? (
                        <button type="button" className="text-left hover:text-brand hover:underline" onClick={() => onOpenRecord(recordId)}>
                          {line}
                        </button>
                      ) : (
                        line
                      )}
                    </li>
                  );
                })}
              </ul>
              {resolved.note ? <p className="mt-1.5 text-[12px] text-ink-muted">{resolved.note}</p> : null}
              <ReportFootnotes footnotes={resolved.footnotes} />
            </>
          )}
          {choosing ? (
            <FieldBlockDialog
              open
              initial={block.source}
              busy={busy}
              onClose={() => setChoosing(false)}
              onDone={(source) => {
                setChoosing(false);
                onRun(() => api.retuneReportBlock(project.id, report.id, block.id, source), 'Changed what it reads');
              }}
            />
          ) : null}
        </>
      ) : held ? (
        <>
          {resolved.chart ? <ReportChartView chart={resolved.chart} /> : null}
          {resolved.table ? (
            <ReportTableView table={resolved.table} />
          ) : (
            <ul className="space-y-1">
              {resolved.lines.map((line, i) => (
                <li key={`${block.id}-${i}`} className="text-[13px] text-ink-secondary">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {resolved.note ? <p className="mt-1.5 text-[12px] text-ink-muted">{resolved.note}</p> : null}
          <ReportFootnotes footnotes={resolved.footnotes} />
        </>
      ) : (
        <ProseField
          value={block.text ?? ''}
          disabled={frozen || busy}
          // A note is capped; what the registers said the day a section was detached is as long as it was.
          cap={block.detachedAt ? undefined : reportNoteCap(block)}
          hint={block.hint}
          by={block.detachedAt ? undefined : block.editedBy}
          at={block.detachedAt ? undefined : block.editedAt}
          onCommit={(text) => {
            if (text === (block.text ?? '')) return;
            onRun(() => api.editReportBlock(project.id, report.id, block.id, { text }));
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function IconBtn({ children, title, disabled, onClick }: { children: React.ReactNode; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      /*
        21px on a touch pointer, for the controls that reorder a report and
        remove blocks from it. Small is the right look on a desktop — these
        are quiet until you want them — but a control that removes a section
        of a report has to be hittable on the first try.
      */
      className="grid place-items-center rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40 coarse:min-h-11 coarse:min-w-11"
    >
      {children}
    </button>
  );
}

/**
 * A field that keeps what you are typing while the project reloads underneath.
 *
 * Every save re-reads the project so the live blocks update, which re-renders
 * this component — so a naively controlled field would fight the person's
 * cursor. Local state owns the value while focused; the prop wins only when
 * the field is idle and the value actually changed elsewhere.
 */
function useDraft(value: string, focused: boolean): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (focused) return;
    if (value === last.current) return;
    last.current = value;
    setDraft(value);
  }, [value, focused]);
  return [draft, setDraft];
}

function HeadingField({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useDraft(value, focused);
  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      aria-label="Section heading"
      className="-ml-1 min-w-[12rem] flex-1 rounded bg-transparent px-1 py-0.5 text-[14px] font-semibold tracking-tight text-ink outline-none hover:bg-sunken focus:bg-sunken disabled:hover:bg-transparent"
    />
  );
}

function ProseField({
  value,
  disabled,
  cap,
  hint,
  by,
  at,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  /** The most characters the note may hold. */
  cap?: number;
  /** What the note is for, as the template that placed it says. */
  hint?: string;
  /** Who last wrote it, and when. */
  by?: string;
  at?: string;
  onCommit: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useDraft(value, focused);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow to the text rather than scrolling inside a fixed box: a report reads
  // as a document, and a paragraph you have to scroll inside does not.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <>
      <textarea
        ref={ref}
        value={draft}
        disabled={disabled}
        rows={1}
        maxLength={cap}
        aria-label="Note"
        placeholder={disabled ? '' : (hint ?? 'Your words. Nothing regenerates this.')}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onCommit(draft);
        }}
        className="w-full resize-none rounded bg-transparent px-1 py-0.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-muted hover:bg-sunken focus:bg-sunken disabled:hover:bg-transparent"
      />
      {(by && value.trim()) || (cap && focused) ? (
        <p className="mt-1 flex flex-wrap justify-between gap-x-3 px-1 text-[11px] text-ink-muted">
          <span>{by && value.trim() ? `Written by ${by}${at ? ` on ${daySaid(at)}` : ''}` : ''}</span>
          {cap && focused ? (
            <span className="font-mono tabular-nums">
              {draft.length.toLocaleString('en-IN')} of {cap.toLocaleString('en-IN')}
            </span>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

export { REPORT_KIND_LABEL };
