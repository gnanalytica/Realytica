import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { FIRM_FIELDS_A_SET, FIRM_FIELD_KINDS, FIRM_FIELD_KIND_LABEL, FIRM_LABEL_MOST, firmKey, reachesEveryProject, type CheckFieldKind, type FirmFieldPack } from '@realytica/shared';
import { api, type FirmFieldsShown } from '../lib/api';
import { setFirmFields } from '../lib/firmFields';
import { useAsync } from '../lib/useAsync';
import { useMe } from '../lib/useMe';
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Skeleton, useToast } from '../components/ui/kit';

type Draft = Pick<FirmFieldPack, 'optionSets' | 'add' | 'demote'>;

const TIER_SAID = { core: 'Always shown', situational: 'Shown when it applies', expert: 'Folded under More' } as const;

/** A list of choices typed one to a line, as the choices it makes: each keyed by its own words. */
function choicesOf(text: string): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  return text
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((label) => {
      const key = firmKey(label).replace(/^firm_/, '');
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ key, label }];
    });
}

/**
 * Set up › Fields: what the firm adds to the built-in sheets.
 *
 * A firm admin adds fields and lists to a built-in set, and folds a built-in
 * field as expert. Nothing here hides a built-in field or changes what one
 * holds: there is no control for either. Everything is kept in a draft until
 * Save, which is refused whole with every reason if one thing in it cannot
 * stand. Taking a field away deletes nothing on any project: what was saved
 * under it stays there, shown as no longer asked.
 */
