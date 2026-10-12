/**
 * A function's sheets: what needs a person first, then the sheets themselves.
 *
 * The page does not open on a form. It opens on what waits for somebody, in
 * the order a person takes it: values offered and not yet accepted, grouped
 * by the paper they came off; situations a paper suggests; disputes; what is
 * still empty; what a rule says. On a phone that list is the screen, and
 * each line is one press.
 *
 * The sheets follow, a section at a time. A field that its situation does
 * not bring into play is not drawn. Expert fields sit folded under "More"
 * until asked for or until one holds a value. What is recorded under a
 * situation since taken out of play is kept, under its own fold.
 *
 * Everything shown is read off the project in hand (`readFunctionFields`), so
 * a save's answer redraws the page with no second request.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, ListChecks, Plus } from 'lucide-react';
import {
  NA_REASONS,
  NA_REASON_LABEL,
  departmentRole,
  fieldCatalog,
  readFunctionFields,
  refChoices,
  roleCanDecide,
  roleCanEdit,
  workstreamDefinition,
  type CheckFieldDef,
  type CheckFieldWrite,
  type DdProject,
  type DepartmentKey,
  type FieldException,
  type FieldSet,
  type FieldValueDecision,
  type FieldView,
  type RefTarget,
  type SheetReading,
  type SituationView,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { CheckFields } from '../CheckFields';
import { AiMark, Badge, Button, Card, CardBody, CardHeader, Modal, cn, useToast } from '../ui/kit';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

interface Props {
  project: DdProject;
  fn: string;
  onChanged: (project: DdProject) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
}

/** What the person on this page may do in the function's department. */
function useSeat(project: DdProject, fn: string): { mayEdit: boolean; mayDecide: boolean } {
  const me = useMe();
  const department = workstreamDefinition(fn)?.department as DepartmentKey | undefined;
  const role = me && department ? departmentRole(project, { email: me.email, workspaceRole: me.role }, department) : undefined;
  return { mayEdit: roleCanEdit(role), mayDecide: roleCanDecide(role) };
}

