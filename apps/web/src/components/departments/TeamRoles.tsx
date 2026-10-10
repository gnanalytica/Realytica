import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import {
  DEPARTMENTS,
  DEPARTMENT_ROLES,
  DEPARTMENT_ROLE_HINT,
  DEPARTMENT_ROLE_LABEL,
  DEPARTMENT_SHORT,
  WORKSPACE_ROLE_LABEL,
  can,
  departmentRole,
  projectDepartments,
  type DdProject,
  type DepartmentKey,
  type DepartmentRole,
  type TeamMember,
  type WorkspaceRole,
} from '@realytica/shared';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Button, Card, CardBody, CardHeader, Field, Input, Select, Tooltip, cn, useToast } from '../ui/kit';
import { initials } from '../project/ProjectPanels';
import { DEPARTMENT_ICON } from './icons';

interface Row {
  email: string;
  name?: string;
  workspaceRole?: WorkspaceRole;
  member?: TeamMember;
}

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

const ROLE_CHIP: Record<DepartmentRole, string> = {
  lead: 'bg-brand-soft text-brand ring-brand/35',
  contributor: 'bg-surface text-ink ring-brand/25',
  signer: 'bg-good/10 text-[var(--status-good-text)] ring-good/40',
  viewer: 'bg-page text-ink-secondary ring-hairline',
};

const DEPT_MARK: Record<DepartmentKey, string> = {
  finance: 'bg-brand-soft text-brand',
  legal: 'bg-serious/12 text-[var(--status-serious-text)]',
  design: 'bg-warning/20 text-[var(--status-warning-text)]',
  construction: 'bg-good/15 text-[var(--status-good-text)]',
  procurement: 'bg-sunken text-ink-secondary',
  commercial: 'bg-brand-soft text-brand',
};

/**
 * Who does what, department by department.
 *
 * One row a department: people as chips (name + role). Press a chip to change
 * the role; press + to put someone from the firm on that department.
 */
