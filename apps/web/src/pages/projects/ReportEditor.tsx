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
 * An issued report stops moving entirely and grows a "what changed since"
 * panel instead. That falls out of the freeze almost free and is the question
 * a person actually has three weeks after sending a pack.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Link2, Link2Off, Lock, Plus, Trash2 } from 'lucide-react';
import {
  REPORT_BOUND_SOURCES,
  REPORT_KIND_LABEL,
  REPORT_SOURCE_LABEL,
  REPORT_SOURCE_READS,
  isLiveBlock,
  readReportBlock,
  reportIsFrozen,
  reportSummaryLine,
  type DdProject,
  type GeneratedReport,
  type ReportBlock,
  type ReportBoundSourceKind,
  type ReportDriftRow,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Callout, Select, cn, useToast } from '../../components/ui/kit';

interface Props {
  project: DdProject;
  report: GeneratedReport;
  /** Re-reads the project, which is what makes every live block update. */
  onChanged: () => void | Promise<void>;
  onOpenRecord?: (recordId: string) => void;
}

export function ReportEditor({ project, report, onChanged, onOpenRecord }: Props) {
  const toast = useToast();
  const frozen = reportIsFrozen(report.status);
  const [busy, setBusy] = useState<string | null>(null);
  const [drift, setDrift] = useState<ReportDriftRow[] | null>(null);

  // The summary is recomputed on every render rather than read off the stored
  // report: it is the document's own reading of itself, and a stale one at the
  // top would undermine every live block below it.
  const summary = frozen ? report.body.summary : reportSummaryLine(project);

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
          <p className="mt-1 max-w-[70ch] text-[12.5px] text-ink-secondary">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={frozen ? 'neutral' : 'good'}>{frozen ? report.status : 'live'}</Badge>
          {!frozen ? (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm('Issue this report? Every live section freezes at what it says now, and the document stops changing. A later version is a new report.')) return;
                void run('issue', () => api.issueReport(project.id, report.id), 'Issued — this report no longer moves');
              }}
            >
              <Lock size={13} /> Issue
            </Button>
          ) : null}
        </div>
      </header>

      {frozen ? (
        <Callout tone="neutral" title={`Issued ${new Date(report.generatedAt).toLocaleDateString()}`}>
          This is what the report said when it was issued, and it will not change again — somebody is holding this version.
          {drift === null ? null : drift.length === 0 ? (
            <> Nothing in the registers has moved since.</>
          ) : (
            <> {drift.length} section(s) would read differently now:</>
          )}
        </Callout>
      ) : null}

      {frozen && drift && drift.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-hairline bg-sunken p-3">
          {drift.map((row) => (
            <div key={row.blockId} className="text-[12.5px]">
              <span className="font-medium text-ink">{row.heading}</span>{' '}
              <span className="text-ink-muted">
                {row.wasCount} → {row.nowCount}
              </span>
              {row.added.map((line) => (
                <div key={line} className="pl-3 text-status-good-text">+ {line}</div>
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
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void run('add', () => api.insertReportBlock(project.id, report.id, { heading: 'New section', text: '' }))}
        >
          <Plus size={13} /> Add a paragraph
        </Button>
      ) : null}
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
  const live = isLiveBlock(block);
  const resolved = useMemo(() => readReportBlock(project, block, frozen), [project, block, frozen]);
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-medium text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            live · {resolved.lines.length}
          </span>
        ) : block.detachedAt ? (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[10.5px] text-ink-muted">
            detached from {block.detachedFrom ? REPORT_SOURCE_LABEL[block.detachedFrom] : 'the registers'} on{' '}
            {new Date(block.detachedAt).toLocaleDateString()} — no longer updates
          </span>
        ) : (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[10.5px] text-ink-muted">your words</span>
        )}

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
            {live ? (
              <IconBtn
                title="Detach — keep what it says now, and edit it yourself. It will stop updating, and the report will say so."
                disabled={busy}
                onClick={() => onRun(() => api.detachReportBlock(project.id, report.id, block.id), 'Detached — this section is yours now')}
              >
                <Link2Off size={13} />
              </IconBtn>
            ) : null}
            {block.detachedFrom ? (
              <IconBtn
                title="Put it back on the registers. What you typed here is discarded."
                disabled={busy}
                onClick={() => {
                  if (!confirm('Reattach this section? What you typed here is discarded and it reads the registers again.')) return;
                  onRun(() => api.reattachReportBlock(project.id, report.id, block.id), 'Reading the registers again');
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
                {REPORT_BOUND_SOURCES.map((kind) => (
                  <option key={kind} value={kind}>
                    {REPORT_SOURCE_LABEL[kind]}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                <input
                  type="checkbox"
                  checked={block.source!.materialOnly === true}
                  disabled={busy}
                  onChange={(e) => onRun(() => api.retuneReportBlock(project.id, report.id, block.id, { ...block.source!, materialOnly: e.target.checked }))}
                />
                material only
              </label>
              <span className="text-[11.5px] text-ink-muted">{REPORT_SOURCE_READS[block.source!.kind]}</span>
            </div>
          ) : null}
          {resolved.lines.length === 0 ? (
            <p className="text-[13px] italic text-ink-muted">
              {resolved.note ?? 'Nothing in the registers matches this section yet. It will fill in as the file does — it is not printing “none found”.'}
            </p>
          ) : (
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
          )}
          {resolved.note && resolved.lines.length > 0 ? <p className="mt-1.5 text-[11.5px] text-ink-muted">{resolved.note}</p> : null}
        </>
      ) : (
        <ProseField
          value={block.text ?? ''}
          disabled={frozen || busy}
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
      className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
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
      className="-ml-1 min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[13.5px] font-semibold tracking-tight text-ink outline-none hover:bg-sunken focus:bg-sunken disabled:hover:bg-transparent"
    />
  );
}

function ProseField({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
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
    <textarea
      ref={ref}
      value={draft}
      disabled={disabled}
      rows={1}
      placeholder={disabled ? '' : 'Your words. Nothing regenerates this.'}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onCommit(draft);
      }}
      className="w-full resize-none rounded bg-transparent px-1 py-0.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-muted hover:bg-sunken focus:bg-sunken disabled:hover:bg-transparent"
    />
  );
}

export { REPORT_KIND_LABEL };
