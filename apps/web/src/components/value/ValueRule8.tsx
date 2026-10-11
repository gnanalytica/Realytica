import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Rule8Item, Rule8Summary, ValuationRun } from '@realytica/shared';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, cn, type Tone } from '../ui/kit';

const TONE: Record<'stated' | 'partial' | 'missing', Tone> = {
  stated: 'good',
  partial: 'warning',
  missing: 'critical',
};
const WORD = { stated: 'Stated', partial: 'Partial', missing: 'Missing' } as const;

/**
 * IBBI Rule 8(3) report contents — computed completeness with next steps.
 *
 * Identity and conflict cannot be invented; they are recorded here. Inspections
 * and sources jump to Site and Documents. The rest fill when a valuation is recorded.
 */
export function ValueRule8({
  projectId,
  rule8,
  run,
  busy,
  onSaveValuer,
}: {
  projectId: string;
  rule8: Rule8Summary | null;
  run?: ValuationRun;
  busy: boolean;
  onSaveValuer: (body: {
    valuer: { name: string; registrationNumber?: string; registeredFor?: string; firm?: string };
    declaredConflict: boolean;
    interests?: string[];
    appointedOn?: string;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const held = run?.ibbi.rule8?.valuer;
  const conflict = run?.ibbi.rule8?.conflict;
  const [name, setName] = useState(held?.name ?? '');
  const [registration, setRegistration] = useState(held?.registrationNumber ?? '');
  const [firm, setFirm] = useState(held?.firm ?? '');
  const [registeredFor, setRegisteredFor] = useState(held?.registeredFor ?? '');
  const [appointedOn, setAppointedOn] = useState(run?.ibbi.rule8?.appointedOn ?? '');
  const [declaredConflict, setDeclaredConflict] = useState(conflict?.declared ?? false);
  const [interests, setInterests] = useState((conflict?.interests ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [showStated, setShowStated] = useState(false);
  const openRows = rule8?.rows.filter((r) => r.status !== 'stated') ?? [];
  const statedRows = rule8?.rows.filter((r) => r.status === 'stated') ?? [];

  async function save() {
    setError(null);
    const list = interests
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await onSaveValuer({
        valuer: {
          name: name.trim(),
          ...(registration.trim() ? { registrationNumber: registration.trim() } : {}),
          ...(firm.trim() ? { firm: firm.trim() } : {}),
          ...(registeredFor.trim() ? { registeredFor: registeredFor.trim() } : {}),
        },
        declaredConflict,
        ...(declaredConflict && list.length ? { interests: list } : {}),
        ...(appointedOn.trim() ? { appointedOn: appointedOn.trim() } : {}),
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  return (
    <div id="value-rule8" className="scroll-mt-3">
    <Card>
      <CardHeader
        title="IBBI Rule 8(3)"
        subtitle={rule8 ? undefined : 'Record a valuation'}
        info={rule8?.say}
        action={
          rule8 ? (
            <span className="font-mono text-mini tabular-nums text-ink-secondary">
              {rule8.stated}/{rule8.total}
              {rule8.missing ? ` · ${rule8.missing} open` : ''}
            </span>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {!rule8 ? (
          <p className="text-[13px] text-ink-muted">Accept inputs or record a valuation.</p>
        ) : (
          <>
            <div className="flex h-2 gap-px overflow-hidden rounded-full" aria-hidden title={rule8.say}>
              {rule8.rows.map((row) => (
                <span
                  key={row.item}
                  className={cn(
                    'h-full flex-1',
                    row.status === 'stated' ? 'bg-good' : row.status === 'partial' ? 'bg-warning' : 'bg-critical/60',
                  )}
                />
              ))}
            </div>
            <ul className="divide-y divide-hairline rounded-xl ring-1 ring-inset ring-[var(--ring)]">
              {openRows.map((row) => (
                <li key={row.item} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-10 shrink-0 font-mono text-micro text-ink-muted">{row.clause}</span>
                  <Badge tone={TONE[row.status]} className="shrink-0">
                    {WORD[row.status]}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={row.note ?? row.says}>
                    {row.says}
                  </span>
                  <Rule8Action
                    item={row.item}
                    status={row.status}
                    projectId={projectId}
                    hasRun={Boolean(run)}
                    onEditValuer={() => setEditing(true)}
                  />
                </li>
              ))}
            </ul>
            {statedRows.length ? (
              <button
                type="button"
                onClick={() => setShowStated((v) => !v)}
                className="text-[12px] font-medium text-ink-muted hover:text-brand"
              >
                {showStated ? 'Hide' : 'Show'} {statedRows.length} stated
              </button>
            ) : null}
            {showStated ? (
              <ul className="divide-y divide-hairline rounded-xl ring-1 ring-inset ring-[var(--ring)]">
                {statedRows.map((row) => (
                  <li key={row.item} className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink-muted">
                    <span className="w-10 font-mono text-micro">{row.clause}</span>
                    <Badge tone="good">{WORD.stated}</Badge>
                    <span className="truncate">{row.says}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        {(editing || (!held && run)) && run ? (
          <div className="space-y-3 rounded-xl bg-sunken/50 p-3 ring-1 ring-inset ring-[var(--ring)]">
            <p className="text-[13px] font-medium text-ink">Valuer and conflict disclosure</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Registered valuer’s name" />
              </Field>
              <Field label="IBBI registration">
                <Input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="IBBI/RV/…" />
              </Field>
              <Field label="Firm / appointing authority">
                <Input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Firm or appointing authority" />
              </Field>
              <Field label="Registered for">
                <Input value={registeredFor} onChange={(e) => setRegisteredFor(e.target.value)} placeholder="Land & Building" />
              </Field>
              <Field label="Date of appointment">
                <Input type="date" value={appointedOn} onChange={(e) => setAppointedOn(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={declaredConflict}
                onChange={(e) => setDeclaredConflict(e.target.checked)}
              />
              <span title="Unchecked = declare none. Absent is not a nil disclosure.">Interest / conflict</span>
            </label>
            {declaredConflict ? (
              <Field label="Interests (one per line)">
                <textarea
                  value={interests}
                  onChange={(e) => setInterests(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink"
                />
              </Field>
            ) : null}
            {error ? <p className="text-[12px] text-critical">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void save()} loading={busy} disabled={!name.trim()}>
                Save disclosure
              </Button>
              {editing ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : held ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken/40 px-3 py-2 text-[12px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
            <span>
              <span className="font-medium text-ink">{held.name}</span>
              {held.registrationNumber ? ` · ${held.registrationNumber}` : ''}
              {conflict ? (conflict.declared ? ` · ${conflict.interests.length} interest(s)` : ' · no interest declared') : ''}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
    </div>
  );
}

function Rule8Action({
  item,
  status,
  projectId,
  hasRun,
  onEditValuer,
}: {
  item: Rule8Item;
  status: 'stated' | 'partial' | 'missing';
  projectId: string;
  hasRun: boolean;
  onEditValuer: () => void;
}) {
  if (status === 'stated') return null;

  const link = 'shrink-0 text-[12px] font-medium text-brand hover:underline';
  if (item === 'identity' || item === 'conflict' || item === 'purpose' || item === 'dates') {
    if (!hasRun) return <span className="shrink-0 text-[12px] text-ink-muted">Record first</span>;
    return (
      <button type="button" onClick={onEditValuer} className={link}>
        Record
      </button>
    );
  }
  if (item === 'inspections') {
    return (
      <Link to={`/projects/${projectId}/visits`} className={link}>
        Site
      </Link>
    );
  }
  if (item === 'sources') {
    return (
      <Link to={`/projects/${projectId}/evidence`} className={link}>
        Documents
      </Link>
    );
  }
  if (item === 'background') {
    return (
      <a href="#value-approaches" className={link}>
        Property
      </a>
    );
  }
  return null;
}
