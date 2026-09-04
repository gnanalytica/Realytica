import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import {
  DD_TYPE_DEFINITIONS,
  GRANT_AREAS,
  GRANT_AREA_HINT,
  GRANT_AREA_LABEL,
  PROJECT_ROLES,
  PROJECT_ROLE_HINT,
  PROJECT_ROLE_LABEL,
  SCOPE_LABEL,
  WORKSPACE_ROLE_LABEL,
  can,
  describeGrant,
  grantHasExpired,
  type CreateProjectGrantInput,
  type DdProject,
  type GrantArea,
  type ProjectGrant,
  type ProjectRole,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useMe } from '../../lib/useMe';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { formatWhen } from './shared';

/**
 * Who is on this site.
 *
 * The screen is deliberately the same shape as the grant it writes: a person,
 * what they may do, which assessments, which scopes inside them, and which of
 * the parts that belong to no scope. Reading down the form is reading the
 * access, which is the only way anybody checks these — a permissions page
 * whose meaning has to be reconstructed is a page where the wrong box stays
 * ticked for a year.
 *
 * Everything starts unticked. Adding somebody and pressing save gives them a
 * project shell and nothing in it.
 */

/** The reach half of a grant, which the add form and each row both edit. */
interface Reach {
  role: ProjectRole;
  allAssessments: boolean;
  assessmentIds: string[];
  allScopes: boolean;
  scopeKeys: ScopeKey[];
  areas: GrantArea[];
  expiresAt: string;
}

const CLOSED: Reach = {
  role: 'reviewer',
  allAssessments: false,
  assessmentIds: [],
  allScopes: false,
  scopeKeys: [],
  areas: [],
  expiresAt: '',
};

function reachOf(grant: ProjectGrant): Reach {
  return {
    role: grant.role,
    allAssessments: grant.allAssessments,
    assessmentIds: [...grant.assessmentIds],
    allScopes: grant.allScopes,
    scopeKeys: [...grant.scopeKeys],
    areas: [...grant.areas],
    expiresAt: grant.expiresAt ? grant.expiresAt.slice(0, 10) : '',
  };
}