export function FieldSheets({ project, fn, onChanged, onOpenPaper }: Props) {
  const toast = useToast();
  const seat = useSeat(project, fn);
  const page = useMemo(() => readFunctionFields(project, fn), [project, fn]);
  const [openRecord, setOpenRecord] = useState<{ set: string; record: string } | null>(null);
  const choices = useMemo(() => {
    const catalog = fieldCatalog();
    return (target: RefTarget | undefined) => refChoices(project, target, catalog);
  }, [project]);

  const run = (work: () => Promise<{ project: DdProject }>, failed: string) => {
    void work()
      .then((out) => onChanged(out.project))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : failed, 'critical'));
  };

  const sheetProps = (reading: SheetReading) => ({
    evidence: project.evidence,
    disabled: !seat.mayEdit,
    choices,
    onOpenPaper,
    onCommit: (values: Record<string, CheckFieldWrite>) => run(() => api.setFieldValues(project.id, { set: reading.set.id, record: reading.recordId, values }), 'That value could not be saved'),
    onDecide: seat.mayEdit
      ? (def: CheckFieldDef, decision: FieldValueDecision, input?: { value?: unknown; pick?: number; reason?: string }) =>
          run(() => api.decideField(project.id, { address: { fn, set: reading.set.id, field: def.key, ...(reading.recordId ? { record: reading.recordId } : {}) }, decision, ...input }), 'That could not be decided')
      : undefined,
  });

  const opened = openRecord ? [...page.sheets, ...page.shared].flatMap((sheet) => sheet.records ?? []).find((r) => r.set.id === openRecord.set && r.recordId === openRecord.record) : undefined;

  return (
    <div className="space-y-4">
      <NeedsYou
        page={page}
        mayDecide={seat.mayDecide}
        onAccept={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: 'accept', ...(exception.pick !== undefined ? { pick: exception.pick } : {}) }), 'That could not be accepted')}
        onSetAside={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: exception.pick !== undefined ? 'keep' : 'set_aside' }), 'That could not be set aside')}
        onAcceptPaper={(evidenceId) => run(() => api.acceptPaperFields(project.id, fn, evidenceId), 'Those could not be accepted')}
        onSituation={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')}
        onOpenPaper={onOpenPaper}
        onOpenRecord={(set, record) => setOpenRecord({ set, record })}
      />

      {page.situations.length ? <Situations situations={page.situations} mayDecide={seat.mayDecide} onSet={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')} /> : null}

      {page.sheets.map((sheet) =>
        sheet.reading ? (
          <Sheet key={sheet.set.id} reading={sheet.reading} mayDecide={seat.mayDecide} props={sheetProps(sheet.reading)} onSection={(section, reason) => run(() => api.setSectionNotApplicable(project.id, sheet.set.id, section, reason), 'That could not be marked')} />
        ) : (
          <Records
            key={sheet.set.id}
            set={sheet.set}
            records={sheet.records ?? []}
            mayEdit={seat.mayEdit}
            onOpen={(record) => setOpenRecord({ set: sheet.set.id, record })}
            onAdd={() =>
              void api
                .addFieldRecord(project.id, sheet.set.id)
                .then((out) => {
                  onChanged(out.project);
                  if (out.recordId) setOpenRecord({ set: sheet.set.id, record: out.recordId });
                })
                .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That could not be added', 'critical'))
            }
          />
        ),
      )}

      {page.shared.map((shared) => (
        <Records
          key={shared.set.id}
          set={shared.set}
          records={shared.records}
          mayEdit={seat.mayEdit}
          quiet
          onOpen={(record) => setOpenRecord({ set: shared.set.id, record })}
          onAdd={() =>
            void api
              .addFieldRecord(project.id, shared.set.id)
              .then((out) => {
                onChanged(out.project);
                if (out.recordId) setOpenRecord({ set: shared.set.id, record: out.recordId });
              })
              .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That could not be added', 'critical'))
          }
        />
      ))}

      {/* One record, as a small sheet of its own: a dialog on a laptop, a sheet from the bottom on a phone. */}
      <Modal
        open={Boolean(opened)}
        onClose={() => setOpenRecord(null)}
        title={opened?.title ?? ''}
        width="md"
        footer={
          opened && seat.mayDecide ? (
            <Button
              variant="ghost"
              onClick={() => {
                run(() => api.removeFieldRecord(project.id, opened.set.id, opened.recordId!), 'That could not be taken off');
                setOpenRecord(null);
              }}
            >
              Take off the list
            </Button>
          ) : undefined
        }
      >
        {opened ? <SheetBody reading={opened} props={sheetProps(opened)} /> : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What needs a person                                                   */
/* ------------------------------------------------------------------ */

const KIND_SAID: Record<FieldException['kind'], string> = {
  proposed: 'To accept',
  situation: 'To decide',
  disputed: 'Disputed',
  missing: 'Still empty',
  unmatched: 'No match',
  rule: 'Rules',
};

function NeedsYou({
  page,
  mayDecide,
  onAccept,
  onSetAside,
  onAcceptPaper,
  onSituation,
  onOpenPaper,
  onOpenRecord,
}: {
  page: ReturnType<typeof readFunctionFields>;
  mayDecide: boolean;
  onAccept: (exception: FieldException) => void;
  onSetAside: (exception: FieldException) => void;
  onAcceptPaper: (evidenceId: string) => void;
  onSituation: (key: string, on: boolean) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
  onOpenRecord: (set: string, record: string) => void;
}) {
  const { exceptions, counts } = page;
  const kinds = (['proposed', 'situation', 'disputed', 'missing', 'unmatched', 'rule'] as const).filter((kind) => counts[kind] > 0);
  // The values one paper offered, together: accepting a paper is the cheapest act with the largest effect.
  const papers = new Map<string, { label: string; all: number; plain: number }>();
  for (const exception of exceptions) {
    if (exception.kind !== 'proposed' || !exception.source?.evidenceId) continue;
    const held = papers.get(exception.source.evidenceId) ?? { label: exception.source.label, all: 0, plain: 0 };
    papers.set(exception.source.evidenceId, { ...held, all: held.all + 1, plain: held.plain + (exception.oneAtATime ? 0 : 1) });
  }
  const subtitle = counts.total ? kinds.map((kind) => `${counts[kind]} ${KIND_SAID[kind].toLowerCase()}`).join(' · ') : `Nothing needs you. ${page.recorded} of ${page.expected} recorded.`;

  return (
    <Card>
      <CardHeader icon={<ListChecks size={15} />} title="Needs you" subtitle={subtitle} />
      {counts.total || page.assumed ? (
        <CardBody className="space-y-3">
          {mayDecide
            ? [...papers.entries()]
                .filter(([, paper]) => paper.plain > 1)
                .map(([evidenceId, paper]) => (
                  <div key={evidenceId} className="flex flex-wrap items-center gap-2 rounded-lg border border-ai/40 bg-ai/5 px-3 py-2">
                    <AiMark size="xs" />
                    <p className="min-w-0 flex-1 text-[13px] text-ink">
                      {plural(paper.plain, 'value')} from {paper.label}
                    </p>
                    <Button size="sm" variant="primary" onClick={() => onAcceptPaper(evidenceId)}>
                      Accept all {paper.plain}
                    </Button>
                  </div>
                ))
            : null}
          {kinds.map((kind) => (
            <section key={kind}>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                {KIND_SAID[kind]} <span className="font-mono font-normal">{counts[kind]}</span>
              </h4>
              <ul className="mt-1 divide-y divide-hairline">
                {exceptions
                  .filter((exception) => exception.kind === kind)
                  .map((exception, index) => (
                    <li key={`${kind}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-ink">
                          {exception.label}
                          {exception.kind === 'proposed' || exception.kind === 'disputed' ? <span className="font-mono text-ink-secondary"> {exception.text}</span> : null}
                        </p>
                        <p className="text-[12px] leading-snug text-ink-muted">
                          {exception.sheet}
                          {exception.kind !== 'proposed' && exception.kind !== 'disputed' && exception.text ? `${exception.sheet ? ' · ' : ''}${exception.text}` : ''}
                          {exception.source ? (
                            <>
                              {' · '}
                              {exception.source.evidenceId && onOpenPaper ? (
                                <button type="button" className="font-medium text-brand hover:underline" onClick={() => onOpenPaper(exception.source!.evidenceId!, exception.source!.page)}>
                                  {exception.source.label}
                                  {exception.source.page ? `, p. ${exception.source.page}` : ''}
                                </button>
                              ) : (
                                <span>
                                  {exception.source.label}
                                  {exception.source.asOf ? `, read ${exception.source.asOf.slice(0, 10)}` : ''}
                                </span>
                              )}
                            </>
                          ) : null}
                        </p>
                        {exception.source?.quote && exception.kind === 'proposed' ? <p className="text-[12px] leading-snug text-ink-muted">“{exception.source.quote}”</p> : null}
                      </div>
                      {exception.tone && exception.kind === 'rule' ? <Badge tone={exception.tone === 'info' ? 'neutral' : exception.tone}>{exception.tone === 'critical' ? 'failing' : 'watch'}</Badge> : null}
                      {exception.kind === 'proposed' && mayDecide ? (
                        <span className="flex gap-1.5">
                          <Button size="sm" variant="primary" onClick={() => onAccept(exception)}>
                            Accept
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onSetAside(exception)}>
                            Not this
                          </Button>
                        </span>
                      ) : null}
                      {exception.kind === 'situation' && mayDecide ? (
                        <span className="flex gap-1.5">
                          <Button size="sm" variant="primary" onClick={() => onSituation(exception.situation!.split(':').pop()!, true)}>
                            Yes
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onSituation(exception.situation!.split(':').pop()!, false)}>
                            No
                          </Button>
                        </span>
                      ) : null}
                      {exception.record && exception.address && exception.kind !== 'proposed' ? (
                        <Button size="sm" variant="ghost" onClick={() => onOpenRecord(exception.address!.set, exception.record!)}>
                          Open
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {page.assumed ? <p className="text-[12px] text-ink-muted">{plural(page.assumed, 'usual value')} in use.</p> : null}
        </CardBody>
      ) : null}
    </Card>
  );
}

/** The situations a function answers to: the ones in play as chips, the rest one press from being put in play. */
function Situations({ situations, mayDecide, onSet }: { situations: SituationView[]; mayDecide: boolean; onSet: (key: string, on: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situations">
      {situations.map((view) => {
        const derived = Boolean(view.situation.derive);
        return (
          <button
            key={view.at}
            type="button"
            disabled={!mayDecide || derived}
            aria-pressed={view.state === 'on'}
            title={view.situation.hint}
            onClick={() => onSet(view.situation.key, view.state !== 'on')}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors disabled:cursor-default coarse:min-h-11',
              view.state === 'on' ? 'border-transparent bg-sunken font-medium text-ink' : view.state === 'proposed' ? 'border-ai/50 text-ink' : 'border-hairline text-ink-muted hover:border-axis',
            )}
          >
            {view.state === 'proposed' ? <AiMark size="xs" /> : null}
            {view.situation.label}
            {view.state !== 'on' && view.keptValues ? <span className="font-mono text-[11px] text-ink-muted">{view.keptValues} kept</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A sheet                                                               */
/* ------------------------------------------------------------------ */

type SheetProps = Omit<React.ComponentProps<typeof CheckFields>, 'defs' | 'values' | 'insights' | 'views' | 'heading'>;

function byKey(views: FieldView[]): { defs: CheckFieldDef[]; values: Record<string, NonNullable<FieldView['held']>>; views: Record<string, FieldView> } {
  const values: Record<string, NonNullable<FieldView['held']>> = {};
  for (const view of views) if (view.held) values[view.def.key] = view.held;
  return { defs: views.map((view) => view.def), values, views: Object.fromEntries(views.map((view) => [view.def.key, view])) };
}

function Sheet({ reading, mayDecide, props, onSection }: { reading: SheetReading; mayDecide: boolean; props: SheetProps; onSection: (section: string, reason: string | null) => void }) {
  return (
    <Card>
      <CardHeader title={reading.set.title} subtitle={`${reading.filled} of ${reading.total} recorded`} />
      <CardBody>
        <SheetBody reading={reading} props={props} mayDecide={mayDecide} onSection={onSection} />
      </CardBody>
    </Card>
  );
}

/** The sections of one holder: what shows, then what is folded, then what is kept and not in play. */
function SheetBody({ reading, props, mayDecide, onSection }: { reading: SheetReading; props: SheetProps; mayDecide?: boolean; onSection?: (section: string, reason: string | null) => void }) {
  const notInPlay = reading.fields.filter((view) => view.notInPlay);
  return (
    <div className="space-y-4 @container">
      {reading.sections
        .filter((section) => section.shown !== 'hidden')
        .map((section) => {
          const shown = byKey(section.fields.filter((view) => view.shown === 'shown'));
          const folded = byKey(section.fields.filter((view) => view.shown === 'folded'));
          return (
            <section key={section.key || 'main'} className="space-y-2">
              {section.label ? (
                <div className="flex items-baseline gap-2">
                  <h4 className="text-[12px] font-semibold text-ink">{section.label}</h4>
                  {section.na ? (
                    <span className="text-[12px] text-ink-muted">Not applicable: {NA_REASON_LABEL[section.na.reason as keyof typeof NA_REASON_LABEL] ?? section.na.reason}</span>
                  ) : null}
                  {section.na && mayDecide && onSection ? (
                    <button type="button" className="text-[12px] font-medium text-brand hover:underline" onClick={() => onSection(section.key, null)}>
                      Ask again
                    </button>
                  ) : null}
                  {!section.na && mayDecide && onSection ? (
                    <select
                      aria-label={`Why ${section.label} does not apply`}
                      value=""
                      onChange={(e) => e.target.value && onSection(section.key, e.target.value)}
                      className="ml-auto h-7 rounded-md border-0 bg-transparent px-1 text-[11px] text-ink-muted coarse:h-11"
                    >
                      <option value="">Not applicable…</option>
                      {NA_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {NA_REASON_LABEL[reason]}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ) : null}
              {section.na ? null : (
                <>
                  {shown.defs.length ? <CheckFields {...props} heading={null} defs={shown.defs} values={shown.values} views={shown.views} insights={[]} /> : null}
                  {folded.defs.length ? (
                    <details>
                      <summary className="flex cursor-pointer select-none items-center gap-1 text-[12px] font-medium text-ink-secondary coarse:min-h-11">
                        <ChevronRight size={13} aria-hidden className="transition-transform [details[open]>summary>&]:rotate-90" />
                        More <span className="font-mono font-normal text-ink-muted">{folded.defs.length}</span>
                      </summary>
                      <div className="mt-2">
                        <CheckFields {...props} heading={null} defs={folded.defs} values={folded.values} views={folded.views} insights={[]} />
                      </div>
                    </details>
                  ) : null}
                </>
              )}
            </section>
          );
        })}
      {notInPlay.length ? (
        <details>
          <summary className="flex cursor-pointer select-none items-center gap-1 text-[12px] font-medium text-ink-secondary coarse:min-h-11">
            <ChevronRight size={13} aria-hidden className="transition-transform [details[open]>summary>&]:rotate-90" />
            Recorded, not asked for now <span className="font-mono font-normal text-ink-muted">{notInPlay.length}</span>
          </summary>
          <div className="mt-2">
            <CheckFields {...props} disabled heading={null} {...byKey(notInPlay)} insights={[]} />
          </div>
        </details>
      ) : null}
      {reading.insights.length ? (
        <ul className="space-y-1 rounded-lg border border-hairline bg-sunken p-2.5">
          {reading.insights.map((insight) => (
            <li key={insight.text} className="text-[13px] leading-snug text-ink-secondary">
              {insight.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A set that repeats: a row for each record, its title and what its summary fields hold, each opening its own sheet. */
function Records({ set, records, mayEdit, quiet, onOpen, onAdd }: { set: FieldSet; records: SheetReading[]; mayEdit: boolean; quiet?: boolean; onOpen: (record: string) => void; onAdd: () => void }) {
  const waiting = records.reduce((n, record) => n + record.fields.filter((view) => view.state === 'proposed').length, 0);
  return (
    <Card>
      <CardHeader
        title={set.title}
        subtitle={records.length ? `${records.length}${waiting ? ` · ${waiting} to accept` : ''}` : quiet ? 'None yet' : `No ${set.records!.of} yet`}
        action={
          mayEdit ? (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={onAdd}>
              Add
            </Button>
          ) : undefined
        }
      />
      {records.length ? (
        <CardBody className="p-0">
          <ul className="divide-y divide-hairline">
            {records.map((record) => (
              <li key={record.recordId}>
                <button type="button" onClick={() => onOpen(record.recordId!)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken coarse:min-h-11">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{record.title}</span>
                  {record.chips.map((chip) => (
                    <span key={chip} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary">
                      {chip}
                    </span>
                  ))}
                  {record.fields.some((view) => view.state === 'proposed') ? <AiMark size="xs" /> : null}
                  <ChevronRight size={14} aria-hidden className="text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}
