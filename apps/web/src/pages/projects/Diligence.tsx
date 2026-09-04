import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  ASSESSMENT_STATUS_LABEL,
  DD_TYPE_DEFINITIONS,
  SCOPE_DEFINITIONS,
  SCOPE_LABEL,
  assessmentProgress,
  recommendedDdTypes,
  scopeCompleteness,
  type DdAssessment,
  type DdTargetType,
  type DdTypeKey,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { LiveRow } from './LiveRow';
import { OwnerInput } from '../../components/OwnerInput';
import { useStickyState } from '../../lib/useStickyState';

type Lens = 'open' | 'done' | 'all';

const LENS_LABEL: Record<Lens, string> = { open: 'Open', done: 'Completed', all: 'All' };

/** Past this many assessments, the eye needs a filter more than it needs a list. */
const FILTER_FROM = 4;

export default function Diligence() {
  const { project, setProject, highlightIds } = useOutletContext<ProjectOutlet>();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ddType, setDdType] = useState<DdTypeKey>('acquisition');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState(project.owner ?? '');
  const [targetType, setTargetType] = useState<DdTargetType>('project');
  const [targetAssetIds, setTargetAssetIds] = useState<string[]>([]);
  const [priorId, setPriorId] = useState('');
  const [extra, setExtra] = useState<ScopeKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [lens, setLens] = useStickyState<Lens>(project.id, 'ddLens', 'open', (v) => v in LENS_LABEL);
  const [query, setQuery] = useState('');

  const preset = DD_TYPE_DEFINITIONS.find((d) => d.key === ddType)!;
  const recommended = useMemo(() => recommendedDdTypes(project.currentStage), [project.currentStage]);

  async function start() {
    setBusy(true);
    try {
      const created = await api.createAssessment(project.id, {
        ddType,
        name: name || undefined,
        owner,
        targetType,
        targetAssetIds: targetType === 'assets' ? targetAssetIds : undefined,
        extraScopes: extra,
        priorAssessmentId: priorId || undefined,
      });
      setProject(await api.getProject(project.id));
      setOpen(false);
      toast(`${created.name} started`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start DD', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const closed = (a: DdAssessment) => a.status === 'completed' || a.status === 'archived';
  const counts = {
    open: project.assessments.filter((a) => !closed(a)).length,
    done: project.assessments.filter(closed).length,
    all: project.assessments.length,
  };

  // Search covers the assessment's name, its type and the scopes inside it,
  // because "where is the flood check" is a likelier question than "what was
  // that assessment called".
  const q = query.trim().toLowerCase();
  const rows = project.assessments.filter((a) => {
    if (lens === 'open' && closed(a)) return false;
    if (lens === 'done' && !closed(a)) return false;
    if (!q) return true;
    const hay = [
      a.name,
      DD_TYPE_DEFINITIONS.find((d) => d.key === a.ddType)?.label ?? a.ddType,
      ...a.scopes.map((s) => SCOPE_LABEL[s.scopeKey]),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const showFilters = project.assessments.length >= FILTER_FROM;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(['open', 'done', 'all'] as Lens[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLens(k)}
                  aria-pressed={lens === k}
                  className={
                    lens === k
                      ? 'rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand'
                      : 'rounded-full px-2.5 py-1 text-[12px] text-ink-muted hover:text-ink'
                  }
                >
                  {LENS_LABEL[k]} {counts[k]}
                </button>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or scope"
              className="w-56"
              aria-label="Filter assessments"
            />
          </div>
        ) : (
          <span />
        )}
        <Button onClick={() => setOpen(true)}>Start DD</Button>
      </div>

      {project.assessments.length === 0 ? (
        <EmptyState
          title="No due diligence assessments"
          description="Scopes and checks instantiate from the library."
          action={<Button onClick={() => setOpen(true)}>Start the first DD</Button>}
        />
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Nothing matches.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const progress = assessmentProgress(a);
            const target =
              a.targetType === 'project'
                ? 'Whole project'
                : a.targetAssetIds.map((id) => project.assets.find((x) => x.id === id)?.name ?? id).join(', ');
            return (
              <li key={a.id}>
                <LiveRow id={a.id} highlightIds={highlightIds} variant="flush">
                  <Card>
                    <CardBody className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link to={a.id} className="text-[14px] font-semibold text-ink hover:text-brand">
                            {a.name}
                          </Link>
                          <p className="mt-0.5 text-[12px] text-ink-muted">{target}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <Badge>{ASSESSMENT_STATUS_LABEL[a.status]}</Badge>
                          <p className="tabular mt-1.5 text-[12px] text-ink-secondary">
                            {progress.checkDone}/{progress.checkTotal} checks
                          </p>
                        </div>
                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full bg-brand" style={{ width: `${progress.percent}%` }} />
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {a.scopes.map((s) => {
                          const c = scopeCompleteness(s);
                          return (
                            <Link
                              key={s.id}
                              to={`${a.id}/scopes/${s.id}`}
                              className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-[11.5px] text-ink-secondary hover:text-brand coarse:min-h-11"
                            >
                              {SCOPE_LABEL[s.scopeKey]}
                              <span className="tabular text-[10.5px] text-ink-muted">
                                {c.done}/{c.total}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </CardBody>
                  </Card>
                </LiveRow>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start due diligence"
        width="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void start()} disabled={busy || !owner.trim() || (targetType === 'assets' && targetAssetIds.length === 0) || (ddType === 'custom' && extra.length === 0)}>
              Create assessment
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {recommended.length > 0 ? (
            <p className="text-[12px] text-ink-muted">
              Recommended at {project.currentStage.replaceAll('_', ' ')}: {recommended.map((d) => d.label).join(', ')}
            </p>
          ) : null}
          <Field label="DD type" hint={preset.purpose}>
            <Select
              value={ddType}
              onChange={(e) => {
                const next = e.target.value as DdTypeKey;
                setDdType(next);
                setExtra([]);
              }}
            >
              {DD_TYPE_DEFINITIONS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name" hint="Defaults to the DD type label.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Owner">
            <OwnerInput value={owner} onChange={setOwner} project={project} />
          </Field>
          <Field label="Target">
            <Select value={targetType} onChange={(e) => setTargetType(e.target.value as DdTargetType)}>
              <option value="project">Whole project</option>
              <option value="assets">Selected assets</option>
            </Select>
          </Field>
          {targetType === 'assets' ? (
            <Field label="Assets">
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
                {project.assets.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={targetAssetIds.includes(a.id)}
                      onChange={(e) =>
                        setTargetAssetIds((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)))
                      }
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label="Scopes from this template">
            <p className="text-[13px] text-ink">{preset.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ') || 'None — add extra scopes for a custom DD.'}</p>
          </Field>
          <Field label="Additional scopes" hint={ddType === 'custom' ? 'Required for a custom DD.' : undefined}>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
              {SCOPE_DEFINITIONS.filter((s) => !preset.defaultScopes.includes(s.key)).map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={extra.includes(s.key)}
                    onChange={(e) =>
                      setExtra((prev) => (e.target.checked ? [...prev, s.key] : prev.filter((k) => k !== s.key)))
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Prior DD" hint="Enables changes-since-previous.">
            <Select value={priorId} onChange={(e) => setPriorId(e.target.value)}>
              <option value="">None</option>
              {project.assessments.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
