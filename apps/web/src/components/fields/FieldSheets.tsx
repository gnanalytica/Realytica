/**
 * A function's sheets: what needs a person first, then the sheets themselves.
 *
 * The page does not open on a form. It opens on **Needs you**: at most five
 * lines in all, the most pressing first across Decide, Accept, Failing, Due
 * soon and Missing. Each group is a chip with its count that narrows the card
 * to it, and one "Show all" lifts the cap. Every line has one action: Accept
 * where the value can be accepted here, otherwise Open, which goes to the
 * sheet, the record or the check that holds it and brings the field into
 * view. On a phone that card is the first screen of the function.
 *
 * Below it, each sheet is one line: its title, how full it is and where it
 * stands. A line unfolds when pressed, a section at a time. A set that
 * repeats is one line with its count, and so is a shared record this function
 * only reads. A field that its situation does not bring into play is not
 * drawn. Expert fields sit folded under "More" until asked for or until one
 * holds a value. What is recorded under a situation since taken out of play
 * is kept, under its own fold, and so is a value under a key nothing asks for
 * any more. A hard case opens from the row that needs it as its own small
 * sheet, and nowhere else.
 *
 * Everything shown is read off the project in hand (`readFunctionFields`), so
 * a save's answer redraws the page with no second request.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ListChecks, Plus } from 'lucide-react';
import {
  DEPARTMENT_KEYS,
  FIELD_SETS,
  NA_REASONS,
  NA_REASON_LABEL,
  NEED_LABEL,
  asAtMoment,
  isPastDay,
  periodIssuedSaid,
  periodsOf,
  projectAsAt,
  readSheetPeriod,
  FUNCTION_SHORT,
  SNOOZE_DAYS_MOST,
  daySaid,
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
  type PeriodInstance,
  type RefTarget,
  type SheetReading,
  type SituationView,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useFirmCatalog } from '../../lib/firmFields';
import { useMe } from '../../lib/useMe';
import { CheckFields } from '../CheckFields';
import { PeriodHead, PeriodRecords, ReadOnlyBand, SheetPeriodsBar } from './Periods';
import { StackPlan, drawsAsStackPlan } from './StackPlan';
import { NEEDS_SHOWN, needAction, needAssumes, needChips, needLines, needRuleRows, needRuleUnchecked, needSource, needUnverified, needWhere, sheetItem, sheetItemOf, type NeedAction, type NeedTarget } from './needs';
import { AiMark, Badge, Button, Card, CardBody, CardHeader, Modal, cn, useToast } from '../ui/kit';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

interface Props {
  project: DdProject;
  fn: string;
  onChanged: (project: DdProject) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
  /** Which part to draw: what needs a person, the sheets, or (absent) both, one above the other. */
  part?: 'needs' | 'sheets';
  /** A place on the sheets a link names (`set::record::field`), brought into view. `at` makes a repeat count. */
  marked?: { item: string; at: number } | null;
  /** Opens the check that holds a value this page only reads. */
  onOpenCheck?: (where: { ddId: string; scopeId: string; checkId: string; field?: string }) => void;
  /** Opens another function's sheets at a place on them. */
  onOpenFunction?: (fn: string, item: string) => void;
}

/** A holder that is open over the page: a record's own sheet, and the depth sheet of it (or of a plain sheet) where one is open. */
interface Opened {
  set: string;
  record?: string;
  depth?: string;
}

/**
 * What the person on this page may do in the function's department, and
 * whether they may decide a value held somewhere else: in another function,
 * or on a shared record, which any department's lead may decide. The server
 * asks the same of the address a decision is sent to.
 */
function useSeat(project: DdProject, fn: string): { mayEdit: boolean; mayDecide: boolean; mayDecideAt: (at: string | undefined) => boolean } {
  const me = useMe();
  const roleIn = (department: DepartmentKey | undefined) => (me && department ? departmentRole(project, { email: me.email, workspaceRole: me.role }, department) : undefined);
  const role = roleIn(workstreamDefinition(fn)?.department as DepartmentKey | undefined);
  const mayDecideAt = (at: string | undefined): boolean => {
    if (!at || at === fn) return roleCanDecide(role);
    if (at === 'shared') return DEPARTMENT_KEYS.some((department) => roleCanDecide(roleIn(department)));
    return roleCanDecide(roleIn(workstreamDefinition(at)?.department as DepartmentKey | undefined));
  };
  return { mayEdit: roleCanEdit(role), mayDecide: roleCanDecide(role), mayDecideAt };
}

/** The element a holder's fields are drawn in: a sheet's card on the page, or a record's sheet over it. The last drawn is the one on top. */
function holderElement(set: string, record?: string): HTMLElement | undefined {
  const key = `${set}::${record ?? ''}`;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-holder]'))
    .filter((el) => el.dataset.holder === key)
    .pop();
}