export function TeamRoles({
  project,
  staff,
  named,
  onChanged,
}: {
  project: DdProject;
  staff: Array<{ email: string; name?: string; role: WorkspaceRole }>;
  /** Firm people (org-wide) who can be put in a department role. */
  named: Array<{ email: string; name?: string }>;
  onChanged: (p: DdProject) => void;
}) {
  const me = useMe();
  const toast = useToast();
  const mayStaff = me ? can(me.role, 'admin') : false;
  const departments = DEPARTMENTS.filter((d) => projectDepartments(project).includes(d.key));
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<DepartmentKey | null>(null);
  const [addDraft, setAddDraft] = useState({ email: '', role: 'contributor' as DepartmentRole, profession: '', registration: '' });
  const [signerFor, setSignerFor] = useState<{ email: string; department: DepartmentKey } | null>(null);
  const [signerDraft, setSignerDraft] = useState({ profession: '', registration: '' });

  const rows = useMemo<Row[]>(() => {
    const out = new Map<string, Row>();
    for (const s of staff) out.set(s.email.toLowerCase(), { email: s.email.toLowerCase(), name: s.name, workspaceRole: s.role });
    for (const m of project.team ?? []) out.set(m.email, { ...(out.get(m.email) ?? { email: m.email }), member: m, name: m.name ?? out.get(m.email)?.name });
    return [...out.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [project.team, staff]);

  const pickable = useMemo(() => {
    const byEmail = new Map<string, { email: string; name?: string }>();
    for (const p of named) {
      const email = p.email.toLowerCase();
      const held = byEmail.get(email);
      byEmail.set(email, { email, name: p.name ?? held?.name });
    }
    return [...byEmail.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [named]);

  useEffect(() => {
    if (!adding) return;
    if (!addDraft.email && pickable[0]) setAddDraft((was) => ({ ...was, email: pickable[0]!.email }));
  }, [adding, pickable, addDraft.email]);

  async function setRole(email: string, department: DepartmentKey, role: DepartmentRole | '') {
    const existing = rows.find((r) => r.email === email);
    if (!existing) return;
    if (role === 'signer' && !existing.member?.signer) {
      setSignerFor({ email, department });
      setSignerDraft({ profession: '', registration: '' });
      setEditing(null);
      return;
    }
    setBusy(`${email}:${department}`);
    try {
      const departmentsMap = { ...(existing.member?.departments ?? {}) };
      if (role) departmentsMap[department] = role;
      else delete departmentsMap[department];
      const res = Object.keys(departmentsMap).length
        ? await workspaceApi.setTeamMember(project.id, email, {
            name: existing.name,
            departments: departmentsMap,
            ...(existing.member?.signer ? { signer: existing.member.signer } : {}),
          })
        : await workspaceApi.removeTeamMember(project.id, email);
      onChanged(res.project);
      setEditing(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change their role', 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function assign(department: DepartmentKey, email: string, role: DepartmentRole, signer?: { profession: string; registration?: string }) {
    const person = pickable.find((p) => p.email === email) ?? rows.find((r) => r.email === email);
    if (!person) return;
    const existing = rows.find((r) => r.email === email);
    if (role === 'signer' && !existing?.member?.signer && !signer?.profession.trim()) {
      setSignerFor({ email, department });
      setSignerDraft({ profession: '', registration: '' });
      setAdding(null);
      return;
    }
    setBusy(`new:${department}`);
    try {
      const departmentsMap = { ...(existing?.member?.departments ?? {}), [department]: role };
      const res = await workspaceApi.setTeamMember(project.id, email, {
        name: person.name ?? existing?.name,
        departments: departmentsMap,
        ...(role === 'signer'
          ? {
              signer:
                existing?.member?.signer ??
                (signer ? { profession: signer.profession.trim(), registration: signer.registration?.trim() || undefined } : undefined),
            }
          : existing?.member?.signer
            ? { signer: existing.member.signer }
            : {}),
      });
      onChanged(res.project);
      toast(`${person.name ?? email} is ${DEPARTMENT_ROLE_LABEL[role].toLowerCase()} in ${DEPARTMENT_SHORT[department]}.`, 'good');
      setAdding(null);
      setAddDraft({ email: pickable[0]?.email ?? '', role: 'contributor', profession: '', registration: '' });
      setSignerFor(null);
      setSignerDraft({ profession: '', registration: '' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set their role', 'critical');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Users size={15} className="text-brand" />}
        title="Roles by department"
        subtitle="One row a department · press a person to change their role"
        info="Grey “firm” follows their firm role. A coloured chip is set on this project only."
      />
      <CardBody className="p-0">
        <ul className="divide-y divide-hairline">
          {departments.map((d) => {
            const Icon = DEPARTMENT_ICON[d.key];
            const onIt = rows
              .map((row) => {
                const role = departmentRole(project, { email: row.email, workspaceRole: row.workspaceRole }, d.key);
                return role ? { row, role } : null;
              })
              .filter((x): x is { row: Row; role: DepartmentRole } => Boolean(x));
            const open = adding === d.key;
            const available = pickable.filter(
              (p) => !onIt.some((x) => x.row.email === p.email && x.row.member?.departments[d.key]),
            );
            // Still allow re-picking anyone from the firm (updates role).
            const addPeople = pickable.length ? pickable : available;
            return (
              <li key={d.key} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <div className="flex w-[7.5rem] shrink-0 items-center gap-1.5">
                    <span className={cn('grid size-5 place-items-center rounded', DEPT_MARK[d.key])}>
                      <Icon size={11} aria-hidden />
                    </span>
                    <h3 className="truncate text-[12px] font-semibold text-ink">{DEPARTMENT_SHORT[d.key]}</h3>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                    {onIt.map(({ row, role }) => (
                      <PersonChip
                        key={row.email}
                        department={d.key}
                        departmentLabel={d.label}
                        role={role}
                        row={row}
                        mayStaff={mayStaff}
                        busy={busy !== null}
                        editing={editing === `${row.email}:${d.key}`}
                        onEdit={() => {
                          setAdding(null);
                          setEditing(`${row.email}:${d.key}`);
                        }}
                        onCancel={() => setEditing(null)}
                        onSave={(next) => void setRole(row.email, d.key, next)}
                      />
                    ))}
                    {onIt.length === 0 && !open ? <span className="text-micro text-ink-muted">Nobody yet</span> : null}
                    {mayStaff && pickable.length > 0 ? (
                      <button
                        type="button"
                        aria-label={`Add someone to ${DEPARTMENT_SHORT[d.key]}`}
                        aria-expanded={open}
                        disabled={busy !== null}
                        onClick={() => {
                          setEditing(null);
                          setAddDraft((was) => ({ ...was, email: was.email || pickable[0]?.email || '', role: 'contributor' }));
                          setAdding(open ? null : d.key);
                        }}
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-full text-ink-muted ring-1 ring-inset ring-hairline transition-colors duration-quick',
                          'hover:text-brand hover:ring-brand/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                          open && 'bg-brand-soft text-brand ring-brand/40',
                        )}
                      >
                        <Plus size={13} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <div className="mt-2 ml-[7.5rem] flex flex-wrap items-end gap-2 rounded-lg bg-page/70 p-2 ring-1 ring-inset ring-hairline">
                    <Field label="Person" className="min-w-[10rem] flex-1">
                      <Select
                        value={addDraft.email}
                        onChange={(e) => setAddDraft((was) => ({ ...was, email: e.target.value }))}
                        className="h-8 text-[12px]"
                      >
                        {addPeople.map((p) => (
                          <option key={p.email} value={p.email}>
                            {p.name ?? p.email}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Role">
                      <Select
                        value={addDraft.role}
                        onChange={(e) => setAddDraft((was) => ({ ...was, role: e.target.value as DepartmentRole }))}
                        className="h-8 w-36 text-[12px]"
                      >
                        {DEPARTMENT_ROLES.map((r) => (
                          <option key={r} value={r} title={DEPARTMENT_ROLE_HINT[r]}>
                            {DEPARTMENT_ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      size="sm"
                      loading={busy === `new:${d.key}`}
                      disabled={!addDraft.email}
                      onClick={() => void assign(d.key, addDraft.email, addDraft.role)}
                    >
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {signerFor?.department === d.key ? (
                  <div className="mt-2 ml-[7.5rem] space-y-2 rounded-lg bg-page/70 p-2 ring-1 ring-inset ring-hairline">
                    <p className="text-micro text-ink-secondary">Signer details for {signerFor.email}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Field label="Profession">
                        <Input
                          value={signerDraft.profession}
                          onChange={(e) => setSignerDraft((was) => ({ ...was, profession: e.target.value }))}
                          placeholder="Advocate, Valuer…"
                          className="h-8 text-[12px]"
                        />
                      </Field>
                      <Field label="Registration">
                        <Input
                          value={signerDraft.registration}
                          onChange={(e) => setSignerDraft((was) => ({ ...was, registration: e.target.value }))}
                          className="h-8 text-[12px]"
                        />
                      </Field>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        loading={busy !== null}
                        disabled={!signerDraft.profession.trim()}
                        onClick={() =>
                          void assign(d.key, signerFor.email, 'signer', {
                            profession: signerDraft.profession,
                            registration: signerDraft.registration,
                          })
                        }
                      >
                        Set signer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSignerFor(null);
                          setSignerDraft({ profession: '', registration: '' });
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {mayStaff && pickable.length === 0 ? (
          <p className="px-3 pb-2 pt-1 text-micro text-ink-muted">No firm people to assign yet.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PersonChip({
  department,
  departmentLabel,
  role,
  row,
  mayStaff,
  busy,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  department: DepartmentKey;
  departmentLabel: string;
  role: DepartmentRole;
  row: Row;
  mayStaff: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (role: DepartmentRole | '') => void;
}) {
  const explicit = row.member?.departments[department];
  const editBox = useRef<HTMLDivElement>(null);
  const name = row.name ?? row.email;
  const detail = [
    row.name ? row.email : null,
    row.workspaceRole ? WORKSPACE_ROLE_LABEL[row.workspaceRole] : 'Outside the firm',
    !explicit ? 'Firm role' : DEPARTMENT_ROLE_HINT[explicit],
    row.member?.signer
      ? `${row.member.signer.profession}${row.member.signer.registration ? `, ${row.member.signer.registration}` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    if (!editing) return;
    editBox.current?.querySelector('select')?.focus();
  }, [editing]);

  if (editing && mayStaff) {
    return (
      <div ref={editBox} className="min-w-[9rem]">
        <Select
          aria-label={`${name} in ${departmentLabel}`}
          value={explicit ?? ''}
          disabled={busy}
          onChange={(e) => onSave(e.target.value as DepartmentRole | '')}
          onBlur={onCancel}
          className="h-7 text-[11px]"
        >
          <option value="">Firm default ({DEPARTMENT_ROLE_LABEL[role]})</option>
          {DEPARTMENT_ROLES.map((r) => (
            <option key={r} value={r} title={DEPARTMENT_ROLE_HINT[r]}>
              {DEPARTMENT_ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  const chip = (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        explicit ? ROLE_CHIP[explicit] : 'bg-page text-ink-muted ring-hairline',
        mayStaff && 'cursor-pointer transition-colors duration-quick hover:ring-brand/40',
        busy && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold ring-1 ring-inset',
          avatarTint(row.email),
        )}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 truncate text-ink">{name}</span>
      <span className={cn('shrink-0', explicit ? 'text-inherit' : 'text-ink-muted')}>{DEPARTMENT_ROLE_LABEL[role]}</span>
      {!explicit ? <span className="shrink-0 text-[9px] font-normal text-ink-muted">firm</span> : null}
    </span>
  );

  if (!mayStaff) {
    return (
      <Tooltip label={detail}>
        <span className="inline-flex max-w-full">{chip}</span>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={detail}>
      <button
        type="button"
        disabled={busy}
        title="Change role"
        aria-label={`${name} in ${departmentLabel}: ${DEPARTMENT_ROLE_LABEL[role]}${explicit ? '' : ' (firm)'}. Change role.`}
        onClick={onEdit}
        className="inline-flex max-w-full rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {chip}
      </button>
    </Tooltip>
  );
}
