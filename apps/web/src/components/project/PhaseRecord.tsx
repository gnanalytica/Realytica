import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CHECK_RESULT_LABEL, phaseCount, phaseRecord, type DdProject, type PhaseItem, type PhaseRef } from '@realytica/shared';
import { Card, CardBody, CardHeader, cn } from '../ui/kit';

function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type PhaseOpen = (kind: 'document' | 'assessment' | 'check' | 'finding' | 'risk' | 'action' | 'decision' | 'report', id: string) => void;

const SHOWN = 5;

function Section({
  title,
  items,
  kind,
  onOpen,
  note,
}: {
  title: string;
  items: PhaseItem[];
  kind: Parameters<PhaseOpen>[0];
  onOpen: PhaseOpen;
  note?: (item: PhaseItem) => string | undefined;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section className="min-w-0">
      <h4 className="mb-1 flex items-baseline gap-1.5 text-[12px] font-semibold text-ink">
        {title}
        <span className="font-mono text-micro font-normal text-ink-muted">{items.length}</span>
      </h4>
      <ul className="space-y-0.5">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(kind, item.id)}
              className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sunken coarse:min-h-11"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={item.title}>{item.title}</span>
              {/* A note never squeezes the title: it gives way first. */}
              {note?.(item) ? (
                <span className="min-w-0 max-w-[40%] shrink truncate text-micro text-ink-secondary" title={note(item)}>
                  {note(item)}
                </span>
              ) : null}
              <span className="shrink-0 font-mono text-micro text-ink-muted">{monthDay(item.at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-0.5 px-1.5 text-[12px] text-brand hover:underline">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * What was done in one phase of the project: the documents filed, DDs
 * started, checks recorded and what they raised, each a way back to it.
 * Nothing here is hidden anywhere else — every record stays on the file in
 * every phase — this is the same file, read by phase.
 */
export function PhaseRecordCard({
  project,
  phase,
  onOpen,
  onClose,
}: {
  project: DdProject;
  phase: PhaseRef;
  onOpen: PhaseOpen;
  /** Where the card is something to put away: in a sheet. As a section of a page it stays. */
  onClose?: () => void;
}) {
  const record = useMemo(() => phaseRecord(project, phase), [project, phase]);
  const count = phaseCount(record);
  const spans = record.spans
    .map((s) => `${monthDay(s.from)} – ${s.to ? monthDay(s.to) : 'now'}`)
    .join(' · ');
  return (
    <Card className="animate-rise-in">
      <CardHeader
        // The name alone: "In Completed" and "In Under construction" do not read.
        title={record.label}
        subtitle={spans || 'The project has not been here yet.'}
        action={
          onClose ? (
            <button type="button" onClick={onClose} aria-label="Close the phase" className="rounded-lg p-1.5 text-ink-muted hover:bg-sunken hover:text-ink">
              <X size={15} />
            </button>
          ) : undefined
        }
      />
      <CardBody>
        {count === 0 ? (
          <p className="text-[13px] text-ink-secondary">Nothing was filed, started or recorded while the project was here.</p>
        ) : (
          <div className={cn('grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]')}>
            <Section title="Documents filed" items={record.documents} kind="document" onOpen={onOpen} />
            <Section title="DDs started" items={record.assessments} kind="assessment" onOpen={onOpen} />
            <Section
              title="Checks recorded"
              items={record.checks}
              kind="check"
              onOpen={onOpen}
              note={(i) => {
                const check = record.checks.find((c) => c.id === i.id);
                return check ? CHECK_RESULT_LABEL[check.result] : undefined;
              }}
            />
            <Section title="Findings raised" items={record.findings} kind="finding" onOpen={onOpen} note={(i) => i.detail} />
            <Section title="Risks logged" items={record.risks} kind="risk" onOpen={onOpen} />
            <Section title="Actions opened" items={record.actions} kind="action" onOpen={onOpen} />
            <Section title="Decisions" items={record.decisions} kind="decision" onOpen={onOpen} />
            <Section title="Reports" items={record.reports} kind="report" onOpen={onOpen} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