export function FieldSheets({ project: live, fn, onChanged, onOpenPaper, part, marked, onOpenCheck, onOpenFunction }: Props) {
  const toast = useToast();
  // The sheets as they stand, or as they stood when a past day ended: a reading of the same project, with every control off.
  const [asAt, setAsAt] = useState<string | null>(null);
  const project = useMemo(() => (asAt ? projectAsAt(live, asAt) : live), [live, asAt]);
  const liveSeat = useSeat(live, fn);
  const seat = asAt ? { mayEdit: false, mayDecide: false, mayDecideAt: () => false } : liveSeat;
  // The firm's own fields are part of the catalog this page reads: when they arrive or change, the page is read again.
  const catalog = useFirmCatalog(live);
  const page = useMemo(() => readFunctionFields(project, fn, asAt ? asAtMoment(asAt) : new Date(), catalog), [project, fn, catalog, asAt]);
  // One issued period of a sheet, open over the page as it was issued.
  const [period, setPeriod] = useState<{ set: string; key: string; issuedAt?: string } | null>(null);
  const [open, setOpen] = useState<Opened | null>(null);
  // Every sheet opens as one line: its title, how full it is and where it stands. A person opens the one they came for.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  // The place a line's Open, or a link, asked for: brought into view once it is drawn.
  const [focus, setFocus] = useState<{ set: string; record?: string; field?: string; at: number } | null>(null);
  const choices = useMemo(() => (target: RefTarget | undefined) => refChoices(project, target, catalog), [project, catalog]);

  const run = (work: () => Promise<{ project: DdProject }>, failed: string) => {
    void work()
      .then((out) => onChanged(out.project))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : failed, 'critical'));
  };

  const lists = useMemo(() => (id: string) => optionSetById(id, catalog), [catalog]);

  /** The period a record is, where its set is kept by period. */
  const instanceOf = (set: string, record: string | undefined) => {
    const periods = record ? page.sheets.find((sheet) => sheet.set.id === set)?.periods : undefined;
    return periods ? [...periods.open, ...periods.past].find((instance) => instance.record === record) : undefined;
  };
  const actOnPeriod = (set: string, body: Omit<Parameters<typeof api.fieldPeriod>[1], 'set'>) =>
    void api
      .fieldPeriod(project.id, { set, ...body })
      .then((out) => {
        onChanged(out.project);
        // A period just opened, or a revision of one, is the next thing to work on.
        if ((body.act === 'open' || body.act === 'revise') && out.recordId) setOpen({ set, record: out.recordId });
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'That could not be done', 'critical'));

  const sheetProps = (reading: SheetReading) => {
    // An issued period is read only: every control is off, and nothing on it is decided.
    const issued = instanceOf(reading.set.id, reading.recordId)?.status === 'issued';
    return sheetPropsOf(reading, issued);
  };
  const sheetPropsOf = (reading: SheetReading, issued: boolean) => ({
    evidence: project.evidence,
    lists,
    disabled: !seat.mayEdit || issued,
    choices,
    onOpenPaper,
    onCommit: (values: Record<string, CheckFieldWrite>) => run(() => api.setFieldValues(project.id, { set: reading.set.id, record: reading.recordId, values }), 'That value could not be saved'),
    onDecide: seat.mayEdit && !issued
      ? (def: CheckFieldDef, decision: FieldValueDecision, input?: { value?: unknown; pick?: number; reason?: string }) =>
          run(() => api.decideField(project.id, { address: { fn, set: reading.set.id, field: def.key, ...(reading.recordId ? { record: reading.recordId } : {}) }, decision, ...input }), 'That could not be decided')
      : undefined,
  });

  const toggle = (id: string) =>
    setUnfolded((held) => {
      const next = new Set(held);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Goes to a place on this function's sheets: unfolds its sheet or opens its record, and brings the field into view. */
  const goTo = (target: { set: string; record?: string; depth?: string; field?: string }) => {
    if (target.record || target.depth) setOpen({ set: target.set, ...(target.record ? { record: target.record } : {}), ...(target.depth ? { depth: target.depth } : {}) });
    setUnfolded((held) => new Set(held).add(target.set));
    setFocus({ set: target.set, ...(target.record ? { record: target.record } : {}), ...(target.field ? { field: target.field } : {}), at: Date.now() });
  };

  const openTarget = (target: NeedTarget) => {
    if (target.where === 'check' && onOpenCheck) onOpenCheck(target);
    else if (target.where === 'function' && onOpenFunction) onOpenFunction(target.fn, sheetItem(target));
    else if (target.where === 'here') goTo(target);
  };

  // A link that names a place on the sheets lands on it.
  const markedItem = marked?.item;
  const markedAt = marked?.at;
  useEffect(() => {
    const target = sheetItemOf(markedItem);
    if (target && part !== 'needs') goTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the visit is what brings it into view, not each redraw
  }, [markedItem, markedAt]);

  // The sheet unfolds, or the record's sheet opens, a moment after it is asked for: the field is looked for until it is drawn.
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    let timer = 0;
    const look = () => {
      const holder = holderElement(focus.set, focus.record);
      const field = focus.field && holder ? Array.from(holder.querySelectorAll<HTMLElement>('[data-field]')).find((el) => el.dataset.field === focus.field) : undefined;
      // Wait a little for the field; if it is not drawn there (a line about the whole sheet), the holder is the place.
      const at = field ?? (focus.field && tries < 8 ? undefined : holder);
      if (!at) {
        tries += 1;
        if (tries < 12) timer = window.setTimeout(look, 80);
        return;
      }
      // A field folded under More is opened before it is brought into view.
      for (let fold = at.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null) fold.open = true;
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      at.scrollIntoView({ block: field ? 'center' : 'start', behavior: calm ? 'auto' : 'smooth' });
      if (field) {
        field.animate([{ boxShadow: '0 0 0 3px var(--brand)' }, { boxShadow: '0 0 0 3px transparent' }], { duration: 1800, easing: 'ease-out' });
        // The line asked for this field: its box takes the caret, so the next thing typed goes into it.
        field.querySelector<HTMLElement>('input:not([type="hidden"]):not([tabindex="-1"]), select, textarea, button')?.focus({ preventScroll: true });
      }
    };
    timer = window.setTimeout(look, 40);
    return () => window.clearTimeout(timer);
  }, [focus]);

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
          actionOf={(exception) => needAction(page, exception, seat.mayDecideAt(exception.address?.fn), project, catalog)}
          onAccept={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: 'accept', ...(exception.pick !== undefined ? { pick: exception.pick } : {}) }), 'That could not be accepted')}
          onSetAside={(exception) => run(() => api.decideField(project.id, { address: exception.address!, decision: exception.pick !== undefined ? 'keep' : 'set_aside' }), 'That could not be set aside')}
          onAcceptPaper={(evidenceId) => run(() => api.acceptPaperFields(project.id, fn, evidenceId), 'Those could not be accepted')}
          onSituation={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')}
          onSnooze={(key, until) => run(() => api.snoozeNeed(project.id, fn, key, until), 'That could not be postponed')}
          onOpenPaper={onOpenPaper}
          onOpen={openTarget}
        />
      ) : null}

      {part !== 'needs' ? (
        <>
          {asAt ? (
            <ReadOnlyBand
              action={
                <Button size="sm" variant="secondary" onClick={() => setAsAt(null)}>
                  Back to today
                </Button>
              }
            >
              <span className="font-semibold">As at {daySaid(asAt)}</span> · read only. A period issued for that day reads as it was issued.
            </ReadOnlyBand>
          ) : null}
          <Situations situations={page.situations} mayDecide={seat.mayDecide} onSet={(key, on) => run(() => api.setSituation(project.id, fn, key, on), 'That could not be set')} />

          {page.sheets.map((sheet) =>
            sheet.reading ? (
              // A sheet none of whose fields is in play yet is not drawn as an empty card: it is named in the line below.
              inPlay(sheet.reading) ? (
                <Sheet
                  key={sheet.set.id}
                  reading={sheet.reading}
                  mayDecide={seat.mayDecide}
                  props={sheetProps(sheet.reading)}
                  open={unfolded.has(sheet.set.id)}
                  onToggle={() => toggle(sheet.set.id)}
                  onSection={(section, reason) => run(() => api.setSectionNotApplicable(project.id, sheet.set.id, section, reason), 'That could not be marked')}
                  onOpenDepth={(id) => setOpen({ set: sheet.set.id, depth: id })}
                  head={
                    sheet.periods ? (
                      <SheetPeriodsBar
                        project={project}
                        set={sheet.set}
                        periods={sheet.periods}
                        catalog={catalog}
                        mayEdit={seat.mayEdit}
                        mayDecide={seat.mayDecide}
                        onAct={(body) => actOnPeriod(sheet.set.id, body)}
                        onOpenPeriod={(instance: PeriodInstance) => setPeriod({ set: sheet.set.id, key: instance.period.key, ...(instance.status === 'issued' && instance.issued ? { issuedAt: instance.issued.at } : {}) })}
                      />
                    ) : undefined
                  }
                />
              ) : null
            ) : sheet.periods ? (
              // A set kept by period opens on its open period, with one line for the past.
              <PeriodRecords
                key={sheet.set.id}
                project={project}
                set={sheet.set}
                records={sheet.records ?? []}
                periods={sheet.periods}
                mayEdit={seat.mayEdit}
                open={unfolded.has(sheet.set.id)}
                onToggle={() => toggle(sheet.set.id)}
                onOpen={(record) => setOpen({ set: sheet.set.id, record })}
                onAdd={() => addRecord(sheet.set.id)}
                onAct={(body) => actOnPeriod(sheet.set.id, body)}
              />
            ) : (
              <Records key={sheet.set.id} set={sheet.set} records={sheet.records ?? []} mayEdit={seat.mayEdit} open={unfolded.has(sheet.set.id)} onToggle={() => toggle(sheet.set.id)} onOpen={(record) => setOpen({ set: sheet.set.id, record })} onAdd={() => addRecord(sheet.set.id)} />
            ),
          )}

          {notYet.length ? (
            <p className="px-1 text-[12px] leading-snug text-ink-muted">
              {plural(notYet.length, 'sheet')} here {notYet.length === 1 ? 'opens' : 'open'} once what {notYet.length === 1 ? 'it is' : 'they are'} about is recorded: {notYet.map((sheet) => sheet.set.title).join(', ')}.
            </p>
          ) : null}

          {/* A shared record is the project's: here it is a count and a way in, never every unit and party printed on a page that only reads them. */}
          {page.shared.map((shared) => (
            <Records
              key={shared.set.id}
              set={shared.set}
              records={shared.records}
              mayEdit={seat.mayEdit}
              quiet
              open={unfolded.has(shared.set.id)}
              onToggle={() => toggle(shared.set.id)}
              onOpen={(record) => setOpen({ set: shared.set.id, record })}
              onAdd={() => addRecord(shared.set.id)}
              // The units as a stack plan, on the page of the function whose own fields give a unit its status.
              plan={drawsAsStackPlan(shared.records) && FIELD_SETS.some((set) => set.extends === shared.set.id && set.fn === fn && set.fields.some((def) => def.kind === 'status'))}
            />
          ))}
          {!sheetsInPlay && !page.sheets.some((sheet) => sheet.records) && !notYet.length ? <p className="px-1 text-[12px] text-ink-muted">No sheet here yet.</p> : null}
          {/* One quiet line: the same sheets read as at a past day. Live carries no mark; a past day carries the band above. */}
          {sheetsInPlay || page.sheets.some((sheet) => sheet.records?.length) ? (
            <label className="flex flex-wrap items-center gap-2 px-1 text-[12px] text-ink-muted" data-asat-pick>
              Read these sheets as at
              <input
                type="date"
                aria-label="Read these sheets as at a past day"
                value={asAt ?? ''}
                max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}
                onChange={(event) => setAsAt(event.target.value && isPastDay(event.target.value) ? event.target.value : null)}
                className="h-7 rounded-md border border-hairline bg-surface px-1.5 text-[12px] text-ink coarse:h-11"
              />
            </label>
          ) : null}
        </>
      ) : null}
      <PeriodSheet
        project={live}
        catalog={catalog}
        period={period}
        mayDecide={liveSeat.mayDecide}
        mayEdit={liveSeat.mayEdit}
        onClose={() => setPeriod(null)}
        onAct={(set, body) => {
          actOnPeriod(set, body);
          // What is shown next is the latest of that period: the revision just opened, or the issue just made of it.
          setPeriod({ set, key: body.period });
        }}
        propsOf={(reading, editable, key) => ({
          ...sheetPropsOf(reading, !editable),
          disabled: !liveSeat.mayEdit || !editable,
          // A revision takes its values under its period's name: the sheet itself is the open period, and is not touched.
          onCommit: (values: Record<string, CheckFieldWrite>) => run(() => api.setFieldValues(live.id, { set: reading.set.id, period: key, values }), 'That value could not be saved'),
          onDecide: undefined,
        })}
      />

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
          opened && open?.record && !depth && seat.mayDecide && instanceOf(opened.set.id, opened.recordId)?.status !== 'issued' ? (
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
          <div data-holder={`${opened.set.id}::${opened.recordId ?? ''}`}>
            <DepthBody depth={depth} props={sheetProps(opened)} back={open?.record ? { label: opened.title, onBack: () => setOpen({ set: open.set, record: open.record }) } : undefined} />
          </div>
        ) : opened && open?.record ? (
          <div data-holder={`${opened.set.id}::${opened.recordId ?? ''}`}>
            {instanceOf(opened.set.id, opened.recordId) ? (
              <PeriodHead project={project} set={opened.set} instance={instanceOf(opened.set.id, opened.recordId)!} catalog={catalog} mayEdit={seat.mayEdit} mayDecide={seat.mayDecide} onAct={(body) => actOnPeriod(opened.set.id, body)} />
            ) : null}
            <SheetBody reading={opened} props={sheetProps(opened)} onOpenDepth={(id) => setOpen({ set: open.set, record: open.record, depth: id })} />
            {/* One record, every department's facts: this page draws its own, and says who else keeps something on it. */}
            {opened.elsewhere?.length ? (
              <p className="mt-3 border-t border-hairline pt-2 text-[12px] text-ink-muted">
                Also kept on this record: {opened.elsewhere.map((other) => `${FUNCTION_SHORT[other.fn] ?? workstreamDefinition(other.fn)?.label ?? other.fn} (${other.held})`).join(' · ')}. Each is on its own function’s page.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What needs a person                                                   */
/* ------------------------------------------------------------------ */

/** The colour each group's name is written in: what is failing reads as failing before a word of the line is read. */
const NEED_TONE: Record<NeedKind, string> = {
  decide: 'text-ai-ink',
  accept: 'text-ai-ink',
  failing: 'text-critical',
  due_soon: 'text-[var(--status-warning-text)]',
  missing: 'text-ink-muted',
};

const isoDay = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function NeedsYou({
  page,
  mayDecide,
  actionOf,
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
  actionOf: (exception: FieldException) => NeedAction;
  onAccept: (exception: FieldException) => void;
  onSetAside: (exception: FieldException) => void;
  onAcceptPaper: (evidenceId: string) => void;
  onSituation: (key: string, on: boolean) => void;
  onSnooze: (key: string, until: string | null) => void;
  onOpenPaper?: (evidenceId: string, page?: number) => void;
  onOpen: (target: NeedTarget) => void;
}) {
  const { needs, counts } = page;
  // The group a chip narrowed the card to, whether the cap is lifted, and which line under Due soon is being postponed.
  const [only, setOnly] = useState<NeedKind | null>(null);
  const [all, setAll] = useState(false);
  const [putOff, setPutOff] = useState<{ key: string; until: string } | null>(null);
  const chips = needChips(needs);
  // A group that has emptied since it was picked narrows to nothing: the card goes back to every group.
  const narrowed = only && needs[only].length ? only : null;
  const inScope = narrowed ? needs[narrowed].length : counts.total;
  const shown = needLines(needs, { only: narrowed, all });
  // The values one paper offered, together: accepting a paper is the cheapest act with the largest effect.
  const papers = new Map<string, { label: string; plain: number }>();
  for (const exception of needs.accept) {
    if (!exception.source?.evidenceId || actionOf(exception).kind !== 'accept') continue;
    const held = papers.get(exception.source.evidenceId) ?? { label: exception.source.label, plain: 0 };
    papers.set(exception.source.evidenceId, { ...held, plain: held.plain + (exception.oneAtATime ? 0 : 1) });
  }
  const wholePapers = (narrowed === 'accept' || all) && mayDecide ? [...papers.entries()].filter(([, paper]) => paper.plain > 1) : [];
  const waitingOn = page.waitingOn.map((group) => `${group.fields.length} on ${group.label.replace(/^The /, 'the ')}`).join(', ');
  const quiet = page.assumed || page.snoozed.length || page.waitingOn.length;

  return (
    <Card>
      <CardHeader icon={<ListChecks size={15} />} title="Needs you" subtitle={counts.total ? `${page.recorded} of ${page.expected} recorded` : `Nothing needs you. ${page.recorded} of ${page.expected} recorded.`} />
      {counts.total || quiet ? (
        <CardBody className="space-y-3">
          {chips.length ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Narrow to one kind">
              {chips.map(({ kind, count }) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={narrowed === kind}
                  onClick={() => {
                    setOnly(narrowed === kind ? null : kind);
                    setAll(false);
                  }}
                  className={cn(
                    'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors coarse:min-h-11',
                    narrowed === kind ? 'border-brand bg-brand-soft font-semibold text-brand-strong' : 'border-hairline text-ink-secondary hover:border-axis',
                  )}
                >
                  <span className={narrowed === kind ? undefined : NEED_TONE[kind]}>{NEED_LABEL[kind]}</span>
                  <span className="font-mono tabular-nums">{count}</span>
                </button>
              ))}
              {inScope > NEEDS_SHOWN ? (
                <button type="button" className="ml-auto text-[12px] font-medium text-brand hover:underline coarse:min-h-11" aria-expanded={all} onClick={() => setAll((held) => !held)}>
                  {all ? `Show ${NEEDS_SHOWN}` : `Show all ${inScope}`}
                </button>
              ) : null}
            </div>
          ) : null}
          {wholePapers.map(([evidenceId, paper]) => (
            <div key={evidenceId} className="flex flex-wrap items-center gap-2 rounded-lg border border-ai/40 bg-ai/5 px-3 py-2">
              <AiMark size="xs" />
              <p className="min-w-0 flex-1 text-[13px] text-ink">
                {plural(paper.plain, 'value')} from {paper.label}
              </p>
              <Button size="sm" variant="primary" onClick={() => onAcceptPaper(evidenceId)}>
                Accept all {paper.plain}
              </Button>
            </div>
          ))}
          {shown.length ? (
            <ul className="divide-y divide-hairline" aria-label="What needs you">
              {shown.map((exception) => {
                const action = actionOf(exception);
                const valued = exception.kind === 'proposed' || exception.kind === 'disputed';
                const where = needWhere(exception);
                const under = [where, valued ? '' : exception.text].filter(Boolean).join(' · ');
                const source = needSource(exception.source);
                return (
                  <li key={exception.key} data-need={exception.need} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="text-[13px] text-ink">
                        <span className={cn('mr-2 text-[11px] font-semibold uppercase tracking-[0.06em]', NEED_TONE[exception.need])}>{NEED_LABEL[exception.need]}</span>
                        {exception.label}
                        {valued ? <span className="font-mono text-ink-secondary"> {exception.text}</span> : null}
                        {needRuleUnchecked(page, exception) ? (
                          <span className="ml-2 whitespace-nowrap text-[11px] text-[var(--status-warning-text)]" title={needRuleRows(page, exception) || undefined}>
                            rule not checked
                          </span>
                        ) : null}
                        {needAssumes(page, exception).length ? (
                          <span className="ml-2 whitespace-nowrap text-[11px] text-ink-muted" title={`Nobody entered: ${needAssumes(page, exception).join(', ')}`}>
                            on an assumed value
                          </span>
                        ) : null}
                      </p>
                      {under || source ? (
                        <p className="text-[12px] leading-snug text-ink-muted">
                          {under}
                          {source ? (
                            <>
                              {under ? ' · ' : ''}
                              {exception.source!.evidenceId && onOpenPaper ? (
                                <button type="button" className="font-medium text-brand hover:underline" onClick={() => onOpenPaper(exception.source!.evidenceId!, exception.source!.page)}>
                                  {source}
                                </button>
                              ) : (
                                <span>{source}</span>
                              )}
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {exception.source?.quote && exception.kind === 'proposed' ? <p className="text-[12px] leading-snug text-ink-muted">“{exception.source.quote}”</p> : null}
                      {needUnverified(exception) ? <p className="text-[12px] leading-snug text-[var(--status-warning-text)]">These words were not found on that page. Accepted one at a time, after a look at the paper.</p> : null}
                    </div>
                    {exception.need === 'due_soon' && mayDecide ? (
                      putOff?.key === exception.key ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="date"
                            aria-label={`Postpone ${exception.label} until`}
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
                            Postpone
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPutOff(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setPutOff({ key: exception.key, until: isoDay(7) })}>
                          Postpone
                        </Button>
                      )
                    ) : null}
                    {action.kind === 'accept' ? (
                      <span className="flex gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => onAccept(exception)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onSetAside(exception)}>
                          Not this
                        </Button>
                      </span>
                    ) : action.kind === 'situation' ? (
                      <span className="flex gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => onSituation(action.key, true)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onSituation(action.key, false)}>
                          Not this
                        </Button>
                      </span>
                    ) : action.kind === 'open' ? (
                      <Button size="sm" variant={exception.need === 'missing' || exception.need === 'due_soon' ? 'ghost' : 'secondary'} onClick={() => onOpen(action.target)}>
                        Open
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {quiet ? (
            <div className="space-y-1 text-[12px] text-ink-muted">
              {page.waitingOn.length ? <p>Waiting on others: {waitingOn}. Listed under Papers owed.</p> : null}
              {page.assumed ? <p>{plural(page.assumed, 'usual value')} in use.</p> : null}
              {page.snoozed.length ? (
                <details>
                  <summary className="cursor-pointer select-none coarse:min-h-11">{page.snoozed.length} postponed</summary>
                  <ul className="mt-1 space-y-1">
                    {page.snoozed.map((exception) => (
                      <li key={exception.key} className="flex flex-wrap items-center gap-x-2">
                        <span className="min-w-0 flex-1 text-ink-secondary">
                          {exception.label}: {exception.text}, until {daySaid(exception.snoozedUntil)}
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

/**
 * The situations a function answers to. One in play is a filled chip with a
 * tick and the word "On"; one a paper proposes is marked as waiting to be
 * decided. The rest are not drawn until asked for: a situation that follows
 * from what is recorded is never one to set by hand, and the ones a person
 * may put in play sit one press away, under "Add a situation".
 */
function Situations({ situations, mayDecide, onSet }: { situations: SituationView[]; mayDecide: boolean; onSet: (key: string, on: boolean) => void }) {
  const live = situations.filter((view) => view.state === 'on' || view.state === 'proposed');
  const askable = situations.filter((view) => view.state === 'off' && !view.situation.derive);
  if (!live.length && !(askable.length && mayDecide)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Situations">
      {live.map((view) => {
        const fixed = Boolean(view.situation.derive) || Boolean(view.implied);
        const on = view.state === 'on';
        return (
          <button
            key={view.at}
            type="button"
            disabled={!mayDecide || fixed}
            aria-pressed={on}
            title={view.situation.hint}
            onClick={() => onSet(view.situation.key, !on)}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors disabled:cursor-default coarse:min-h-11',
              on ? 'border-brand bg-brand-soft font-semibold text-brand-strong' : 'border-dashed border-ai/60 text-ink',
            )}
          >
            {on ? <Check size={13} strokeWidth={2.4} aria-hidden /> : <AiMark size="xs" />}
            {view.situation.label}
            <span className="font-normal text-ink-muted">{on ? 'On' : 'To decide'}</span>
          </button>
        );
      })}
      {askable.length && mayDecide ? (
        <details className="w-full">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[12px] font-medium text-ink-secondary coarse:min-h-11">
            <ChevronRight size={13} aria-hidden className="transition-transform [details[open]>summary>&]:rotate-90" />
            Add a situation <span className="font-mono font-normal text-ink-muted">{askable.length}</span>
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {askable.map((view) => (
              <button
                key={view.at}
                type="button"
                aria-pressed={false}
                title={view.situation.hint}
                onClick={() => onSet(view.situation.key, true)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-[12px] text-ink-secondary hover:border-axis coarse:min-h-11"
              >
                <Plus size={12} aria-hidden />
                {view.situation.label}
                {view.keptValues ? <span className="font-mono text-[11px] text-ink-muted">{view.keptValues} kept</span> : null}
              </button>
            ))}
          </div>
        </details>
      ) : null}
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
 * One sheet of a function, as one line: its title, how full it is, what is
 * still to fill and where its standings are. It unfolds when pressed, so a
 * function is a short list of sheets to choose from and never a form down the
 * page.
 */
function Sheet({
  reading,
  mayDecide,
  props,
  open,
  onToggle,
  onSection,
  onOpenDepth,
  head,
}: {
  reading: SheetReading;
  mayDecide: boolean;
  props: SheetProps;
  open: boolean;
  onToggle: () => void;
  onSection: (section: string, reason: string | null) => void;
  onOpenDepth: (id: string) => void;
  /** On a sheet kept by period: the period it is open on, and the line that opens the past. */
  head?: ReactNode;
}) {
  const missing = reading.fields.filter((view) => view.missing).length;
  const waiting = reading.fields.filter((view) => view.shown !== 'hidden' && (view.state === 'proposed' || view.waiting.length > 0)).length;
  // Where the sheet stands, as its own rules work it out: said on the line, so nobody opens a sheet to learn it is in order.
  const standings = reading.fields.filter((view) => view.def.kind === 'status' && view.shown !== 'hidden' && view.held && view.held.value !== null && view.held.value !== '');
  return (
    <div data-holder={`${reading.set.id}::`} className="scroll-mt-16">
      <Card>
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-sunken/60 coarse:min-h-11">
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold tracking-tight text-ink">{reading.set.title}</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">
              {reading.filled} of {reading.total} recorded
              {missing ? ` · ${missing} still to fill` : ''}
              {waiting ? ` · ${waiting} to accept` : ''}
            </span>
          </span>
          <span className="flex min-w-0 shrink flex-wrap items-center justify-end gap-1.5">
            {standings.map((view) => (
              <Badge key={view.def.key} tone={view.tone ?? 'neutral'}>
                {String(view.held!.value)}
              </Badge>
            ))}
            <ChevronRight size={16} className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-90')} />
          </span>
        </button>
        {open ? (
          <CardBody className="border-t border-hairline">
            {head}
            <SheetBody reading={reading} props={props} mayDecide={mayDecide} onSection={onSection} onOpenDepth={onOpenDepth} />
          </CardBody>
        ) : null}
      </Card>
    </div>
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
            <section key={section.key || 'main'} className={cn('space-y-3', section.label && 'rounded-xl border border-hairline p-3')}>
              {section.label ? <h4 className="border-b border-hairline pb-2 text-[13px] font-semibold text-ink">{section.label}</h4> : null}
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
            <section key={section.key || 'main'} className={cn('space-y-3', section.label && 'rounded-xl border border-hairline p-3')}>
              {section.label ? (
                <div className="flex items-baseline gap-2 border-b border-hairline pb-2">
                  <h4 className="text-[13px] font-semibold text-ink">{section.label}</h4>
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
            Filled in earlier, not needed now <span className="font-mono font-normal text-ink-muted">{notInPlay.length}</span>
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

/**
 * A set that repeats, as one line: its title, how many it holds and how many
 * of their values wait. Pressed, it lists a row for each record (its title
 * and what its summary fields hold), each opening its own sheet. A shared
 * record is drawn the same way and stays a count until somebody opens it.
 */
/**
 * One period of a sheet, open over the page. An issue reads as it was
 * issued, under a band that says who issued it and that it is read only. A
 * revision still open beside an issue takes values, is worked out as at the
 * period's last day, and is issued in its turn.
 */
function PeriodSheet({
  project,
  catalog,
  period,
  mayEdit,
  mayDecide,
  onClose,
  onAct,
  propsOf,
}: {
  project: DdProject;
  catalog: ReturnType<typeof useFirmCatalog>;
  period: { set: string; key: string; issuedAt?: string } | null;
  mayEdit: boolean;
  mayDecide: boolean;
  onClose: () => void;
  onAct: (set: string, body: { act: 'issue' | 'revise'; period: string }) => void;
  propsOf: (reading: SheetReading, editable: boolean, key: string) => SheetProps;
}) {
  const held = useMemo(() => (period ? readSheetPeriod(project, period.set, period.key, catalog, period.issuedAt) : undefined), [project, period, catalog]);
  // Everything kept of the same period: the issue that stands, one a revision replaced, a revision still open.
  const all = held ? periodsOf(project, held.reading.set.id, new Date(), catalog).filter((kept) => kept.period.key === held.period.key) : [];
  // The issue shown is the one that stands unless a later one was issued for the same period.
  const stands = Boolean(held && all.some((kept) => kept.status === 'issued' && !kept.superseded && kept.issued?.at === held.period.issuedAt));
  const instance = held ? ({ set: held.reading.set.id, id: held.period.key, period: { key: held.period.key, from: held.period.from, to: held.period.to, label: held.reading.title, short: held.period.key }, status: held.period.status, late: false, filled: 0, total: 0, ...(held.period.issuedAt ? { issued: { by: held.period.issuedBy ?? '', at: held.period.issuedAt, ...(held.period.issuedName ? { name: held.period.issuedName } : {}) } } : {}) } satisfies PeriodInstance) : undefined;
  return (
    <Modal open={Boolean(held)} onClose={onClose} title={held ? `${held.reading.set.title} · ${daySaid(held.period.from)} to ${daySaid(held.period.to)}` : ''} width="md">
      {held && instance ? (
        <div data-holder={`${held.reading.set.id}::period`}>
          {held.editable ? (
            <ReadOnlyBand
              action={
                mayDecide ? (
                  <Button size="sm" variant="secondary" onClick={() => onAct(held.reading.set.id, { act: 'issue', period: held.period.key })}>
                    Issue the revision
                  </Button>
                ) : undefined
              }
            >
              <span className="font-semibold">A revision, not issued.</span> Worked out as at {daySaid(held.period.to)}. The period as first issued stands until this is.
            </ReadOnlyBand>
          ) : (
            <ReadOnlyBand
              action={
                mayDecide && stands && !all.some((kept) => kept.status === 'open') ? (
                  <Button size="sm" variant="secondary" onClick={() => onAct(held.reading.set.id, { act: 'revise', period: held.period.key })}>
                    Revise
                  </Button>
                ) : undefined
              }
            >
              <span className="font-semibold">Issued{instance.issued ? ` ${periodIssuedSaid(project, instance).replace(/^.* issued/, '')} on ${daySaid(instance.issued.at)}` : ''}</span> · read only{stands ? '' : ' · since replaced by a revision'}
            </ReadOnlyBand>
          )}
          <SheetBody reading={held.reading} props={propsOf(held.reading, held.editable && mayEdit, held.period.key)} />
        </div>
      ) : null}
    </Modal>
  );
}

function Records({
  set,
  records,
  mayEdit,
  quiet,
  open,
  onToggle,
  onOpen,
  onAdd,
  plan,
}: {
  set: FieldSet;
  records: SheetReading[];
  mayEdit: boolean;
  quiet?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: (record: string) => void;
  onAdd: () => void;
  /** Draw the records as a stack plan above their rows. */
  plan?: boolean;
}) {
  // A record nobody has accepted anything on is not one yet: it is counted apart, and its row says only that it waits.
  const standing = records.filter((record) => !record.pending);
  const offered = records.length - standing.length;
  const waiting = standing.reduce((n, record) => n + record.fields.filter((view) => view.state === 'proposed').length, 0);
  const said = records.length
    ? [standing.length ? String(standing.length) : '', waiting ? `${waiting} to accept` : '', offered ? `${offered} offered by a paper, to accept` : ''].filter(Boolean).join(' · ')
    : quiet
      ? 'None yet'
      : `No ${set.records!.of} yet`;
  return (
    <div data-holder={`${set.id}::`} className="scroll-mt-16">
      <Card>
        <div className="flex items-center gap-2 pr-3">
          <button type="button" aria-expanded={open} disabled={!records.length} onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-sunken/60 disabled:cursor-default disabled:hover:bg-transparent coarse:min-h-11">
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold tracking-tight text-ink">{set.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">{said}</span>
            </span>
            {records.length ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-brand">
                {open ? 'Close' : 'Open'}
                <ChevronRight size={16} className={cn('text-ink-muted transition-transform', open && 'rotate-90')} />
              </span>
            ) : null}
          </button>
          {mayEdit ? (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={onAdd}>
              Add
            </Button>
          ) : null}
        </div>
        {open && records.length ? (
          <CardBody className="border-t border-hairline p-0">
            {plan ? (
              <div className="p-4">
                <StackPlan records={standing} onOpen={onOpen} />
              </div>
            ) : null}
            <ul className="divide-y divide-hairline">
              {records.map((record) => (
                <li key={record.recordId}>
                  <button type="button" onClick={() => onOpen(record.recordId!)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken coarse:min-h-11">
                    <span className={cn('min-w-0 flex-1 truncate text-[13px]', record.pending ? 'text-ink-muted' : 'font-medium text-ink')}>{record.pending ? `${record.title}, offered by a paper and not accepted yet` : record.title}</span>
                    {(record.pending ? [] : record.chips).map((chip) => (
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
    </div>
  );
}
