/**
 * The project's parties, by role, on its People page.
 *
 * One short list: the owner, the project manager, the architect, the
 * structural and MEP consultants, the cost consultant, the contractors and
 * the lender. It is the shared party records read by role (`partiesByRole`),
 * so a name entered here is the one "owed by" picks from, a field that links
 * to a party offers, and a tender's terms name. A name is typed once, here or
 * wherever it first comes up, and is the same party everywhere after.
 *
 * Somebody working from a grant holds a copy of the project with parts taken
 * out: the list is read from that copy, and shows the parties it holds.
 */

import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { departmentRole, projectDepartments, partiesByRole, roleCanEdit, type DdProject, type PartyGroup, type ProjectParty } from '@realytica/shared';
import { api } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, CardHeader, Input, Select, useToast } from '../ui/kit';

type Correction = { name: string } | { into: string } | { remove: true };

/** One party's name, and for somebody who may edit the project's people, the three ways it is corrected: renamed, merged into the party it duplicates, removed. */
function Party({ party, others, mayEdit, busy, onCorrect }: { party: ProjectParty; others: ProjectParty[]; mayEdit: boolean; busy: boolean; onCorrect: (partyId: string, how: Correction, done: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(party.name);
  const [into, setInto] = useState('');
  const said = party.organisation && party.organisation !== party.name ? `${party.name}, ${party.organisation}` : party.name;
  if (!mayEdit) return <span>{said}</span>;
  const close = () => {
    setOpen(false);
    setName(party.name);
    setInto('');
  };
  return (
    <span data-party={party.id} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{said}</span>
      {open ? (
        <span className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-sunken p-2">
          <Input value={name} aria-label={`New name for ${party.name}`} maxLength={200} onChange={(event) => setName(event.target.value)} className="h-8 w-56" />
          <Button size="sm" variant="primary" loading={busy} disabled={!name.trim() || name.trim() === party.name} onClick={() => void onCorrect(party.id, { name: name.trim() }, 'Renamed.').then((ok) => ok && setOpen(false))}>
            Rename
          </Button>
          {others.length ? (
            <>
              <Select value={into} aria-label={`Merge ${party.name} into`} onChange={(event) => setInto(event.target.value)} className="h-8 w-56">
                <option value="">Same party as…</option>
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" loading={busy} disabled={!into} onClick={() => void onCorrect(party.id, { into }, 'Merged: everything that named it now names the party kept.').then((ok) => ok && close())}>
                Merge
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onCorrect(party.id, { remove: true }, 'Removed.')}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
        </span>
      ) : (
        <button type="button" aria-label={`Correct ${party.name}`} onClick={() => setOpen(true)} className="text-[12px] text-ink-muted hover:text-brand hover:underline coarse:min-h-11">
          Correct
        </button>
      )}
    </span>
  );
}

function Group({ group, all, mayAdd, busy, onAdd, onCorrect }: { group: PartyGroup; all: ProjectParty[]; mayAdd: boolean; busy: boolean; onAdd: (name: string, role: string) => Promise<boolean>; onCorrect: (partyId: string, how: Correction, done: string) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    const typed = name.replace(/\s+/g, ' ').trim();
    if (!typed || !group.role) return;
    void onAdd(typed, group.role).then((ok) => {
      if (!ok) return;
      setName('');
      setAdding(false);
    });
  };
  return (
    <li data-party-group={group.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <span className="w-40 shrink-0 text-[12px] font-medium text-ink-secondary">{group.label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-ink">
        {group.parties.length ? (
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {group.parties.map((party) => (
              <Party key={party.id} party={party} others={all.filter((other) => other.id !== party.id)} mayEdit={mayAdd} busy={busy} onCorrect={onCorrect} />
            ))}
          </span>
        ) : (
          <span className="text-ink-muted">Nobody named</span>
        )}
      </span>
      {mayAdd && group.role ? (
        adding ? (
          <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Input
              autoFocus
              value={name}
              aria-label={`Name for ${group.label}`}
              placeholder="Name"
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') setAdding(false);
              }}
              className="h-8 w-52"
            />
            <Button size="sm" variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="shrink-0 text-[12px] font-medium text-brand hover:underline coarse:min-h-11">
            {group.parties.length ? 'Add another' : 'Name one'}
          </button>
        )
      ) : null}
    </li>
  );
}

export function PartiesCard({ project, onChanged }: { project: DdProject; onChanged: (project: DdProject) => void }) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const view = useMemo(() => partiesByRole(project), [project]);
  // A shared record is written by whoever may edit in any of the project's departments; the server asks the same.
  const mayAdd = Boolean(me && projectDepartments(project).some((department) => roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, department))));
  const add = async (name: string, role: string): Promise<boolean> => {
    setBusy(true);
    try {
      const out = await api.addFieldRecord(project.id, 'shared.parties', { name, roles: [role] });
      onChanged(out.project);
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That party could not be added', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const correct = async (partyId: string, how: Correction, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      onChanged((await api.correctParty(project.id, partyId, how)).project);
      toast(done, 'good');
      return true;
    } catch (error) {
      // A refusal says why in a sentence: what refers to the party, or who may do it.
      toast(error instanceof Error ? error.message : 'That could not be done', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const all = [...new Map(view.groups.flatMap((group) => group.parties).map((party) => [party.id, party])).values()];
  return (
    <Card data-parties>
      <CardHeader
        icon={<Users size={15} />}
        title="Parties"
        subtitle="Who is on this project, by role. Papers owed, and any field that names a party, pick from this list."
      />
      <CardBody className="py-1">
        <ul className="divide-y divide-hairline">
          {view.groups.map((group) => (
            <Group key={group.key} group={group} all={all} mayAdd={mayAdd} busy={busy} onAdd={add} onCorrect={correct} />
          ))}
        </ul>
        {view.offered ? (
          <p className="border-t border-hairline py-2 text-[12px] text-ink-muted">
            {view.offered} more {view.offered === 1 ? 'name was' : 'names were'} read from a paper and {view.offered === 1 ? 'waits' : 'wait'} to be accepted.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
