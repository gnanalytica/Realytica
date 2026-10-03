import { useEffect, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { DEPARTMENTS, can, projectDepartments, supportingDocuments, type DdProject, type DepartmentKey } from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Button, Disclosure, useToast } from '../ui/kit';
import { DepartmentTiles } from './DepartmentTiles';

/**
 * Which departments this project runs, changeable after it is made.
 *
 * Folded away, because it is set once and rarely again. Switching one off
 * hides it and deletes nothing: its checks and documents stay on the file,
 * the documents show as supporting documents, and switching it back on puts
 * everything where it was.
 */
export function DepartmentsControl({ project, onSaved }: { project: DdProject; onSaved: (next: DdProject) => void }) {
  const me = useMe();
  const toast = useToast();
  const current = projectDepartments(project);
  const [draft, setDraft] = useState<DepartmentKey[]>(current);
  const [busy, setBusy] = useState(false);
  const key = current.join(',');
  useEffect(() => setDraft(key ? (key.split(',') as DepartmentKey[]) : []), [key]);
  if (!me || !can(me.role, 'admin')) return null;

  const order = DEPARTMENTS.map((d) => d.key);
  const next = order.filter((d) => draft.includes(d));
  const changed = next.join(',') !== key;
  const supporting = supportingDocuments(project).length;

  async function save() {
    setBusy(true);
    try {
      const res = await workspaceApi.setDepartments(project.id, next);
      onSaved(res.project);
      toast('Departments updated.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change the departments', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Disclosure title="Departments on this project" count={current.length} icon={<LayoutGrid size={14} />}>
      <div className="space-y-3 px-3 pb-3">
        <DepartmentTiles value={draft} onChange={setDraft} disabled={busy} />
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-micro text-ink-muted">
            Switching one off hides it and deletes nothing.
            {supporting ? ` ${supporting} filed document${supporting === 1 ? ' belongs' : 's belong'} to a department that is off, and show as supporting documents.` : ''}
          </p>
          {changed ? (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(current)}>
                Reset
              </Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
                Save
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Disclosure>
  );
}
