/**
 * A set kept by period, on a function's page.
 *
 * The set is one line, as every sheet is. Unfolded it shows the open period
 * and nothing else: its records, each with how full it is. One line below
 * opens the past ("September issued by A. Rao · 11 earlier"), and a period
 * nobody kept is said in a sentence. A new period is one press, and opens
 * with what the set carries already filled.
 *
 * A record that is a period opens like any record, with a head above its
 * fields: which period it is and when it is due, or, once issued, a band that
 * says who issued it and that it is read only. The comparison with the period
 * before is under one press, and every line of it is put together by
 * `comparePeriods`.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { OWED_ROLE_LABEL, comparePeriods, daySaid, periodIssuedSaid, type DdProject, type FieldCatalog, type FieldSet, type PeriodInstance, type SetPeriods, type SheetReading } from '@realytica/shared';
import { Button, Card, CardBody, cn } from '../ui/kit';

type PeriodAct = { act: 'open' | 'issue' | 'revise' | 'reason'; record?: string; period?: string; name?: string; field?: string; reason?: string | null };

const fieldsSaid = (filled: number, total: number): string => `${filled} of ${total} ${total === 1 ? 'field' : 'fields'}`;

/** How an instance is named on its row: its period, and what tells it from another in the period. */
const instanceSaid = (instance: PeriodInstance): string => `${instance.period.label}${instance.perSaid ? ` · ${instance.perSaid}` : ''}${instance.revises && instance.status === 'open' ? ' · revision' : ''}`;

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
}) {
  const [past, setPast] = useState(false);
  const inPeriod = new Set([...periods.open, ...periods.past].map((instance) => instance.record));
  // A record that names no period yet: a certificate given once, or one just added.
  const loose = records.filter((record) => !inPeriod.has(record.recordId));
  const listed = new Set(records.map((record) => record.recordId));
  const filled = periods.open.reduce((sum, instance) => sum + instance.filled, 0);
  const total = periods.open.reduce((sum, instance) => sum + instance.total, 0);
  const said = periods.open.length
    ? `${periods.shown!.label} · ${fieldsSaid(filled, total)}${periods.open[0]!.due ? ` · due ${daySaid(periods.open[0]!.due)}` : ''}`
    : periods.pastSaid
      ? periods.pastSaid
      : loose.length
        ? `${loose.length} with no period yet`
        : `No ${set.records!.of} yet`;
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
            periods.toOpen ? (
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
            {periods.pastSaid ? (
              <div className="border-t border-hairline">
                <button type="button" aria-expanded={past} onClick={() => setPast((was) => !was)} data-period-past className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[12px] text-ink-secondary hover:bg-sunken coarse:min-h-11">
                  <span className="min-w-0 truncate">{periods.pastSaid}</span>
                  <ChevronRight size={14} aria-hidden className={cn('shrink-0 text-ink-muted transition-transform', past && 'rotate-90')} />
                </button>
                {past ? (
                  <ul className="divide-y divide-hairline border-t border-hairline">
                    {periods.past.map((instance) => {
                      const reachable = listed.has(instance.record);
                      const row = (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{periodIssuedSaid(project, instance)}</span>
                          <span className="text-[12px] text-ink-muted">
                            {instance.superseded ? 'kept as issued, replaced by a revision' : `${daySaid(instance.issued!.at)}${instance.late ? ' · late' : ''}`}
                          </span>
                        </>
                      );
                      return (
                        <li key={instance.record}>
                          {reachable ? (
                            <button type="button" onClick={() => onOpen(instance.record!)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-sunken coarse:min-h-11">
                              {row}
                              <ChevronRight size={14} aria-hidden className="text-ink-muted" />
                            </button>
                          ) : (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
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
  const outside = set.periodic && set.periodic.issuer !== 'lead' && set.periodic.issuer !== 'signer' ? set.periodic.issuer : undefined;
  const comparison = useMemo(() => {
    try {
      return comparePeriods(project, set.id, instance.record!, undefined, new Date(), catalog);
    } catch {
      return undefined;
    }
  }, [project, set.id, instance.record, catalog]);
  const moved = comparison?.fields.filter((field) => field.moved || field.unexplained) ?? [];
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
      {comparison?.previous ? (
        <div className="rounded-lg border border-hairline">
          <button type="button" aria-expanded={comparing} onClick={() => setComparing((was) => !was)} data-period-compare className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] text-ink-secondary hover:bg-sunken coarse:min-h-11">
            <span>{comparison.said}</span>
            <ChevronRight size={14} aria-hidden className={cn('shrink-0 text-ink-muted transition-transform', comparing && 'rotate-90')} />
          </button>
          {comparing ? (
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
                      <p className="flex flex-wrap items-center gap-2 text-[var(--status-warning-text)]">
                        <span>{field.unexplainedSaid}</span>
                        {issued || !mayEdit ? (
                          <span className="text-ink-muted">{field.reasonSaid ?? 'no reason picked'}</span>
                        ) : (
                          <select
                            aria-label={`Why ${field.label} is not explained`}
                            value={field.reason ?? ''}
                            onChange={(event) => onAct({ act: 'reason', record: instance.record, field: field.key, reason: event.target.value || null })}
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
                      </p>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-[12px] text-ink-muted">Nothing moved since {comparison.previous.period.short}.</li>
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
