/**
 * A set kept by period, on a function's page.
 *
 * The set is one line, as every sheet is. Unfolded it shows the open period
 * and nothing else: its records, each with how full it is. One line below
 * opens the past ("September issued by A. Rao · 11 earlier"), and a period
 * nobody kept is said in a sentence. A new period is one press, and opens
 * with what the set carries already filled.
 *
 * A set nobody has kept yet says so in one quiet line ("No period kept yet ·
 * Start with October 2026"), and starting it is what begins its due cycle.
 * The line that opens the past opens a short list, newest first, each period
 * with its status and who issued it; beside that line is the one control
 * that reads the function's sheets as at a past day.
 *
 * A record that is a period opens like any record, with a head above its
 * fields: which period it is and when it is due, or, once issued, a band that
 * says who issued it and that it is read only. The comparison with the period
 * before is under one press, and every line of it is put together by
 * `comparePeriods`.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { OWED_ROLE_LABEL, comparePeriods, compareSheetPeriods, daySaid, isPastDay, periodAsNowSaid, periodIssuedSaid, type DdProject, type FieldCatalog, type FieldSet, type PeriodComparison, type PeriodInstance, type SetPeriods, type SheetReading } from '@realytica/shared';
import { Button, Card, CardBody, cn } from '../ui/kit';

type PeriodAct = { act: 'open' | 'issue' | 'revise' | 'reason'; record?: string; period?: string; name?: string; field?: string; reason?: string | null };

const fieldsSaid = (filled: number, total: number): string => `${filled} of ${total} ${total === 1 ? 'field' : 'fields'}`;

/** How an instance is named on its row: its period, and what tells it from another in the period. */
const instanceSaid = (instance: PeriodInstance): string => `${instance.period.label}${instance.perSaid ? ` · ${instance.perSaid}` : ''}${instance.revises && instance.status === 'open' ? ' · revision' : ''}`;

/** What reading the sheets as at a past day takes: the day picked, and how it is changed. */
export interface AsAtChoice {
  day: string | null;
  onPick: (day: string | null) => void;
}

/**
 * The one control that reads a function's sheets as at a past day. It sits
 * beside the line that opens a set's past, and the day picked holds across
 * the function's parts until it is taken back.
 */
export function AsAtPick({ asAt }: { asAt: AsAtChoice }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary" data-asat-pick>
      As at
      <input
        type="date"
        aria-label="Read these sheets as at a past day"
        value={asAt.day ?? ''}
        max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}
        onChange={(event) => asAt.onPick(event.target.value && isPastDay(event.target.value) ? event.target.value : null)}
        className="h-7 rounded-md border border-hairline bg-surface px-1.5 text-[12px] text-ink coarse:h-11"
      />
    </label>
  );
}

/** How an instance stands, in a word or two: what its row in the list of periods says after its name. */
function statusSaid(instance: PeriodInstance): string {
  if (instance.status === 'open') return instance.revises ? 'Revision, not issued' : 'Open';
  if (instance.superseded) return 'Replaced by a revision';
  return instance.late ? 'Issued late' : 'Issued';
}

/**
 * The periods a set has kept, newest first: each with its status, who issued
 * it and when. Picking one opens it, read only under its band.
 */