function toInput(reach: Reach): Omit<CreateProjectGrantInput, 'email'> {
  return {
    role: reach.role,
    allAssessments: reach.allAssessments,
    assessmentIds: reach.assessmentIds,
    allScopes: reach.allScopes,
    scopeKeys: reach.scopeKeys,
    areas: reach.areas,
    // A date picker means the end of that day, not its first second.
    expiresAt: reach.expiresAt ? new Date(`${reach.expiresAt}T23:59:59.000Z`).toISOString() : '',
  };
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** The scopes that actually exist on the assessments this grant reaches. */
function scopesInReach(project: DdProject, reach: Reach): ScopeKey[] {
  const within = project.assessments.filter((a) => reach.allAssessments || reach.assessmentIds.includes(a.id));
  return [...new Set(within.flatMap((a) => a.scopes.map((s) => s.scopeKey)))];
}

function ReachForm({
  project,
  reach,
  onChange,
  disabled,
}: {
  project: DdProject;
  reach: Reach;
  onChange: (next: Reach) => void;
  disabled?: boolean;
}) {
  const scopes = useMemo(() => scopesInReach(project, reach), [project, reach]);
  const set = (over: Partial<Reach>) => onChange({ ...reach, ...over });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="On this project" hint={PROJECT_ROLE_HINT[reach.role]}>
          <Select
            value={reach.role}
            disabled={disabled}
            className="w-44"
            onChange={(e) => set({ role: e.target.value as ProjectRole })}
          >
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Access ends" hint="Leave empty for no end date.">
          <Input
            type="date"
            value={reach.expiresAt}
            disabled={disabled}
            onChange={(e) => set({ expiresAt: e.target.value })}
          />
        </Field>
      </div>

      <div>
        <p className="text-[12px] font-medium text-ink-secondary">Assessments</p>
        <Checkbox
          checked={reach.allAssessments}
          disabled={disabled}
          onChange={(v) => set({ allAssessments: v })}
          label={<span>Every assessment, <span className="text-ink-muted">including ones started later</span></span>}
        />
        {reach.allAssessments ? null : (
          <div className="mt-0.5 space-y-0.5 pl-1">
            {project.assessments.length === 0 ? (
              <p className="text-[12px] text-ink-muted">No assessments on this project yet.</p>
            ) : (
              project.assessments.map((a) => (
                <Checkbox
                  key={a.id}
                  checked={reach.assessmentIds.includes(a.id)}
                  disabled={disabled}
                  onChange={() => set({ assessmentIds: toggle(reach.assessmentIds, a.id) })}
                  label={
                    <span>
                      {DD_TYPE_DEFINITIONS.find((d) => d.key === a.ddType)?.label ?? a.ddType}
                      <span className="text-ink-muted"> · {a.scopes.length} scope{a.scopes.length === 1 ? '' : 's'}</span>
                    </span>
                  }
                />
              ))
            )}
          </div>
        )}
      </div>

      <div>
        <p className="text-[12px] font-medium text-ink-secondary">Scopes inside them</p>
        <Checkbox
          checked={reach.allScopes}
          disabled={disabled}
          onChange={(v) => set({ allScopes: v })}
          label={<span>Every scope, <span className="text-ink-muted">including ones added later</span></span>}
        />
        {reach.allScopes ? null : (
          <div className="mt-0.5 flex flex-wrap gap-x-4 pl-1">
            {scopes.length === 0 ? (
              <p className="text-[12px] text-ink-muted">Tick an assessment above to choose its scopes.</p>
            ) : (
              scopes.map((key) => (
                <Checkbox
                  key={key}
                  checked={reach.scopeKeys.includes(key)}
                  disabled={disabled}
                  onChange={() => set({ scopeKeys: toggle(reach.scopeKeys, key) })}
                  label={SCOPE_LABEL[key]}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div>
        <p className="text-[12px] font-medium text-ink-secondary">
          Beyond the scopes
          <span className="ml-1 font-normal text-ink-muted">— each off unless ticked</span>
        </p>
        <div className="mt-0.5 pl-1">
          {GRANT_AREAS.map((areaKey) => (
            <Checkbox
              key={areaKey}
              checked={reach.areas.includes(areaKey)}
              disabled={disabled}
              onChange={() => set({ areas: toggle(reach.areas, areaKey) })}
              label={
                <span>
                  {GRANT_AREA_LABEL[areaKey]}
                  <span className="text-ink-muted"> — {GRANT_AREA_HINT[areaKey]}</span>
                </span>
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectPeople() {
  const { project } = useOutletContext<ProjectOutlet>();
  const me = useMe();
  const toast = useToast();
  const { data, error, loading, refresh } = useAsync(() => api.projectPeople(project.id), [project.id]);
  const mayStaff = me ? can(me.role, 'admin') : false;

  const [email, setEmail] = useState('');
  const [fresh, setFresh] = useState<Reach>(CLOSED);
  const [editing, setEditing] = useState<Record<string, Reach>>({});
  const [busy, setBusy] = useState(false);

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast(what, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not go through', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Callout tone="critical" title="Could not load who is on this project">{error}</Callout> : null}
      {loading && !data ? <Skeleton className="h-32 w-full" /> : null}

      {data ? (
        <Card>
          <CardHeader
            title="On this project"
            subtitle={`${data.people.length} named · ${data.staff.length} staff reach every project`}
            info="Staff and managers see every project in the workspace. Everybody listed here sees only what is ticked against their name."
          />
          <CardBody className="divide-y divide-hairline p-0">
            {data.people.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Nobody is named on this project"
                  description="Add a contractor or consultant to give them part of this project."
                />
              </div>
            ) : null}
            {data.people.map((person) => {
              const expired = grantHasExpired(person);
              const draft = editing[person.id];
              return (
                <div key={person.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink">
                        {person.name ?? person.email}
                        {expired ? <Badge tone="critical" className="ml-2">Access ended</Badge> : null}
                        {!person.signedIn && !expired ? (
                          <Badge className="ml-2">Not signed in yet</Badge>
                        ) : null}
                      </p>
                      <p className="text-[12px] text-ink-muted">
                        {person.name ? `${person.email} · ` : ''}
                        {describeGrant(person)}
                        {person.expiresAt ? ` · until ${formatWhen(person.expiresAt)}` : ''}
                      </p>
                    </div>
                    {mayStaff ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            setEditing((prev) => {
                              const next = { ...prev };
                              if (next[person.id]) delete next[person.id];
                              else next[person.id] = reachOf(person);
                              return next;
                            })
                          }
                        >
                          {draft ? 'Cancel' : 'Change'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`Take ${person.email} off this project?`)) return;
                            void run(`${person.email} is off this project`, () =>
                              api.removeProjectPerson(project.id, person.id),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {draft ? (
                    <div className="mt-3 rounded-lg border border-hairline bg-sunken p-3">
                      <ReachForm
                        project={project}
                        reach={draft}
                        disabled={busy}
                        onChange={(next) => setEditing((prev) => ({ ...prev, [person.id]: next }))}
                      />
                      <div className="mt-3">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void run(`Changed what ${person.email} can reach`, async () => {
                              await api.setProjectPersonReach(project.id, person.id, toInput(draft));
                              setEditing((prev) => {
                                const next = { ...prev };
                                delete next[person.id];
                                return next;
                              });
                            })
                          }
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      {mayStaff && data ? (
        <Card>
          <CardHeader
            title="Add somebody"
            info="They get in by signing in with this address. No email is sent, and nothing is ticked until you tick it."
          />
          <CardBody className="space-y-3">
            <Field label="Email" className="max-w-md">
              <Input
                type="email"
                value={email}
                placeholder="contractor@firm.in"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <ReachForm project={project} reach={fresh} disabled={busy} onChange={setFresh} />
            <Button
              icon={<UserPlus size={14} />}
              disabled={busy || !email.trim()}
              onClick={() =>
                void run(`${email.trim()} is on this project`, async () => {
                  await api.addProjectPerson(project.id, { ...toInput(fresh), email: email.trim() });
                  setEmail('');
                  setFresh(CLOSED);
                })
              }
            >
              Add to this project
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {data && data.staff.length > 0 ? (
        <Disclosure title={`${data.staff.length} people reach this project as workspace staff`}>
          <div className="space-y-1 pt-1">
            {data.staff.map((s) => (
              <p key={s.email} className="text-[12.5px] text-ink-secondary">
                {s.name ?? s.email}
                <span className="text-ink-muted"> · {WORKSPACE_ROLE_LABEL[s.role]}</span>
              </p>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
