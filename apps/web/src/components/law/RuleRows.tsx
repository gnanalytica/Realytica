/**
 * The statutory rule rows, as a list to check.
 *
 * Every figure a regulation sets (a deposit share, a consent share, a cap on
 * an advance) is a row of the rule table, and every row is unverified until
 * somebody has read it in its instrument. A figure worked out from one says
 * "rule not checked" wherever it shows. This is where a firm admin goes down
 * the rows: each by the department whose fields read it, with what it is
 * said to be, where it is said to be written and which fields rest on it.
 * Checking one takes the clause it was read in and the day it was read; it
 * is then that firm's row, checked by name.
 *
 * Folded until opened: the page is about what changed in the law, and this is
 * the standing table behind it.
 */

import { useEffect, useState } from 'react';
import { daySaid, dayTyped, type RuleRowGroup, type RuleRowListed } from '@realytica/shared';
import { lawWatchApi, type RuleRowsShown } from '../../lib/law-watch-api';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, useToast } from '../ui/kit';

const rowId = (row: RuleRowListed): string => JSON.stringify(row.ref);
const today = (): string => daySaid(new Date());

export function RuleRows() {
  const toast = useToast();
  const [data, setData] = useState<RuleRowsShown | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [clause, setClause] = useState('');
  const [readOn, setReadOn] = useState(today());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    lawWatchApi
      .ruleRows()
      .then((shown) => alive && setData(shown))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed || !data) return null;

  const check = async (row: RuleRowListed) => {
    const day = dayTyped(readOn);
    if (!clause.trim() || !day) {
      toast('Give the clause the figure was read in, and the day it was read as 13 Oct 2026.', 'critical');
      return;
    }
    setBusy(true);
    try {
      setData(await lawWatchApi.checkRuleRow({ row: row.ref, clause: clause.trim(), readOn: day }));
      setChecking(null);
      setClause('');
      toast('Marked checked', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That could not be marked', 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Rule rows" subtitle={`${data.verified} of ${data.total} checked against the instrument. A figure worked out from an unchecked row says so wherever it shows.`} />
      <CardBody className="space-y-2">
        {data.groups.map((group: RuleRowGroup) => (
          <details key={group.department} open={open === group.department} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open ? group.department : open === group.department ? null : open)}>
            <summary className="flex cursor-pointer select-none items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-[13px] font-medium text-ink hover:bg-sunken coarse:min-h-11">
              <span>{group.label}</span>
              <span className="font-mono text-[12px] font-normal text-ink-muted">
                {group.verified} of {group.rows.length} checked
              </span>
            </summary>
            {open === group.department ? (
              <ul className="divide-y divide-hairline border-t border-hairline">
                {group.rows.map((row) => (
                  <li key={rowId(row)} className="space-y-1 px-2 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 text-[13px] text-ink">
                        {row.label}:{' '}
                        <span className="font-mono tabular-nums">
                          {row.value.toLocaleString('en-IN')}
                          {row.unit ? ` ${row.unit}` : ''}
                        </span>
                      </p>
                      {row.verified ? <Badge tone="good">Checked</Badge> : <Badge tone="warning">Not checked</Badge>}
                    </div>
                    <p className="text-[12px] leading-snug text-ink-muted">
                      {row.citation}. In force from {daySaid(row.from)}
                      {row.to ? ` to ${daySaid(row.to)}` : ''}
                      {[row.jurisdiction.state, row.jurisdiction.city, row.jurisdiction.authority].filter(Boolean).length ? `, ${[row.jurisdiction.authority, row.jurisdiction.city, row.jurisdiction.state].filter(Boolean).join(', ')}` : ''}.
                    </p>
                    {row.readBy.length ? (
                      <p className="text-[12px] leading-snug text-ink-muted">
                        Read by: {row.readBy.slice(0, 4).map((reader) => `${reader.label} (${reader.setTitle})`).join('; ')}
                        {row.readBy.length > 4 ? ` and ${row.readBy.length - 4} more` : ''}.
                      </p>
                    ) : null}
                    {row.verified ? (
                      <p className="text-[12px] text-ink-muted">
                        Checked{row.verifiedBy ? ` by ${row.verifiedBy}` : ''}
                        {row.verifiedOn ? `, ${daySaid(row.verifiedOn)}` : ''}.
                      </p>
                    ) : data.mayCheck ? (
                      checking === rowId(row) ? (
                        <div className="grid grid-cols-1 items-end gap-2 pt-1 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto]">
                          <Field label="Clause it was read in">
                            <Input value={clause} onChange={(e) => setClause(e.target.value)} placeholder="e.g. section 4(2)(l)(D)" />
                          </Field>
                          <Field label="Read on">
                            <Input value={readOn} onChange={(e) => setReadOn(e.target.value)} placeholder="dd Mon yyyy" />
                          </Field>
                          <Button size="sm" variant="primary" loading={busy} onClick={() => void check(row)}>
                            Mark checked
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChecking(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setChecking(rowId(row));
                            setClause(row.source.clause ?? '');
                            setReadOn(today());
                          }}
                        >
                          I have read it in the instrument
                        </Button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        ))}
        {!data.mayCheck ? <p className="px-2 text-[12px] text-ink-muted">A firm admin marks a row checked.</p> : null}
      </CardBody>
    </Card>
  );
}