function PastList({ project, instances, onOpen }: { project: DdProject; instances: readonly PeriodInstance[]; onOpen?: (instance: PeriodInstance) => void }) {
  return (
    <ul className="divide-y divide-hairline border-t border-hairline" data-period-list>
      {instances.map((instance) => {
        const who = instance.issued ? periodIssuedSaid(project, instance).replace(/^.*? issued( by )?/, '').replace(/, revised$/, '') : '';
        const row = (
          <>
            {/* Never cut short: on a phone the row wraps, and the period is still said in full. */}
            <span className="min-w-[8rem] flex-1 text-[13px] text-ink">
              {instance.period.label}
              {instance.perSaid ? ` · ${instance.perSaid}` : ''}
            </span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px]', instance.status === 'issued' && !instance.superseded ? 'bg-sunken text-ink-secondary' : 'text-ink-muted')}>{statusSaid(instance)}</span>
            <span className="text-[12px] text-ink-muted">{[who, instance.issued ? daySaid(instance.issued.at) : ''].filter(Boolean).join(' · ')}</span>
          </>
        );
        return (
          <li key={`${instance.id}-${instance.record ?? ''}-${instance.issued?.at ?? 'open'}`}>
            {onOpen ? (
              <button type="button" onClick={() => onOpen(instance)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-sunken coarse:min-h-11">
                {row}
                <ChevronRight size={14} aria-hidden className="text-ink-muted" />
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The line that opens a set's past, with the as-at control beside it. The
 * line is a press where anything is issued; the control is there whenever
 * the sheets can be read as at a day.
 */
function PastLine({ said, open, onToggle, asAt }: { said?: string; open: boolean; onToggle: () => void; asAt?: AsAtChoice }) {
  if (!said && !asAt) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5" data-period-line>
      {said ? (
        <button type="button" aria-expanded={open} onClick={onToggle} data-period-past className="flex min-w-[12rem] flex-1 items-center gap-2 py-1 text-left text-[12px] text-ink-secondary hover:text-ink coarse:min-h-11">
          <ChevronRight size={14} aria-hidden className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-90')} />
          <span className="min-w-0 truncate">{said}</span>
        </button>
      ) : (
        <span />
      )}
      {asAt ? <AsAtPick asAt={asAt} /> : null}
    </div>
  );
}

/** The one quiet line of a set nobody has kept yet, and the press that starts it. */
function FirstPeriod({ first, mayEdit, onStart }: { first: NonNullable<SetPeriods['first']>; mayEdit: boolean; onStart: (period: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-ink-muted" data-period-first>
      {/* The line is the model's own ("No period kept yet · Start with October 2026"): where the reader may start it, its second half is the press. */}
      <span>{mayEdit ? first.said.split(' · ')[0] : first.said}</span>
      {mayEdit ? (
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onStart(first.start.key)}>
            Start with {first.start.label}
          </Button>
          <button type="button" className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11" onClick={() => onStart(first.earlier.key)}>
            or {first.earlier.short}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/** A periodic set as one line that unfolds to its open period. */
export function PeriodRecords({
  project,
  set,
  records,
  periods,
  mayEdit,
  open,
  onToggle,
  onOpen,
  onAdd,
  onAct,
  asAt,
}: {
  project: DdProject;
  set: FieldSet;
  records: SheetReading[];
  periods: SetPeriods;
  mayEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: (record: string) => void;
  onAdd: () => void;
  onAct: (body: PeriodAct) => void;
  /** The day the function's sheets are read as at, and how it is picked: drawn beside the line that opens the past. */
  asAt?: AsAtChoice;
}) {
  const [past, setPast] = useState(false);
  const inPeriod = new Set([...periods.open, ...periods.past].map((instance) => instance.record));
  // A record that names no period yet: a certificate given once, or one just added.
  const loose = records.filter((record) => !inPeriod.has(record.recordId));
  const listed = new Set(records.map((record) => record.recordId));
  const filled = periods.open.reduce((sum, instance) => sum + instance.filled, 0);
  const total = periods.open.reduce((sum, instance) => sum + instance.total, 0);
  const said = periods.open.length
    ? `${periods.shown!.label} · ${fieldsSaid(filled, total)}${periods.open[0]!.due ? ` · ${periods.open[0]!.late ? 'was due' : 'due'} ${daySaid(periods.open[0]!.due)}` : ''}`
    : periods.pastSaid
      ? periods.pastSaid
      : loose.length
        ? `${loose.length} with no period yet`
        : (periods.first?.said.split(' · ')[0] ?? `No ${set.records!.of} yet`);
  const any = periods.open.length + periods.past.length + loose.length > 0;
  return (
    <div data-holder={`${set.id}::`} data-periodic={set.id} className="scroll-mt-16">
      <Card>
        <div className="flex items-center gap-2 pr-3">
          <button type="button" aria-expanded={open} disabled={!any} onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-sunken/60 disabled:cursor-default disabled:hover:bg-transparent coarse:min-h-11">
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold tracking-tight text-ink">{set.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-secondary">{said}</span>
            </span>
            {any ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-brand">
                {open ? 'Close' : 'Open'}
                <ChevronRight size={16} className={cn('text-ink-muted transition-transform', open && 'rotate-90')} />
              </span>
            ) : null}
          </button>
          {mayEdit ? (
            periods.first && !loose.length ? (
              // Nothing kept yet: one press starts the set on a period, and that is what begins its due cycle.
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2" data-period-first>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onAct({ act: 'open', period: periods.first!.start.key })}>
                  Start with {periods.first.start.label}
                </Button>
                <button type="button" className="text-[12px] font-medium text-brand hover:underline coarse:min-h-11" onClick={() => onAct({ act: 'open', period: periods.first!.earlier.key })}>
                  or {periods.first.earlier.short}
                </button>
              </span>
            ) : periods.toOpen ? (
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onAct({ act: 'open', period: periods.toOpen!.key })}>
                Open {periods.toOpen.short}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={onAdd}>
                Add
              </Button>
            )
          ) : null}
        </div>
        {open && any ? (
          <CardBody className="border-t border-hairline p-0">
            <ul className="divide-y divide-hairline" data-period-open>
              {periods.open.map((instance) => (
                <li key={instance.record}>
                  <button type="button" onClick={() => onOpen(instance.record!)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken coarse:min-h-11">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{instanceSaid(instance)}</span>
                    {instance.carried ? <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary">{`${instance.carried.keys.length} carried from ${instance.carried.from}`}</span> : null}
                    <span className="text-[12px] text-ink-secondary">{fieldsSaid(instance.filled, instance.total)}</span>
                    <ChevronRight size={14} aria-hidden className="text-ink-muted" />
                  </button>
                </li>
              ))}
              {loose.map((record) => (
                <li key={record.recordId}>
                  <button type="button" onClick={() => onOpen(record.recordId!)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-sunken coarse:min-h-11">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{record.title}</span>
                    <span className="text-[12px] text-ink-muted">no period yet</span>
                    <ChevronRight size={14} aria-hidden className="text-ink-muted" />
                  </button>
                </li>
              ))}
            </ul>
            {periods.pastSaid || asAt ? (
              <div className="border-t border-hairline px-1">
                <PastLine said={periods.pastSaid} open={past} onToggle={() => setPast((was) => !was)} asAt={asAt} />
                {past && periods.pastSaid ? <PastList project={project} instances={periods.past} onOpen={(instance) => (listed.has(instance.record) ? onOpen(instance.record!) : undefined)} /> : null}
              </div>
            ) : null}
            {periods.notKeptSaid ? <p className="border-t border-hairline px-4 py-2 text-[12px] text-ink-muted">{periods.notKeptSaid}</p> : null}
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * What stands above a period's fields: which period it is and what may be
 * done with it. An issued period is headed by a band that stays in view and
 * says it is read only.
 */
export function PeriodHead({
  project,
  set,
  instance,
  catalog,
  mayEdit,
  mayDecide,
  onAct,
}: {
  project: DdProject;
  set: FieldSet;
  instance: PeriodInstance;
  catalog: FieldCatalog;
  mayEdit: boolean;
  mayDecide: boolean;
  onAct: (body: PeriodAct) => void;
}) {
  const [comparing, setComparing] = useState(false);
  const [name, setName] = useState('');
  const issued = instance.status === 'issued';
  // Which of its figures are the day of issue's and not the period-end's, where the record keeps no past that far.
  const asNow = issued ? periodAsNowSaid(project, set, instance.record) : undefined;
  const outside = set.periodic && set.periodic.issuer !== 'lead' && set.periodic.issuer !== 'signer' ? set.periodic.issuer : undefined;
  const comparison = useMemo(() => {
    try {
      return comparePeriods(project, set.id, instance.record!, undefined, new Date(), catalog);
    } catch {
      return undefined;
    }
  }, [project, set.id, instance.record, catalog]);
  return (
    <div className="mb-3 space-y-2" data-period-head>
      {issued ? (
        <div role="status" data-period-band className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-sunken px-3 py-2 text-[12px] text-ink">
          <span>
            <span className="font-semibold">{periodIssuedSaid(project, instance)}</span>
            {instance.issued ? ` on ${daySaid(instance.issued.at)}` : ''}
            {instance.late ? ', after it was due' : ''} · read only
          </span>
          {mayDecide && !instance.superseded ? (
            <Button size="sm" variant="secondary" onClick={() => onAct({ act: 'revise', record: instance.record })}>
              Revise
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-secondary">
          <span>
            <span className="font-semibold text-ink">{instance.period.label}</span>
            {instance.revises ? ' · a revision of the issued one, which stands until this is issued' : ''}
            {` · ${fieldsSaid(instance.filled, instance.total)}`}
            {instance.due ? ` · ${instance.late ? 'was due' : 'due'} ${daySaid(instance.due)}` : ''}
          </span>
          {mayDecide ? (
            <span className="flex flex-wrap items-center gap-2">
              {outside ? (
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Signed by: ${OWED_ROLE_LABEL[outside].toLowerCase()}’s name`}
                  aria-label={`The name ${OWED_ROLE_LABEL[outside].toLowerCase()} signed it under`}
                  maxLength={120}
                  className="h-7 w-48 rounded-md border border-hairline bg-surface px-2 text-[12px] text-ink coarse:h-11"
                />
              ) : null}
              <Button size="sm" variant="secondary" disabled={Boolean(outside) && !name.trim()} onClick={() => onAct({ act: 'issue', record: instance.record, ...(name.trim() ? { name: name.trim() } : {}) })}>
                Issue
              </Button>
            </span>
          ) : null}
        </div>
      )}
      {issued && asNow ? (
        <p className="text-[12px] text-ink-muted" data-period-asnow>
          Read as at {daySaid(instance.period.to)}. {asNow}.
        </p>
      ) : null}
      {comparison?.previous ? <Comparison comparison={comparison} label={issued ? 'Compare with the one before' : undefined} locked={issued || !mayEdit} onReason={(field, reason) => onAct({ act: 'reason', record: instance.record, field, reason })} /> : null}
    </div>
  );
}

/** One period beside the one before it, under one press: each figure that moved in a line, what explains it, and what is left to pick a reason for. */
export function Comparison({ comparison, locked, onReason, label }: { comparison: PeriodComparison; locked: boolean; onReason: (field: string, reason: string | null) => void; /** What the press is called, before what it found. */ label?: string }) {
  const [open, setOpen] = useState(false);
  const moved = comparison.fields.filter((field) => field.moved || field.unexplained);
  return (
    <div className="rounded-lg border border-hairline">
      <button type="button" aria-expanded={open} onClick={() => setOpen((was) => !was)} data-period-compare className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] text-ink-secondary hover:bg-sunken coarse:min-h-11">
        <span>
          {label ? <span className="font-medium text-ink">{label}</span> : null}
          {label ? ' · ' : ''}
          {comparison.said}
        </span>
        <ChevronRight size={14} aria-hidden className={cn('shrink-0 text-ink-muted transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <ul className="divide-y divide-hairline border-t border-hairline" data-period-comparison>
          {moved.length ? (
            moved.map((field) => (
              <li key={field.key} className="space-y-0.5 px-3 py-2 text-[12px]">
                <p className="text-ink">
                  <span className="font-medium">{field.label}</span> · {field.said}
                </p>
                {(field.causes ?? []).map((cause) => (
                  <p key={cause.label} className="text-ink-muted">
                    {cause.said}
                  </p>
                ))}
                {field.unexplainedSaid ? (
                  <div className="flex flex-wrap items-center gap-2 text-[var(--status-warning-text)]">
                    <span>{field.unexplainedSaid}</span>
                    {locked ? (
                      <span className="text-ink-muted">{field.reasonSaid ?? 'no reason picked'}</span>
                    ) : (
                      <select
                        aria-label={`Why ${field.label} is not explained`}
                        value={field.reason ?? ''}
                        onChange={(event) => onReason(field.key, event.target.value || null)}
                        className="h-7 rounded-md border border-hairline bg-surface px-1.5 text-[12px] text-ink coarse:h-11"
                      >
                        <option value="">Pick why…</option>
                        {comparison.reasons.map((reason) => (
                          <option key={reason.key} value={reason.key}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-[12px] text-ink-muted">Nothing moved since {comparison.previous!.period.short}.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What stands above the fields of a sheet kept by period: the period the
 * sheet is open on and what it carried, the comparison with the last period
 * issued, the one line that opens the past, and the press that issues the
 * period just ended.
 */
export function SheetPeriodsBar({
  project,
  set,
  periods,
  catalog,
  mayEdit,
  mayDecide,
  onAct,
  onOpenPeriod,
  asAt,
}: {
  project: DdProject;
  set: FieldSet;
  periods: SetPeriods;
  catalog: FieldCatalog;
  mayEdit: boolean;
  mayDecide: boolean;
  onAct: (body: PeriodAct) => void;
  onOpenPeriod: (instance: PeriodInstance) => void;
  /** The day the function's sheets are read as at, and how it is picked: drawn beside the line that opens the past. */
  asAt?: AsAtChoice;
}) {
  const [past, setPast] = useState(false);
  const comparison = useMemo(() => {
    try {
      return compareSheetPeriods(project, set.id, undefined, new Date(), catalog);
    } catch {
      return undefined;
    }
  }, [project, set.id, catalog]);
  const revisions = periods.open;
  const pastSaid = periods.pastSaid ?? (revisions.length ? `${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'} open` : undefined);
  return (
    <div className="mb-4 space-y-2" data-sheet-periods={set.id}>
      {periods.first ? (
        <FirstPeriod first={periods.first} mayEdit={mayEdit} onStart={(period) => onAct({ act: 'open', period })} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-secondary">
          <span>
            <span className="font-semibold text-ink">{periods.shown?.label}</span>
            {periods.carried ? ` · ${periods.carried.keys.length} carried from ${periods.carried.from}` : ''}
            {periods.due?.due ? ` · ${periods.due.period.short} ${periods.due.late ? 'was due' : 'due'} ${daySaid(periods.due.due)}` : ''}
          </span>
          {mayDecide && periods.toIssue ? (
            <Button size="sm" variant="secondary" onClick={() => onAct({ act: 'issue', period: periods.toIssue!.key })}>
              Issue {periods.toIssue.short}
            </Button>
          ) : null}
        </div>
      )}
      {comparison?.previous ? <Comparison comparison={comparison} locked={!mayEdit} onReason={(field, reason) => onAct({ act: 'reason', field, reason })} /> : null}
      {/* A sheet nobody has started has no past to open, and no day to be read as at. */}
      {pastSaid || (asAt && !periods.first) ? (
        <div className="rounded-lg border border-hairline">
          <PastLine said={pastSaid} open={past} onToggle={() => setPast((was) => !was)} asAt={asAt} />
          {past && pastSaid ? <PastList project={project} instances={[...revisions, ...periods.past]} onOpen={onOpenPeriod} /> : null}
        </div>
      ) : null}
      {periods.notKeptSaid ? <p className="text-[12px] text-ink-muted">{periods.notKeptSaid}</p> : null}
    </div>
  );
}

/** The band that heads anything read as at a past day, or as a period was issued: what it is, that it is read only, and the one thing that may be done. */
export function ReadOnlyBand({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" data-asat-band className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-sunken px-3 py-2 text-[12px] text-ink">
      <span>{children}</span>
      {action}
    </div>
  );
}
