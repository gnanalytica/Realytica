import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIFECYCLE_STAGES, PROJECT_ARCHETYPES, type LifecycleStage, type ProjectArchetype } from '@realytica/shared';
import { api } from '../../lib/api';
import { OwnerInput } from '../../components/OwnerInput';
import { Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea, useToast } from '../../components/ui/kit';

export default function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectArchetype>('residential');
  const [city, setCity] = useState('Bengaluru');
  const [location, setLocation] = useState('');
  const [stage, setStage] = useState<LifecycleStage>('opportunity_site');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [developer, setDeveloper] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Karnataka');
  const [portfolio, setPortfolio] = useState('Bengaluru residential');
  const [landArea, setLandArea] = useState('');
  const [builtUp, setBuiltUp] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);

  function optionalNumber(value: string): number | undefined {
    const n = Number(value.replaceAll(',', ''));
    return value.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const project = await api.createProject({
        name,
        type,
        city,
        location,
        currentStage: stage,
        description: description || undefined,
        owner: owner || undefined,
        developer: developer || undefined,
        jurisdiction: jurisdiction || undefined,
        portfolio: portfolio || undefined,
        landAreaSqm: optionalNumber(landArea),
        builtUpAreaSqm: optionalNumber(builtUp),
        budget: optionalNumber(budget),
      });
      toast('Project created', 'good');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create project', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">New project</h1>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Type and stage decide which DD templates are recommended. They can be changed later; stage history is kept.
        </p>
      </div>
      <Card>
        <CardHeader title="Identity" />
        <CardBody className="space-y-3">
          <Field label="Project name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Harohalli Greenfield Township" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project type">
              <Select value={type} onChange={(e) => setType(e.target.value as ProjectArchetype)}>
                {PROJECT_ARCHETYPES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lifecycle stage">
              <Select value={stage} onChange={(e) => setStage(e.target.value as LifecycleStage)}>
                {LIFECYCLE_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} required />
            </Field>
            <Field label="Location">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} required placeholder="Locality, road, survey numbers" />
            </Field>
          </div>
          <Field label="Owner / DD lead" hint="Optional">
            <OwnerInput value={owner} onChange={setOwner} />
          </Field>
          <Field label="Developer" hint="Optional">
            <Input value={developer} onChange={(e) => setDeveloper(e.target.value)} />
          </Field>
          <Field label="Jurisdiction" hint="Optional">
            <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
          </Field>
          <Field label="Portfolio" hint="Optional grouping across projects">
            <Input value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="Bengaluru residential" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Land area (sqm)" hint="Optional">
              <Input inputMode="decimal" value={landArea} onChange={(e) => setLandArea(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Built-up (sqm)" hint="Optional">
              <Input inputMode="decimal" value={builtUp} onChange={(e) => setBuiltUp(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Budget (INR)" hint="Optional">
              <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Description" hint="Optional">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => navigate('/projects')}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          Create project
        </Button>
      </div>
    </form>
  );
}
