import { useState } from 'react';
import { UserRound } from 'lucide-react';
import type { DdProject } from '@realytica/shared';
import { api } from '../lib/api';
import { Button, cn, useToast } from './ui/kit';
import { OwnerInput } from './OwnerInput';

/**
 * Who this row belongs to, and a way to change it.
 *
 * Closed until somebody wants it. A register is read far more often than it is
 * reassigned, and an input on every row turns a list you can scan into a form
 * you have to read — so the resting state is a name, and the editor is one
 * click away.
 *
 * "Unassigned" is said out loud rather than left blank. A row nobody owns is
 * the row that does not get done, and a blank cell is the one nobody notices.
 */
export function AssignCell({
  project,
  targetId,
  owner,
  onAssigned,
  className,
}: {
  project: DdProject;
  targetId: string;
  owner?: string;
  onAssigned: (project: DdProject) => void;
  className?: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(owner ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await api.assign(project.id, targetId, draft.trim());
      onAssigned(res.project);
      setEditing(false);
      toast(draft.trim() ? `Assigned to ${draft.trim()}` : 'Owner cleared', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not assign that', 'critical');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(owner ?? '');
          setEditing(true);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] hover:bg-sunken',
          owner ? 'text-ink-secondary' : 'text-ink-muted',
          className,
        )}
      >
        <UserRound size={12} />
        {owner || 'Unassigned'}
      </button>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <OwnerInput value={draft} onChange={setDraft} project={project} className="w-48" />
      <Button size="sm" loading={busy} onClick={() => void save()}>Save</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
    </span>
  );
}