export default function FieldsSetup() {
  const me = useMe();
  const toast = useToast();
  const staff = me ? reachesEveryProject(me.role) : false;
  const { data, error, loading } = useAsync<FirmFieldsShown | null>(() => (staff ? api.firmFields() : Promise.resolve(null)), [staff]);
  const [draft, setDraft] = useState<Draft | null>(null);
  // What is saved, to tell whether the draft differs from it.
  const [saved, setSaved] = useState<Draft | null>(null);
  const [setId, setSetId] = useState('');
  const [faults, setFaults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [field, setField] = useState<{ label: string; kind: CheckFieldKind; optionSet: string; section: string; tier: 'core' | 'expert' }>({ label: '', kind: 'text', optionSet: '', section: '', tier: 'core' });
  const [list, setList] = useState({ label: '', options: '' });

  useEffect(() => {
    if (!data) return;
    const held = { optionSets: data.pack.optionSets, add: data.pack.add, demote: data.pack.demote };
    setDraft(held);
    setSaved(held);
    setSetId((held) => held || data.sets[0]?.id || '');
  }, [data]);

  const set = data?.sets.find((held) => held.id === setId);
  const mayManage = Boolean(data?.mayManage);
  const changed = useMemo(() => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)), [draft, saved]);
  const byFunction = useMemo(() => {
    const groups = new Map<string, FirmFieldsShown['sets']>();
    for (const held of data?.sets ?? []) groups.set(held.function, [...(groups.get(held.function) ?? []), held]);
    return [...groups.entries()];
  }, [data]);

  if (me && !staff) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Set up" title="Fields" />
        <Callout tone="neutral" title="Fields are set up by the firm’s own people">
          Ask whoever invited you if a sheet is missing something you need.
        </Callout>
      </div>
    );
  }

  const added = draft && set ? draft.add.filter((row) => row.set === set.id) : [];
  const folded = (key: string) => Boolean(draft?.demote.some((row) => row.set === setId && row.field === key));
  const key = firmKey(field.label);
  const isChoice = field.kind === 'enum' || field.kind === 'multi_enum';
  const mayAdd = Boolean(mayManage && set && key && field.label.trim().length <= FIRM_LABEL_MOST && added.length < FIRM_FIELDS_A_SET && !added.some((row) => row.field.key === key) && (!isChoice || field.optionSet));

  const addField = () => {
    if (!draft || !set || !mayAdd) return;
    setDraft({
      ...draft,
      add: [
        ...draft.add,
        { set: set.id, field: { key, label: field.label.trim(), kind: field.kind, tier: field.tier, required: false, firm: true, ...(isChoice ? { optionSet: field.optionSet } : {}), ...(field.section ? { section: field.section } : {}), ...(field.kind === 'longtext' ? { maxLength: 300 } : {}) } },
      ],
    });
    setField({ label: '', kind: 'text', optionSet: '', section: '', tier: 'core' });
  };

  const listId = firmKey(list.label);
  const listChoices = choicesOf(list.options);
  const mayAddList = Boolean(mayManage && listId && listChoices.length && !draft?.optionSets.some((held) => held.id === listId));
  const addList = () => {
    if (!draft || !mayAddList) return;
    setDraft({ ...draft, optionSets: [...draft.optionSets, { id: listId, label: list.label.trim(), options: listChoices }] });
    setList({ label: '', options: '' });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setFaults([]);
    try {
      const shown = await api.saveFirmFields(draft);
      setFirmFields(shown.pack);
      const held = { optionSets: shown.pack.optionSets, add: shown.pack.add, demote: shown.pack.demote };
      setDraft(held);
      setSaved(held);
      toast('Saved. Every project of the firm now asks these.', 'good');
    } catch (e) {
      const said = e instanceof Error ? e.message : 'That could not be saved';
      setFaults(said.split(/(?<=\.)\s+(?=[A-Z“"])/).filter(Boolean));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <Link to="/setup" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
        <ArrowLeft size={13} aria-hidden />
        Set up
      </Link>
      <PageHeader
        title="Fields"
        subtitle="What the firm adds to the built-in sheets, for every project"
        actions={
          mayManage ? (
            <Button onClick={() => void save()} disabled={!changed || busy}>
              Save
            </Button>
          ) : undefined
        }
      />
      {error ? <Callout tone="critical" title="Could not load the fields">{error}</Callout> : null}
      {faults.length ? (
        <Callout tone="critical" title="Not saved">
          <ul className="list-disc space-y-0.5 pl-4">
            {faults.map((fault) => (
              <li key={fault}>{fault}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {loading && !data ? <Skeleton className="h-64 w-full rounded-xl" /> : null}
      {data && draft ? (
        <>
          {!mayManage ? <Callout tone="neutral" title="A firm admin changes these">You can read what the firm has added.</Callout> : null}
          <Card>
            <CardHeader
              title="A sheet’s fields"
              subtitle={set ? `${set.function} · ${set.fields.length} built in · ${added.length} added` : 'Pick a sheet'}
              action={
                <Select aria-label="Sheet" value={setId} onChange={(e) => setSetId(e.target.value)} className="min-w-48">
                  {byFunction.map(([name, sets]) => (
                    <optgroup key={name} label={name}>
                      {sets.map((held) => (
                        <option key={held.id} value={held.id}>
                          {held.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              }
            />
            {set ? (
              <CardBody className="space-y-4 @container">
                <section aria-label="Built-in fields">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Built in</h4>
                  <ul className="mt-1 divide-y divide-hairline">
                    {set.fields.map((built) => {
                      const named = set.titleField === built.key;
                      const on = built.tier === 'expert' || folded(built.key);
                      return (
                        <li key={built.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                          <p className="min-w-0 flex-1 basis-40 text-[13px] text-ink">{built.label}</p>
                          <span className="text-[12px] text-ink-muted">{on ? TIER_SAID.expert : TIER_SAID[built.tier]}</span>
                          {built.tier !== 'expert' && !named ? (
                            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary coarse:min-h-11">
                              <input
                                type="checkbox"
                                checked={folded(built.key)}
                                disabled={!mayManage}
                                onChange={(e) => setDraft({ ...draft, demote: e.target.checked ? [...draft.demote, { set: set.id, field: built.key }] : draft.demote.filter((row) => !(row.set === set.id && row.field === built.key)) })}
                              />
                              Fold under More
                            </label>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
                <section aria-label="The firm’s fields">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    The firm’s <span className="font-mono font-normal">{added.length}</span>
                  </h4>
                  {added.length ? (
                    <ul className="mt-1 divide-y divide-hairline">
                      {added.map((row) => (
                        <li key={row.field.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                          <p className="min-w-0 flex-1 basis-40 text-[13px] text-ink">{row.field.label}</p>
                          <Badge>{FIRM_FIELD_KIND_LABEL[row.field.kind] ?? row.field.kind}</Badge>
                          <span className="text-[12px] text-ink-muted">{row.field.tier === 'expert' ? TIER_SAID.expert : TIER_SAID.core}</span>
                          {mayManage ? (
                            <button
                              type="button"
                              aria-label={`Take ${row.field.label} away`}
                              className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-sunken hover:text-critical coarse:size-11"
                              onClick={() => setDraft({ ...draft, add: draft.add.filter((other) => !(other.set === row.set && other.field.key === row.field.key)) })}
                            >
                              <X size={14} aria-hidden />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[13px] text-ink-muted">None added to this sheet.</p>
                  )}
                </section>
                {mayManage ? (
                  <section aria-label="Add a field" className="grid grid-cols-1 gap-3 rounded-lg border border-hairline p-3 [@container(min-width:40rem)]:grid-cols-2">
                    <Field label="Label" hint={key ? `Kept as ${key}` : `Up to ${FIRM_LABEL_MOST} characters`}>
                      <Input value={field.label} maxLength={FIRM_LABEL_MOST} onChange={(e) => setField({ ...field, label: e.target.value })} />
                    </Field>
                    <Field label="Holds">
                      <Select value={field.kind} onChange={(e) => setField({ ...field, kind: e.target.value as CheckFieldKind })}>
                        {FIRM_FIELD_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {FIRM_FIELD_KIND_LABEL[kind]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {isChoice ? (
                      <Field label="List" hint={draft.optionSets.length ? undefined : 'Add a list below first'}>
                        <Select value={field.optionSet} onChange={(e) => setField({ ...field, optionSet: e.target.value })}>
                          <option value="">Pick a list…</option>
                          {draft.optionSets.map((held) => (
                            <option key={held.id} value={held.id}>
                              {held.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    {set.sections.length ? (
                      <Field label="Section">
                        <Select value={field.section} onChange={(e) => setField({ ...field, section: e.target.value })}>
                          <option value="">At the top</option>
                          {set.sections.map((section) => (
                            <option key={section.key} value={section.key}>
                              {section.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    <Field label="Shown">
                      <Select value={field.tier} onChange={(e) => setField({ ...field, tier: e.target.value as 'core' | 'expert' })}>
                        <option value="core">{TIER_SAID.core}</option>
                        <option value="expert">{TIER_SAID.expert}</option>
                      </Select>
                    </Field>
                    <div className="flex items-end">
                      <Button variant="ghost" icon={<Plus size={14} />} onClick={addField} disabled={!mayAdd}>
                        Add field
                      </Button>
                    </div>
                  </section>
                ) : null}
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Lists" subtitle="Choices a field of the firm’s picks from" />
            <CardBody className="space-y-3 @container">
              {draft.optionSets.length ? (
                <ul className="divide-y divide-hairline">
                  {draft.optionSets.map((held) => {
                    const used = draft.add.some((row) => row.field.optionSet === held.id);
                    return (
                      <li key={held.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <p className="min-w-0 basis-40 text-[13px] font-medium text-ink">{held.label}</p>
                        <p className="min-w-0 flex-1 basis-48 text-[12px] text-ink-secondary">{held.options.map((option) => option.label).join(' · ')}</p>
                        {mayManage && !used ? (
                          <button type="button" aria-label={`Take the list ${held.label} away`} className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-sunken hover:text-critical coarse:size-11" onClick={() => setDraft({ ...draft, optionSets: draft.optionSets.filter((other) => other.id !== held.id) })}>
                            <X size={14} aria-hidden />
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">No list yet.</p>
              )}
              {mayManage ? (
                <section aria-label="Add a list" className="grid grid-cols-1 gap-3 rounded-lg border border-hairline p-3 [@container(min-width:40rem)]:grid-cols-2">
                  <Field label="Name">
                    <Input value={list.label} maxLength={FIRM_LABEL_MOST} onChange={(e) => setList({ ...list, label: e.target.value })} />
                  </Field>
                  <Field label="Choices" hint="Separated by commas">
                    <Input value={list.options} onChange={(e) => setList({ ...list, options: e.target.value })} />
                  </Field>
                  <div>
                    <Button variant="ghost" icon={<Plus size={14} />} onClick={addList} disabled={!mayAddList}>
                      Add list
                    </Button>
                  </div>
                </section>
              ) : null}
            </CardBody>
          </Card>
          <p className="text-[12px] text-ink-muted">Taking a field away deletes nothing. What projects saved under it is kept on its sheet, under “No longer asked”.</p>
        </>
      ) : null}
    </div>
  );
}
