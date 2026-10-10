import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  DEPARTMENT_ROLE_LABEL,
  can,
  departmentRole,
  type DdProject,
  type DepartmentKey,
  type DepartmentRole,
  type WorkspaceRole,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Button, Tooltip, cn, useToast } from '../ui/kit';
import { initials } from '../project/ProjectPanels';

const AVATAR_TINT = [
  'bg-brand-soft text-brand ring-brand/30',
  'bg-good/15 text-[var(--status-good-text)] ring-good/30',
  'bg-serious/12 text-[var(--status-serious-text)] ring-serious/30',
  'bg-warning/20 text-[var(--status-warning-text)] ring-warning/35',
] as const;

function avatarTint(seed: string): string {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 3)) % AVATAR_TINT.length;
  return AVATAR_TINT[n]!;
}

type Person = { email: string; name?: string; workspaceRole?: WorkspaceRole };

/**
 * The professions this department certifies with, as a grid of slots.
 *
 * Each slot shows who is associated (avatar chips). Press + to put someone
 * who already works in the department on that profession; press × on a chip
 * to clear the association.
 */
export function ProfessionRoster({
  project,
  department,
  professions,
  staff,
  onChanged,
}: {
  project: DdProject;
  department: DepartmentKey;
  professions: readonly string[];
  /** Firm people (and anyone already on the project team). */
  staff: Person[];
  onChanged: (p: DdProject) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const mayEdit = me ? can(me.role, 'admin') : false;
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  const onDept = useMemo(() => {
    const byEmail = new Map<string, Person>();
    for (const s of staff) byEmail.set(s.email.toLowerCase(), { email: s.email.toLowerCase(), name: s.name, workspaceRole: s.workspaceRole });
    for (const m of project.team ?? []) {
      const email = m.email.toLowerCase();
      byEmail.set(email, { email, name: m.name ?? byEmail.get(email)?.name, workspaceRole: byEmail.get(email)?.workspaceRole });
    }
    return [...byEmail.values()]
      .filter((p) => departmentRole(project, { email: p.email, workspaceRole: p.workspaceRole }, department))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [project, staff, department]);

  function associated(profession: string): Person[] {
    return onDept.filter((p) => {
      const member = (project.team ?? []).find((m) => m.email === p.email);
      return member?.signer?.profession === profession;
    });
  }

  function available(profession: string): Person[] {
    const taken = new Set(associated(profession).map((p) => p.email));
    return onDept.filter((p) => !taken.has(p.email));
  }

  async function associate(profession: string, email: string) {
    const person = onDept.find((p) => p.email === email);
    if (!person) return;
    const member = (project.team ?? []).find((m) => m.email === email);
    const role = departmentRole(project, { email, workspaceRole: person.workspaceRole }, department);
    const departments = { ...(member?.departments ?? {}) };
    // Profession slots are for people who can sign; keep lead, else make signer.
    const nextRole: DepartmentRole = role === 'lead' ? 'lead' : 'signer';
    departments[department] = nextRole;
    setBusy(`${profession}:${email}`);
    try {
      const res = await workspaceApi.setTeamMember(project.id, email, {
        name: person.name ?? member?.name,
        departments,
        signer: {
          profession,
          ...(member?.signer?.registration ? { registration: member.signer.registration } : {}),
          ...(member?.signer?.firm ? { firm: member.signer.firm } : {}),
        },
      });
      onChanged(res.project);
      setPicking(null);
      toast(`${person.name ?? email} is ${profession}.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not associate them', 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function clear(profession: string, email: string) {
    const person = onDept.find((p) => p.email === email);
    const member = (project.team ?? []).find((m) => m.email === email);
    if (!person || !member) return;
    const departments = { ...member.departments };
    if (departments[department] === 'signer') departments[department] = 'contributor';
    setBusy(`${profession}:${email}`);
    try {
      const res = await workspaceApi.setTeamMember(project.id, email, {
        name: person.name ?? member.name,
        departments,
        // Drop the profession only when it was this slot's.
        ...(member.signer && member.signer.profession !== profession ? { signer: member.signer } : {}),
      });
      onChanged(res.project);
      toast(`${person.name ?? email} is no longer ${profession}.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not clear them', 'critical');
    } finally {
      setBusy(null);
    }
  }

  if (!professions.length) {
    return <p className="text-[13px] text-ink-secondary">This department has no named professions yet.</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {professions.map((profession) => {
        const people = associated(profession);
        const pool = available(profession);
        const open = picking === profession;
        return (
          <li
            key={profession}
            className="flex min-h-[5.5rem] flex-col gap-2 rounded-2xl bg-sunken/60 p-3 ring-1 ring-inset ring-[var(--ring)]"
          >
            <p className="text-[13px] font-semibold text-ink">{profession}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {people.map((p) => {
                const name = p.name ?? p.email;
                const role = departmentRole(project, { email: p.email, workspaceRole: p.workspaceRole }, department);
                const chipBusy = busy === `${profession}:${p.email}`;
                const chip = (
                  <span
                    className={cn(
                      'inline-flex max-w-full items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)]',
                      chipBusy && 'opacity-60',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold ring-1 ring-inset',
                        avatarTint(p.email),
                      )}
                    >
                      {initials(name)}
                    </span>
                    <span className="min-w-0 truncate">{name}</span>
                    {role ? <span className="shrink-0 text-ink-muted">{DEPARTMENT_ROLE_LABEL[role]}</span> : null}
                    {mayEdit ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        aria-label={`Remove ${name} from ${profession}`}
                        onClick={() => void clear(profession, p.email)}
                        className="ml-0.5 rounded-full p-0.5 text-ink-muted hover:bg-sunken hover:text-ink"
                      >
                        <X size={10} />
                      </button>
                    ) : null}
                  </span>
                );
                return (
                  <Tooltip key={p.email} label={`${name} · ${p.email}`}>
                    <span className="inline-flex max-w-full">{chip}</span>
                  </Tooltip>
                );
              })}
              {mayEdit ? (
                open ? (
                  <select
                    aria-label={`Associate someone as ${profession}`}
                    autoFocus
                    disabled={Boolean(busy)}
                    className="h-7 max-w-[12rem] rounded-lg bg-surface px-2 text-[11px] text-ink ring-1 ring-inset ring-[var(--ring)]"
                    defaultValue=""
                    onChange={(e) => {
                      const email = e.target.value;
                      if (email) void associate(profession, email);
                      else setPicking(null);
                    }}
                    onBlur={() => setPicking(null)}
                  >
                    <option value="">{pool.length ? 'Choose…' : 'Nobody else on this department'}</option>
                    {pool.map((p) => (
                      <option key={p.email} value={p.email}>
                        {p.name ?? p.email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy) || !onDept.length}
                    icon={<Plus size={12} />}
                    onClick={() => setPicking(profession)}
                    aria-label={`Associate someone as ${profession}`}
                    className="h-7 rounded-full px-2 text-[11px]"
                  >
                    Add
                  </Button>
                )
              ) : null}
              {!people.length && !mayEdit ? <span className="text-[12px] text-ink-muted">Nobody yet</span> : null}
            </div>
            {!onDept.length ? (
              <p className="text-micro text-ink-muted">Put people on this department in People first.</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
