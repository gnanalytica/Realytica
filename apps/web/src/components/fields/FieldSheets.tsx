/**
 * A function's sheets: what needs a person first, then the sheets themselves.
 *
 * The page does not open on a form. It opens on **Needs you**: five lines in
 * one order (Decide, Accept, Failing, Due soon, Missing), each with its count
 * and at most five of its lines until "Show all". Values offered are taken a
 * paper at a time; a line under Due soon can be put off until a day. On a
 * phone that card is the first screen of the function, and on a laptop it is
 * the first thing on the function's page (`part="needs"`, placed by the page).
 *
 * The sheets follow (`part="sheets"`), a section at a time. A field that its
 * situation does not bring into play is not drawn. Expert fields sit folded
 * under "More" until asked for or until one holds a value. What is recorded
 * under a situation since taken out of play is kept, under its own fold, and
 * so is a value under a key nothing asks for any more. A hard case opens from
 * the row that needs it as its own small sheet, and nowhere else.
 *
 * Everything shown is read off the project in hand (`readFunctionFields`), so
 * a save's answer redraws the page with no second request.
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react';
import {
  FIELD_SETS,
  NA_REASONS,
  NA_REASON_LABEL,
  NEED_KINDS,
  NEED_LABEL,
  NEED_LINES_SHOWN,
  FUNCTION_SHORT,
  SNOOZE_DAYS_MOST,
  departmentRole,
  optionSetById,
  readFunctionFields,
  refChoices,
  roleCanDecide,
  roleCanEdit,
  workstreamDefinition,
  type CheckFieldDef,
  type CheckFieldWrite,
  type DdProject,
  type DepartmentKey,
  type DepthReading,
  type FieldException,
  type FieldSet,
  type FieldValueDecision,
  type FieldView,
  type NeedKind,
  type RefTarget,
  type SheetReading,
  type SituationView,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useFirmCatalog } from '../../lib/firmFields';
import { useMe } from '../../lib/useMe';
import { CheckFields } from '../CheckFields';
import { StackPlan, drawsAsStackPlan } from './StackPlan';
import { AiMark, Badge, Button, Card, CardBody, CardHeader, Modal, cn, useToast } from '../ui/kit';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

interface Props {
  project: DdProject;
  fn: string;
  onChanged: (project: DdProject) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
  /** Which part to draw: what needs a person, the sheets, or (absent) both, one above the other. */
  part?: 'needs' | 'sheets';
}

/** A holder that is open over the page: a record's own sheet, and the depth sheet of it (or of a plain sheet) where one is open. */
interface Opened {
  set: string;
  record?: string;
  depth?: string;
}

/** What the person on this page may do in the function's department. */
function useSeat(project: DdProject, fn: string): { mayEdit: boolean; mayDecide: boolean } {
  const me = useMe();
  const department = workstreamDefinition(fn)?.department as DepartmentKey | undefined;
  const role = me && department ? departmentRole(project, { email: me.email, workspaceRole: me.role }, department) : undefined;
  return { mayEdit: roleCanEdit(role), mayDecide: roleCanDecide(role) };
}

