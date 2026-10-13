import { X } from 'lucide-react';
import {
  LAW_AFFECTS_AT_MOST,
  LAW_CHANGE_TYPES,
  LAW_CHANGE_TYPE_LABEL,
  LAW_INSTRUMENTS,
  LAW_INSTRUMENT_LABEL,
  LAW_REFERENCE,
  LAW_UNITS,
  lawAboutSaid,
  lawChangeSaid,
  lawRuleRowRef,
  type LawAbout,
  type LawChangeFields,
  type LawChangeType,
  type LawFigure,
  type LawInstrument,
  type LawLists,
  type LawUnit,
} from '@realytica/shared';
import { Field, Input, Select } from '../ui/kit';

/**
 * A change on a watched page as its fields: read, and edited before a
 * person confirms. Every box is a pick off a list, a day, a number or a
 * reference copied from the page. There is no box for a sentence.
 */

const UNIT_LABEL: Record<LawUnit, string> = { percent: '%', rupees: 'Rs', rupees_per_sqm: 'Rs a sq m', rupees_per_sqft: 'Rs a sq ft', days: 'days', months: 'months', years: 'years', ratio: 'ratio', sqm: 'sq m', m: 'm' };

export const aboutKey = (about: LawAbout): string => JSON.stringify(about);

/** Every thing a change may be said to affect, from the lists for its source. */
export function aboutChoices(lists: LawLists): Array<{ group: string; about: LawAbout; label: string }> {
  return [
    ...lists.rows.map((held) => ({ group: 'Rule rows', about: { kind: 'rule_row', row: lawRuleRowRef(held.row) } as LawAbout, label: held.label })),
    ...lists.approvals.map((held) => ({ group: 'Approvals', about: { kind: 'approval', approval: held.key } as LawAbout, label: held.label })),
    ...lists.fields.map((held) => ({ group: 'Fields', about: { kind: 'field', address: held.address } as LawAbout, label: held.label })),
  ];
}

export function AboutSelect({ label, value, choices, onChange, none }: { label: string; value: LawAbout | undefined; choices: ReturnType<typeof aboutChoices>; onChange: (next: LawAbout | undefined) => void; none: string }) {
  const groups = [...new Set(choices.map((choice) => choice.group))];
  return (
    <Select aria-label={label} value={value ? aboutKey(value) : ''} className="min-w-0 flex-1 basis-48" onChange={(e) => onChange(choices.find((choice) => aboutKey(choice.about) === e.target.value)?.about)}>
      <option value="">{none}</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {choices
            .filter((choice) => choice.group === group)
            .map((choice) => (
              <option key={aboutKey(choice.about)} value={aboutKey(choice.about)}>
                {choice.label}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** The fields as a reader is shown them: one line made from them, what they affect, and the page's own passage. */
export function LawFieldsRead({ fields, quote }: { fields: LawChangeFields | undefined; quote?: string }) {
  const line = lawChangeSaid(fields);
  if (!line && !fields?.affects.length && !quote) return null;
  return (
    <div className="space-y-1">
      {line ? <p className="text-[13px] font-medium text-ink">{line}</p> : null}
      {fields?.affects.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {fields.affects.map((about) => (
            <li key={aboutKey(about)} className="rounded-md bg-sunken px-1.5 py-0.5 text-[12px] text-ink-secondary">
              {lawAboutSaid(about)}
            </li>
          ))}
        </ul>
      ) : null}
      {quote ? <p className="break-words font-mono text-[12px] text-ink-muted">“{quote}”</p> : null}
    </div>
  );
}

function FigureBox({ label, value, dates, onChange }: { label: string; value: LawFigure | undefined; dates: boolean; onChange: (next: LawFigure | undefined) => void }) {
  if (dates) {
    return (
      <Field label={label}>
        <Input type="date" value={value?.date ?? ''} onChange={(e) => onChange(e.target.value ? { date: e.target.value } : undefined)} />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          type="number"
          inputMode="decimal"
          aria-label={`${label}, the figure`}
          className="min-w-0 flex-1"
          value={value?.n ?? ''}
          onChange={(e) => onChange(e.target.value === '' || !Number.isFinite(Number(e.target.value)) ? undefined : { n: Number(e.target.value), ...(value?.unit ? { unit: value.unit } : {}) })}
        />
        <Select aria-label={`${label}, the unit`} className="w-28" value={value?.unit ?? ''} disabled={value?.n === undefined} onChange={(e) => onChange(value?.n === undefined ? undefined : { n: value.n, ...(e.target.value ? { unit: e.target.value as LawUnit } : {}) })}>
          <option value="">No unit</option>
          {LAW_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_LABEL[unit]}
            </option>
          ))}
        </Select>
      </div>
    </Field>
  );
}

export function LawFieldsEdit({ fields, lists, onChange }: { fields: LawChangeFields; lists: LawLists; onChange: (next: LawChangeFields) => void }) {
  const set = <K extends keyof LawChangeFields>(key: K, value: LawChangeFields[K] | undefined) => {
    const next = { ...fields };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const choices = aboutChoices(lists).filter((choice) => !fields.affects.some((held) => aboutKey(held) === aboutKey(choice.about)));
  const dates = fields.change === 'deadline_changed';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Kind of change" required>
          <Select value={fields.change ?? ''} onChange={(e) => set('change', (e.target.value || undefined) as LawChangeType | undefined)}>
            <option value="">Choose</option>
            {LAW_CHANGE_TYPES.map((key) => (
              <option key={key} value={key}>
                {LAW_CHANGE_TYPE_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Instrument">
          <Select value={fields.instrument ?? ''} onChange={(e) => set('instrument', (e.target.value || undefined) as LawInstrument | undefined)}>
            <option value="">Not said</option>
            {LAW_INSTRUMENTS.map((key) => (
              <option key={key} value={key}>
                {LAW_INSTRUMENT_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={fields.reference ?? ''} maxLength={LAW_REFERENCE} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Dated">
          <Input type="date" value={fields.dated ?? ''} onChange={(e) => set('dated', e.target.value)} />
        </Field>
        <Field label="In force from">
          <Input type="date" value={fields.effectiveFrom ?? ''} onChange={(e) => set('effectiveFrom', e.target.value)} />
        </Field>
        <FigureBox label="Was" value={fields.was} dates={dates} onChange={(next) => set('was', next)} />
        <FigureBox label="Now" value={fields.now} dates={dates} onChange={(next) => set('now', next)} />
      </div>
      <Field label="Affects">
        <div className="space-y-2">
          {fields.affects.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {fields.affects.map((about) => (
                <li key={aboutKey(about)} className="inline-flex items-center gap-1 rounded-md bg-sunken py-0.5 pl-1.5 pr-0.5 text-[12px] text-ink-secondary">
                  {lawAboutSaid(about)}
                  <button type="button" aria-label={`Remove ${lawAboutSaid(about)}`} className="rounded p-0.5 text-ink-muted hover:text-ink" onClick={() => set('affects', fields.affects.filter((held) => aboutKey(held) !== aboutKey(about)))}>
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {fields.affects.length < LAW_AFFECTS_AT_MOST && choices.length ? (
            <div className="flex">
              <AboutSelect label="Add something it affects" value={undefined} choices={choices} none="Add a field, an approval or a rule row" onChange={(about) => (about ? set('affects', [...fields.affects, about]) : undefined)} />
            </div>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
