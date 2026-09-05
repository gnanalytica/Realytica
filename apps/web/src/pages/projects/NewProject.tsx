import { useRef, useState } from 'react';
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
  /*
   * Empty, not "Bengaluru" / "Karnataka" / "Bengaluru residential".
   *
   * Three fields arrived filled with one existing project's real values, in
   * the same dark text as something you had typed. Nothing distinguished
   * "we guessed this for you" from "you entered this", so the safe reading
   * of the form was that somebody had already filled half of it — and the
   * fastest way to file a project under the wrong portfolio is to be shown
   * the right-looking one and not be told it was a guess.
   *
   * A placeholder can suggest the shape without asserting the value.
   */
  const [city, setCity] = useState('');
  const [location, setLocation] = useState('');
  const [stage, setStage] = useState<LifecycleStage>('opportunity_site');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [developer, setDeveloper] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [landArea, setLandArea] = useState('');
  const [builtUp, setBuiltUp] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * Errors appear on submit, not on every keystroke — telling somebody the
   * name is required while they are still walking towards the field is noise.
   * Once a field has been reported on, it clears as soon as it is valid.
   */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  function optionalNumber(value: string): number | undefined {
    const n = Number(value.replaceAll(',', ''));
    return value.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'A project needs a name before it can be created.';
    if (!city.trim()) next.city = 'Which city is this project in?';
    if (!location.trim()) next.location = 'Where on the ground — locality, road, or survey numbers.';
    return next;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    /*
     * The submit button used to be `disabled` whenever the name was empty,
     * which is why pressing it did nothing at all: a disabled button cannot
     * submit, so it never reached this function, never tripped the browser's
     * own `required` handling, and never said why. The button stays live and
     * the form answers.
     */
    const found = validate();
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      const field = formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
      field?.focus();
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
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
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="mx-auto max-w-2xl space-y-4">
      {/*
        The sentence under the heading was about two fields forty pixels
        below it, so it moved onto them as hints — which is where somebody
        choosing a type or a stage is actually looking.
      */}
      <h1 className="text-xl font-semibold tracking-tight text-ink">New project</h1>
      <Card>
        <CardHeader title="Identity" />
        <CardBody className="space-y-3">
          {/* A placeholder that is the real name of the one project already in
              the system reads as a value, not an example. */}
          <Field label="Project name" required error={errors.name}>
            <Input
              name="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name && e.target.value.trim()) setErrors((p) => ({ ...p, name: '' }));
              }}
              placeholder="e.g. Kanakapura Heights Phase 2"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project type" hint="Decides which DD templates get recommended. Changeable later.">
              <Select value={type} onChange={(e) => setType(e.target.value as ProjectArchetype)}>
                {PROJECT_ARCHETYPES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lifecycle stage" hint="Changeable later — the history is kept.">
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
            <Field label="City" required hint="The jurisdictional city — what the registry and the authorities call it." error={errors.city}>
              <Input
                name="city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (errors.city && e.target.value.trim()) setErrors((p) => ({ ...p, city: '' }));
                }}
                placeholder="e.g. Bengaluru"
              />
            </Field>
            <Field label="Location" required hint="Where on the ground, inside that city." error={errors.location}>
              <Input
                name="location"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  if (errors.location && e.target.value.trim()) setErrors((p) => ({ ...p, location: '' }));
                }}
                placeholder="Locality, road, survey numbers"
              />
            </Field>
          </div>
          <Field label="Owner / DD lead (optional)" hint="Who leads the diligence on this file.">
            <OwnerInput value={owner} onChange={setOwner} />
          </Field>
          <Field label="Developer (optional)" hint="The counterparty building or selling it.">
            <Input value={developer} onChange={(e) => setDeveloper(e.target.value)} />
          </Field>
          <Field label="Jurisdiction (optional)" hint="The state whose statutory rules apply.">
            <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Karnataka" />
          </Field>
          <Field label="Portfolio (optional)" hint="Optional grouping across projects.">
            <Input value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="Bengaluru residential" />
          </Field>
          {/*
            Optional to the form, and the only thing standing between a new
            project and a number.
            Every valuation approach measures a rate against an area, so a
            project created without these answers "no approach had all of its
            inputs" on the Value tab — four rows each naming what it lacks. That
            is honest and it is not what somebody expected from a field marked
            optional with no further comment. Say what they unlock.
          */}
          <p className="text-[12px] text-ink-secondary">
            Optional, but these three are what the Value tab needs: an area and a locality median are the whole of
            an indicative range. Without an area every approach reports a missing input instead of a figure.
          </p>
          <div className="grid gap-3 [@container(min-width:30rem)]:grid-cols-3">
            <Field label="Land area, sqm (optional)" hint="Plot extent — unlocks the land and residual approaches.">
              <Input inputMode="decimal" value={landArea} onChange={(e) => setLandArea(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Built-up, sqm (optional)" hint="Constructed area — unlocks the comparable-rate approach.">
              <Input inputMode="decimal" value={builtUp} onChange={(e) => setBuiltUp(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Budget, INR (optional)" hint="Asking price — compared against the indicated range.">
              <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Description (optional)" hint="Anything the file should open with.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => navigate('/projects')}>
          Cancel
        </Button>
        {/* Never disabled on an empty field — that is the silent failure. */}
        <Button type="submit" disabled={busy}>
          Create project
        </Button>
      </div>
    </form>
  );
}
