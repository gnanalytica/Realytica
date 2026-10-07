import { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
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
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, cn, useToast } from '../ui/kit';

interface Row {
  email: string;
  name?: string;
  workspaceRole?: WorkspaceRole;
  member?: TeamMember;
}

/**
 * Who does what, department by department.
 *
 * The firm's own people start from their firm role — owners and managers
 * lead, staff contribute, viewers read — and any cell can say otherwise for
 * this project. Somebody from outside the firm reaches only the departments
 * given to them here, and what they can see follows from it.
 */
export function TeamRoles({ project, staff, onChanged }: { project: DdProject; staff: Array<{ email: string; name?: string; role: WorkspaceRole }>; onChanged: (p: DdProject) => void }) {
  const me = useMe();
  const toast = useToast();
  const mayStaff = me ? can(me.role, 'admin') : false;
  const departments = DEPARTMENTS.filter((d) => projectDepartments(project).includes(d.key));
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState({ email: '', name: '', department: departments[0]?.key ?? 'legal', role: 'contributor' as DepartmentRole, profession: '', registration: '' });

  const rows = useMemo<Row[]>(() => {
    const out = new Map<string, Row>();
    for (const s of staff) out.set(s.email.toLowerCase(), { email: s.email.toLowerCase(), name: s.name, workspaceRole: s.role });
    for (const m of project.team ?? []) out.set(m.email, { ...(out.get(m.email) ?? { email: m.email }), member: m, name: m.name ?? out.get(m.email)?.name });
    return [...out.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [project.team, staff]);

  async function save(row: Row, department: DepartmentKey, role: DepartmentRole | '') {
    const current = { ...(row.member?.departments ?? {}) };
    if (role) current[department] = role;
    else delete current[department];
    if (role === 'signer' && !row.member?.signer) {
      toast('A signer needs a profession and registration.', 'warning');
      return;
    }
    setBusy(row.email);
    try {
      const res = Object.keys(current).length
        ? await workspaceApi.setTeamMember(project.id, row.email, { name: row.name, departments: current, ...(row.member?.signer ? { signer: row.member.signer } : {}) })
        : await workspaceApi.removeTeamMember(project.id, row.email);
      onChanged(res.project);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change their role', 'critical');
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    setBusy('new');
    try {
      const res = await workspaceApi.setTeamMember(project.id, adding.email.trim(), {
        name: adding.name.trim() || undefined,
        departments: { [adding.department]: adding.role },
        ...(adding.role === 'signer' ? { signer: { profession: adding.profession.trim(), registration: adding.registration.trim() || undefined } } : {}),
      });
      onChanged(res.project);
      toast(`${adding.name.trim() || adding.email.trim()} is on the project as ${DEPARTMENT_ROLE_LABEL[adding.role].toLowerCase()} in ${DEPARTMENT_SHORT[adding.department as DepartmentKey]}.`, 'good');
      setAdding({ ...adding, email: '', name: '', profession: '', registration: '' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add them', 'critical');
    } finally {
      setBusy(null);
    }
  }

  const person = (row: Row) => (
    <>
      <p className="font-medium text-ink">{row.name ?? row.email}</p>
      <p className="text-micro text-ink-muted [overflow-wrap:anywhere]">
        {row.name ? `${row.email} · ` : ''}
        {row.workspaceRole ? WORKSPACE_ROLE_LABEL[row.workspaceRole] : 'Outside the firm'}
        {row.member?.signer ? ` · ${row.member.signer.profession}${row.member.signer.registration ? `, ${row.member.signer.registration}` : ''}` : ''}
      </p>
    </>
  );

  const roleFor = (row: Row, d: (typeof departments)[number], className?: string) => {
    const explicit = row.member?.departments[d.key];
    const effective = departmentRole(project, { email: row.email, workspaceRole: row.workspaceRole }, d.key);
    if (mayStaff) {
      return (
        <Select
          aria-label={`${row.name ?? row.email} in ${d.label}`}
          title={explicit ? undefined : 'Their firm role'}
          value={explicit ?? ''}
          disabled={busy !== null}
          onChange={(e) => void save(row, d.key, e.target.value as DepartmentRole | '')}
          className={cn('h-8', !explicit && 'text-ink-muted', className)}
        >
          <option value="">{effective ? DEPARTMENT_ROLE_LABEL[effective] : '—'}</option>
          {DEPARTMENT_ROLES.map((r) => (
            <option key={r} value={r} title={DEPARTMENT_ROLE_HINT[r]}>
              {DEPARTMENT_ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      );
    }
    return effective ? <Badge tone={effective === 'lead' ? 'brand' : 'neutral'}>{DEPARTMENT_ROLE_LABEL[effective]}</Badge> : <span className="text-ink-muted">—</span>;
  };

  return (
    <Card>
      <CardHeader
        title="Roles by department"
        subtitle="Lead runs it · Contributor adds records · Signer certifies · Viewer reads"
        info="The firm role is the default. Change a cell to set a different role on this project."
      />
      {/*
        A person a row and a department a column while the card has the room;
        below that, a person a block with their departments two to a row.

        The table needs 40rem. On a phone it scrolled sideways with no sign
        that it did, and the second department's role was already past the
        edge. The card measures itself (a container), because inside a project
        it is as wide as the pane the chat leaves, not as the window.
      */}
      <CardBody className="p-0 [container-type:inline-size]">
        <ul className="divide-y divide-hairline [@container(min-width:40rem)]:hidden">
          {rows.map((row) => (
            <li key={row.email} className={cn('space-y-2.5 px-4 py-3', busy === row.email && 'opacity-60')}>
              <div className="text-[13px]">{person(row)}</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {departments.map((d) => (
                  <div key={d.key} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{DEPARTMENT_SHORT[d.key]}</dt>
                    <dd className="mt-1">{roleFor(row, d)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto [@container(min-width:40rem)]:block">
          <table className="w-full min-w-[40rem] text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                <th className="px-4 py-2 font-semibold">Person</th>
                {departments.map((d) => (
                  <th key={d.key} className="px-2 py-2 font-semibold">
                    {DEPARTMENT_SHORT[d.key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row) => (
                <tr key={row.email} className={cn(busy === row.email && 'opacity-60')}>
                  <td className="px-4 py-2 align-top">{person(row)}</td>
                  {departments.map((d) => (
                    <td key={d.key} className="px-2 py-2 align-top">
                      {roleFor(row, d, 'min-w-[7.5rem]')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mayStaff ? <p className="px-4 pb-3 pt-1 text-micro text-ink-muted">A grey role is their firm role. Pick another to change it here only.</p> : null}
      </CardBody>
      {mayStaff ? (
        <div className="space-y-3 border-t border-hairline p-4">
          <p className="text-[12px] font-semibold text-ink">Add someone</p>
          <div className="grid grid-cols-1 gap-3 [@container(min-width:44rem)]:grid-cols-4">
            <Field label="Email">
              <Input type="email" value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} placeholder="advocate@firm.in" />
            </Field>
            <Field label="Name">
              <Input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            </Field>
            <Field label="Department">
              <Select value={adding.department} onChange={(e) => setAdding({ ...adding, department: e.target.value as DepartmentKey })}>
                {departments.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as DepartmentRole })}>
                {DEPARTMENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {DEPARTMENT_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {adding.role === 'signer' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Profession" hint="Advocate, Registered Valuer, Structural Engineer.">
                <Input value={adding.profession} onChange={(e) => setAdding({ ...adding, profession: e.target.value })} />
              </Field>
              <Field label="Registration" hint="Enrolment, IBBI or council number.">
                <Input value={adding.registration} onChange={(e) => setAdding({ ...adding, registration: e.target.value })} />
              </Field>
            </div>
          ) : null}
          <Button
            icon={<UserPlus size={14} />}
            loading={busy === 'new'}
            disabled={!adding.email.trim() || (adding.role === 'signer' && !adding.profession.trim())}
            onClick={() => void add()}
          >
            Add to the project
          </Button>
          <p className="text-micro text-ink-muted">Outside collaborators reach only the departments given to them. Nothing is emailed.</p>
        </div>
      ) : null}
    </Card>
  );
}