export function FieldSheets({ project, fn, onChanged, onOpenPaper, part }: Props) {
  const toast = useToast();
  const seat = useSeat(project, fn);
  // The firm's own fields are part of the catalog this page reads: when they arrive or change, the page is read again.
  const catalog = useFirmCatalog(project);
  const page = useMemo(() => readFunctionFields(project, fn, new Date(), catalog), [project, fn, catalog]);
  const [open, setOpen] = useState<Opened | null>(null);
  // A function with several sheets opens each as one line: its title, how full it is and where it stands. A person opens the one they came for.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const choices = useMemo(() => (target: RefTarget | undefined) => refChoices(project, target, catalog), [project, catalog]);

  const run = (work: () => Promise<{ project: DdProject }>, failed: string) => {
    void work()
      .then((out) => onChanged(out.project))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : failed, 'critical'));
  };

  const lists = useMemo(() => (id: string) => optionSetById(id, catalog), [catalog]);

  const sheetProps = (reading: SheetReading) => ({
    evidence: project.evidence,
    lists,
    disabled: !seat.mayEdit,
    choices,
    onOpenPaper,
    onCommit: (values: Record<string, CheckFieldWrite>) => run(() => api.setFieldValues(project.id, { set: reading.set.id, record: reading.recordId, values }), 'That value could not be saved'),
    onDecide: seat.mayEdit
      ? (def: CheckFieldDef, decision: FieldValueDecision, input?: { value?: unknown; pick?: number; reason?: string }) =>
          run(() => api.decideField(project.id, { address: { fn, set: reading.set.id, field: def.key, ...(reading.recordId ? { record: reading.recordId } : {}) }, decision, ...input }), 'That could not be decided')
      : undefined,
  });

  // A situation that follows from what is recorded is drawn only while it holds: nobody can put it in play by hand.
  const inPlayOrAskable = page.situations.filter((view) => !view.situation.derive || view.state === 'on');

  const sheetsInPlay = page.sheets.filter((sheet) => sheet.reading && inPlay(sheet.reading)).length;
  const notYet = page.sheets.filter((sheet) => sheet.reading && !inPlay(sheet.reading));
  const holders: SheetReading[] = [...page.sheets.flatMap((sheet) => (sheet.reading ? [sheet.reading] : (sheet.records ?? []))), ...page.shared.flatMap((sheet) => sheet.records)];
  const opened = open ? holders.find((reading) => reading.set.id === open.set && reading.recordId === open.record) : undefined;
  const depth = opened && open?.depth ? opened.depth.find((held) => held.sheet.id === open.depth) : undefined;
  const addRecord = (set: string) =>
    void api
      .addFieldRecord(project.id, set)
      .then((out) => {
        onChanged(out.project);
        if (out.recordId) setOpen({ set, record: out.recordId });
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That could not be added', 'critical'));

  return (
    <div className="space-y-4">
      {part !== 'sheets' ? (
        <NeedsYou
          page={page}
          mayDecide={seat.mayDecide}
          onAccept={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: 'accept', ...(exception.pick !== undefined ? { pick: exception.pick } : {}) }), 'That could not be accepted')}
          onSetAside={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: exception.pick !== undefined ? 'keep' : 'set_aside' }), 'That could not be set aside')}
          onAcceptPaper={(evidenceId) => run(() => api.acceptPaperFields(project.id, fn, evidenceId), 'Those could not be accepted')}
          onSituation={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')}
          onSnooze={(key, until) => run(() => api.snoozeNeed(project.id, fn, key, until), 'That could not be put off')}
          onOpenPaper={onOpenPaper}
          onOpen={(exception) => setOpen({ set: exception.address?.set ?? exception.key.split('::')[0]!, ...(exception.record ? { record: exception.record } : {}), ...(exception.depth ? { depth: exception.depth } : {}) })}
        />
      ) : null}

      {part !== 'needs' ? (
        <>
          {inPlayOrAskable.length ? <Situations situations={inPlayOrAskable} mayDecide={seat.mayDecide} onSet={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')} /> : null}

          {/* The units as a stack plan, on the page of the function whose own fields give a unit its status. */}
          {page.shared
            .filter((shared) => drawsAsStackPlan(shared.records) && FIELD_SETS.some((set) => set.extends === shared.set.id && set.fn === fn && set.fields.some((def) => def.kind === 'status')))
            .map((shared) => (
              <StackPlan key={shared.set.id} records={shared.records} onOpen={(record) => setOpen({ set: shared.set.id, record })} />
            ))}

          {page.sheets.map((sheet) =>
            sheet.reading ? (
              // A sheet none of whose fields is in play yet is not drawn as an empty card: it is named in the line below.
              inPlay(sheet.reading) ? (
                <Sheet
                  key={sheet.set.id}
                  reading={sheet.reading}
                  mayDecide={seat.mayDecide}
                  props={sheetProps(sheet.reading)}
                  folds={sheetsInPlay > 1}
                  open={sheetsInPlay <= 1 || unfolded.has(sheet.set.id)}
                  onToggle={() =>
                    setUnfolded((held) => {
                      const next = new Set(held);
                      if (!next.delete(sheet.set.id)) next.add(sheet.set.id);
                      return next;
                    })
                  }
                  onSection={(section, reason) => run(() => api.setSectionNotApplicable(project.id, sheet.set.id, section, reason), 'That could not be marked')}
                  onOpenDepth={(id) => setOpen({ set: sheet.set.id, depth: id })}
                />
              ) : null
            ) : (
              <Records key={sheet.set.id} set={sheet.set} records={sheet.records ?? []} mayEdit={seat.mayEdit} onOpen={(record) => setOpen({ set: sheet.set.id, record })} onAdd={() => addRecord(sheet.set.id)} />
            ),
          )}

          {notYet.length ? (
            <p className="px-1 text-[12px] leading-snug text-ink-muted">
              {plural(notYet.length, 'sheet')} here {notYet.length === 1 ? 'opens' : 'open'} once what {notYet.length === 1 ? 'it is' : 'they are'} about is recorded: {notYet.map((sheet) => sheet.set.title).join(', ')}.
            </p>
          ) : null}

          {page.shared.map((shared) => (
            <Records key={shared.set.id} set={shared.set} records={shared.records} mayEdit={seat.mayEdit} quiet onOpen={(record) => setOpen({ set: shared.set.id, record })} onAdd={() => addRecord(shared.set.id)} />
          ))}
        </>
      ) : null}

      {/*
        One holder over the page: a record as a small sheet of its own, or a hard case's sheet. A dialog on a laptop, a
        sheet from the bottom on a phone. A record's depth sheet takes the record's place in the same dialog, with the
        way back at its head: function, row, sheet is the whole depth, and no dialog opens over another.
      */}
      <Modal
        open={Boolean(opened && (open?.record || depth))}
        onClose={() => setOpen(null)}
        title={depth ? `${opened!.set.records ? `${opened!.title} · ` : ''}${depth.sheet.title}` : (opened?.title ?? '')}
        width="md"
        footer={
          opened && open?.record && !depth && seat.mayDecide ? (
            <Button
              variant="ghost"
              onClick={() => {
                run(() => api.removeFieldRecord(project.id, opened.set.id, opened.recordId!), 'That could not be taken off');
                setOpen(null);
              }}
            >
              Take off the list
            </Button>
          ) : undefined
        }
      >
        {opened && depth ? (
          <DepthBody depth={depth} props={sheetProps(opened)} back={open?.record ? { label: opened.title, onBack: () => setOpen({ set: open.set, record: open.record }) } : undefined} />
        ) : opened && open?.record ? (
          <>
            <SheetBody reading={opened} props={sheetProps(opened)} onOpenDepth={(id) => setOpen({ set: open.set, record: open.record, depth: id })} />
            {/* One record, every department's facts: this page draws its own, and says who else keeps something on it. */}
            {opened.elsewhere?.length ? (
              <p className="mt-3 border-t border-hairline pt-2 text-[12px] text-ink-muted">
                Also kept on this record: {opened.elsewhere.map((other) => `${FUNCTION_SHORT[other.fn] ?? workstreamDefinition(other.fn)?.label ?? other.fn} (${other.held})`).join(' · ')}. Each is on its own function’s page.
              </p>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What needs a person                                                   */
/* ------------------------------------------------------------------ */

/** How each line's count reads in the card's one-line summary. */
const NEED_SAID: Record<NeedKind, string> = { decide: 'to decide', accept: 'to accept', failing: 'failing', due_soon: 'due soon', missing: 'missing' };

const isoDay = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function NeedsYou({
  page,
  mayDecide,
  onAccept,
  onSetAside,
  onAcceptPaper,
  onSituation,
  onSnooze,
  onOpenPaper,
  onOpen,
}: {
  page: ReturnType<typeof readFunctionFields>;
  mayDecide: boolean;
  onAccept: (exception: FieldException) => void;
  onSetAside: (exception: FieldException) => void;
  onAcceptPaper: (evidenceId: string) => void;
  onSituation: (key: string, on: boolean) => void;
  onSnooze: (key: string, until: string | null) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
  onOpen: (exception: FieldException) => void;
}) {
  const { needs, counts } = page;
  // Which lines are shown whole, and which line under Due soon is being put off.
  const [all, setAll] = useState<Partial<Record<NeedKind, boolean>>>({});
  const [putOff, setPutOff] = useState<{ key: string; until: string } | null>(null);
  const kinds = NEED_KINDS.filter((kind) => needs[kind].length > 0);
  // The values one paper offered, together: accepting a paper is the cheapest act with the largest effect.
  const papers = new Map<string, { label: string; plain: number }>();
  for (const exception of needs.accept) {
    if (!exception.source?.evidenceId) continue;
    const held = papers.get(exception.source.evidenceId) ?? { label: exception.source.label, plain: 0 };
    papers.set(exception.source.evidenceId, { ...held, plain: held.plain + (exception.oneAtATime ? 0 : 1) });
  }
  const subtitle = counts.total ? kinds.map((kind) => `${needs[kind].length} ${NEED_SAID[kind]}`).join(' · ') : `Nothing needs you. ${page.recorded} of ${page.expected} recorded.`;
  const waitingOn = page.waitingOn.map((group) => `${group.fields.length} on ${group.label.replace(/^The /, 'the ')}`).join(', ');
  const quiet = page.assumed || page.snoozed.length || page.waitingOn.length;

  return (
    <Card>
      <CardHeader icon={<ListChecks size={15} />} title="Needs you" subtitle={subtitle} />
      {counts.total || quiet ? (
        <CardBody className="space-y-3">
          {kinds.map((kind) => {
            const lines = needs[kind];
            const shown = all[kind] ? lines : lines.slice(0, NEED_LINES_SHOWN);
            return (
              <section key={kind} aria-label={NEED_LABEL[kind]}>
                <div className="flex items-center gap-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    {NEED_LABEL[kind]} <span className="font-mono font-normal">{lines.length}</span>
                  </h4>
                  {lines.length > NEED_LINES_SHOWN ? (
                    <button type="button" className="ml-auto text-[12px] font-medium text-brand hover:underline coarse:min-h-11" aria-expanded={Boolean(all[kind])} onClick={() => setAll((held) => ({ ...held, [kind]: !held[kind] }))}>
                      {all[kind] ? `Show ${NEED_LINES_SHOWN}` : `Show all ${lines.length}`}
                    </button>
                  ) : null}
                </div>
                {kind === 'accept' && mayDecide
                  ? [...papers.entries()]
                      .filter(([, paper]) => paper.plain > 1)
                      .map(([evidenceId, paper]) => (
                        <div key={evidenceId} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-ai/40 bg-ai/5 px-3 py-2">
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
                <ul className="mt-1 divide-y divide-hairline">
                  {shown.map((exception) => (
                    <li key={exception.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <div className="min-w-0 flex-1 basis-48">
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
                      {kind === 'failing' ? <Badge tone="critical">failing</Badge> : null}
                      {kind === 'due_soon' ? <Badge tone="warning">due soon</Badge> : null}
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
                      {kind === 'due_soon' && mayDecide ? (
                        putOff?.key === exception.key ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="date"
                              aria-label={`Put ${exception.label} off until`}
                              value={putOff.until}
                              min={isoDay(1)}
                              max={isoDay(SNOOZE_DAYS_MOST)}
                              onChange={(e) => setPutOff({ key: exception.key, until: e.target.value })}
                              className="h-8 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11"
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={!putOff.until}
                              onClick={() => {
                                onSnooze(exception.key, putOff.until);
                                setPutOff(null);
                              }}
                            >
                              Put off
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPutOff(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setPutOff({ key: exception.key, until: isoDay(7) })}>
                            Put off
                          </Button>
                        )
                      ) : null}
                      {(exception.record || exception.depth) && exception.kind !== 'proposed' ? (
                        <Button size="sm" variant="ghost" onClick={() => onOpen(exception)}>
                          Open
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {quiet ? (
            <div className="space-y-1 text-[12px] text-ink-muted">
              {page.waitingOn.length ? <p>Waiting on others: {waitingOn}. Listed under Papers owed.</p> : null}
              {page.assumed ? <p>{plural(page.assumed, 'usual value')} in use.</p> : null}
              {page.snoozed.length ? (
                <details>
                  <summary className="cursor-pointer select-none coarse:min-h-11">{page.snoozed.length} put off</summary>
                  <ul className="mt-1 space-y-1">
                    {page.snoozed.map((exception) => (
                      <li key={exception.key} className="flex flex-wrap items-center gap-x-2">
                        <span className="min-w-0 flex-1 text-ink-secondary">
                          {exception.label}: {exception.text}, until {exception.snoozedUntil}
                        </span>
                        {mayDecide ? (
                          <button type="button" className="font-medium text-brand hover:underline coarse:min-h-11" onClick={() => onSnooze(exception.key, null)}>
                            Bring back
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
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

/** Whether a sheet has anything to show yet: a field in play, or a hard case that applies. */
function inPlay(reading: SheetReading): boolean {
  return reading.fields.some((view) => view.shown !== 'hidden' && !view.def.sheet) || reading.depth.some((held) => held.shown);
}

/**
 * One sheet of a function. Where the function keeps several, each opens as
 * one line (its title, how full it is, what is still to fill and where its
 * standings are) and unfolds when pressed, so a function with seven sheets
 * is seven lines to choose from and not seven forms down the page.
 */
function Sheet({
  reading,
  mayDecide,
  props,
  folds,
  open,
  onToggle,
  onSection,
  onOpenDepth,
}: {
  reading: SheetReading;
  mayDecide: boolean;
  props: SheetProps;
  folds: boolean;
  open: boolean;
  onToggle: () => void;
  onSection: (section: string, reason: string | null) => void;
  onOpenDepth: (id: string) => void;
}) {
  const subtitle = `${reading.filled} of ${reading.total} recorded`;
  if (!folds) {
    return (
      <Card>
        <CardHeader title={reading.set.title} subtitle={subtitle} />
        <CardBody>
          <SheetBody reading={reading} props={props} mayDecide={mayDecide} onSection={onSection} onOpenDepth={onOpenDepth} />
        </CardBody>
      </Card>
    );
  }
  const missing = reading.fields.filter((view) => view.missing).length;
  const waiting = reading.fields.filter((view) => view.shown !== 'hidden' && (view.state === 'proposed' || view.waiting.length > 0)).length;
  // Where the sheet stands, as its own rules work it out: said on the line, so nobody opens a sheet to learn it is in order.
  const standings = reading.fields.filter((view) => view.def.kind === 'status' && view.shown !== 'hidden' && view.held && view.held.value !== null && view.held.value !== '');
  return (
    <Card>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-sunken/60 coarse:min-h-11">
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold tracking-tight text-ink">{reading.set.title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">
            {subtitle}
            {missing ? ` · ${missing} still to fill` : ''}
            {waiting ? ` · ${waiting} waiting on you` : ''}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {standings.map((view) => (
            <Badge key={view.def.key} tone={view.tone ?? 'neutral'}>
              {String(view.held!.value)}
            </Badge>
          ))}
          <ChevronRight size={16} className={cn('text-ink-muted transition-transform', open && 'rotate-90')} />
        </span>
      </button>
      {open ? (
        <CardBody className="border-t border-hairline">
          <SheetBody reading={reading} props={props} mayDecide={mayDecide} onSection={onSection} onOpenDepth={onOpenDepth} />
        </CardBody>
      ) : null}
    </Card>
  );
}

/** How full a depth sheet is and what is wrong on it, in one line: "2 of 2 recorded · 1 failing". */
function depthSaid(depth: DepthReading): string {
  return [`${depth.filled} of ${depth.total} recorded`, depth.waiting ? `${depth.waiting} to accept` : '', depth.failing ? `${depth.failing} failing` : ''].filter(Boolean).join(' · ');
}

/** The fields of a set of views, drawn a section at a time: what shows, then what is folded under More. */
function Sections({ sections, props }: { sections: SheetReading['sections']; props: SheetProps }) {
  return (
    <>
      {sections
        .filter((section) => section.shown !== 'hidden')
        .map((section) => {
          const shown = byKey(section.fields.filter((view) => view.shown === 'shown'));
          const folded = byKey(section.fields.filter((view) => view.shown === 'folded'));
          return (
            <section key={section.key || 'main'} className="space-y-2">
              {section.label ? <h4 className="text-[12px] font-semibold text-ink">{section.label}</h4> : null}
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
            </section>
          );
        })}
    </>
  );
}

/** A hard case's own small sheet: its fields a section at a time, and what its rules say. Opened from the holder that needs it. */
function DepthBody({ depth, props, back }: { depth: DepthReading; props: SheetProps; back?: { label: string; onBack: () => void } }) {
  return (
    <div className="space-y-4 @container">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {back ? (
          <button type="button" onClick={back.onBack} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
            <ChevronLeft size={13} aria-hidden />
            {back.label}
          </button>
        ) : null}
        <p className="font-mono text-[12px] text-ink-muted">{depthSaid(depth)}</p>
      </div>
      <Sections sections={depth.sections} props={props} />
      {depth.insights.length ? (
        <ul className="space-y-1 rounded-lg border border-hairline bg-sunken p-2.5">
          {depth.insights.map((insight) => (
            <li key={insight.text} className="text-[13px] leading-snug text-ink-secondary">
              {insight.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The sections of one holder: what shows, then what is folded, then what is kept and not in play. */
function SheetBody({
  reading,
  props,
  mayDecide,
  onSection,
  onOpenDepth,
}: {
  reading: SheetReading;
  props: SheetProps;
  mayDecide?: boolean;
  onSection?: (section: string, reason: string | null) => void;
  onOpenDepth?: (id: string) => void;
}) {
  const notInPlay = reading.fields.filter((view) => view.notInPlay);
  // A hard case shows on the holder that needs it, as one line that says how full it is. Nowhere else, and never by itself.
  const depth = reading.depth.filter((held) => held.shown);
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
      {depth.length && onOpenDepth ? (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {depth.map((held) => (
            <li key={held.sheet.id}>
              <button type="button" onClick={() => onOpenDepth(held.sheet.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-sunken coarse:min-h-11">
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{held.sheet.title}</span>
                <span className="font-mono text-[12px] text-ink-muted">
                  {held.filled} of {held.total} recorded
                </span>
                {held.waiting ? <AiMark size="xs" /> : null}
                {held.failing ? <Badge tone="critical">{held.failing} failing</Badge> : null}
                <ChevronRight size={14} aria-hidden className="text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {reading.unasked.length ? (
        <details>
          <summary className="flex cursor-pointer select-none items-center gap-1 text-[12px] font-medium text-ink-secondary coarse:min-h-11">
            <ChevronRight size={13} aria-hidden className="transition-transform [details[open]>summary>&]:rotate-90" />
            No longer asked <span className="font-mono font-normal text-ink-muted">{reading.unasked.length}</span>
          </summary>
          <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
            {reading.unasked.map((kept) => (
              <div key={kept.key} className="contents">
                <dt className="font-mono text-ink-muted">{kept.key}</dt>
                <dd className="text-ink-secondary">{kept.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
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
