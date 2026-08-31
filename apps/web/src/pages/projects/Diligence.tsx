import { useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  ASSESSMENT_STATUS_LABEL,
  DD_TYPE_DEFINITIONS,
  SCOPE_DEFINITIONS,
  SCOPE_LABEL,
  assessmentProgress,
  recommendedDdTypes,
  type DdTargetType,
  type DdTypeKey,
  type ScopeKey,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, useToast } from '../../components/ui/kit';
import type { ProjectOutlet } from './ProjectLayout';
import { LiveRow } from './LiveRow';

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

  const active = project.assessments.filter((a) => a.status !== 'completed' && a.status !== 'archived');
  const done = project.assessments.filter((a) => a.status === 'completed' || a.status === 'archived');

  function group(title: string, rows: typeof project.assessments) {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
        {rows.map((a) => {
          const progress = assessmentProgress(a);
          return (
            <Link key={a.id} to={a.id} className="block">
              <LiveRow id={a.id} highlightIds={highlightIds} variant="flush">
              <Card className="transition-colors hover:bg-sunken/60">
                <CardBody className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-ink">{a.name}</p>
                    <p className="mt-1 text-[12px] text-ink-secondary">
                      Target: {a.targetType === 'project' ? 'Whole project' : a.targetAssetIds.map((id) => project.assets.find((x) => x.id === id)?.name ?? id).join(', ')}
                    </p>
                    <p className="mt-1 text-[12px] text-ink-muted">
                      {a.scopes.map((s) => SCOPE_LABEL[s.scopeKey]).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge>{ASSESSMENT_STATUS_LABEL[a.status]}</Badge>
                    <p className="mt-2 font-mono text-[12px] text-ink-secondary">{progress.percent}% · {progress.checkDone}/{progress.checkTotal} checks</p>
                  </div>
                </CardBody>
              </Card>
              </LiveRow>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[62ch] text-[13px] text-ink-secondary">
          DD types are templates, not app tabs. Several assessments can run at once against different targets.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen(true)}>Start DD</Button>
        </div>
      </div>

      {project.assessments.length === 0 ? (
        <EmptyState
          title="No due diligence assessments"
          description="Pick a DD type. Scopes and checks instantiate from the library; expected evidence is added to the project register."
          action={<Button onClick={() => setOpen(true)}>Start the first DD</Button>}
        />
      ) : (
        <>
          {group('Active', active)}
          {group('Completed', done)}
        </>
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
          <Field label="DD type">
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
          <p className="text-[12px] text-ink-secondary">{preset.purpose}</p>
          <Field label="Name" hint="Defaults to the DD type label.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Owner">
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
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
          <Field label="Default scopes from this template">
            <p className="text-[13px] text-ink">{preset.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ') || 'None — add extra scopes for a custom DD.'}</p>
          </Field>
          <Field label="Additional scopes" hint={ddType === 'custom' ? 'Required for a custom DD.' : 'Optional extras beyond the template.'}>
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
          <Field label="Prior DD" hint="Optional. Enables changes-since-previous.">
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
