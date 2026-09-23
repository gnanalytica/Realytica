import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIFECYCLE_STAGES, PROJECT_ARCHETYPES, type LifecycleStage, type ProjectArchetype, type Tenure } from '@realytica/shared';
import { api } from '../../lib/api';
import { OwnerInput } from '../../components/OwnerInput';
import { Button, Card, CardBody, CardHeader, Disclosure, Field, Input, Select, Textarea, useToast } from '../../components/ui/kit';

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
  const [saleable, setSaleable] = useState('');
  const [builtUp, setBuiltUp] = useState('');
  const [budget, setBudget] = useState('');
  /*
   * The survey number, on the form that creates the file.
   *
   * `CreateProjectInput` has taken a `parcelId` since the model was written
   * and this form has never asked for one, which is why the worked client
   * file carries five documents, three valuation runs and no survey number.
   * Nothing downstream can key on a field nobody was asked for: the
   * discovery sweep refuses to search without it and the revenue-map read
   * has no parcel to fetch.
   */
  const [parcelId, setParcelId] = useState('');
  const [tenure, setTenure] = useState<Tenure | ''>('');
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

  /** Whether anything on this form gives an approach an area to work from. */
  const measured =
    optionalNumber(landArea) !== undefined ||
    optionalNumber(saleable) !== undefined ||
    optionalNumber(builtUp) !== undefined;

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
        parcelId: parcelId.trim() || undefined,
        tenure: tenure || undefined,
        landAreaSqm: optionalNumber(landArea),
        saleableAreaSqm: optionalNumber(saleable),
        builtUpAreaSqm: optionalNumber(builtUp),
        budget: optionalNumber(budget),
      });
      toast('Project created', 'good');
      /*
       * Land where the answer is, not on the front door.
       *
       * Walked on a file created with the three required fields and nothing
       * else, the route to a figure was nine steps: the Value tab said record
       * the areas and gave nowhere to do it, a valuation had to be run and
       * fail first, the input sheet then said to start an assessment, and the
       * number every one of those screens was waiting for was a project field
       * this form could have collected.
       *
       * So a file that carries a measurement opens on its figure, and one that
       * does not opens on the cells that are the reason it has none.
       */
      navigate(measured ? `/projects/${project.id}/valuation` : `/projects/${project.id}/valuation?view=inputs`);
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
        <CardHeader title="The property" />
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
          {/*
            The survey number is identity, not detail.

            It is what the encumbrance chain is searched by, what the revenue
            map is fetched by, and what a document extraction matches against.
            Sitting it beside the address is the difference between a file the
            rest of the product can work on and one it cannot.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Survey number(s)" hint="As the deed writes them. The encumbrance search and the revenue map both key on this.">
              <Input value={parcelId} onChange={(e) => setParcelId(e.target.value)} placeholder="e.g. Sy. No. 12/3, 14" />
            </Field>
            <Field label="Tenure" hint="Leasehold changes what the property is worth and what can be built on it.">
              <Select value={tenure} onChange={(e) => setTenure(e.target.value as Tenure | '')}>
                <option value="">Not known yet</option>
                <option value="freehold">Freehold</option>
                <option value="leasehold">Leasehold</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      {/*
        Its own card, because it is its own question.

        These were four fields at the bottom of Identity, every one labelled
        "(optional)", under a paragraph explaining that they were the only
        thing standing between a new project and a number. Optional is a true
        statement about the form and a misleading one about the product: the
        form does not need them and the Value tab cannot answer without them.
        Measured on a file created without them, the route to a figure was
        nine steps and two valuation runs that could not succeed.

        So they get a card, a heading in the reader's own terms, and a
        sentence that says what skipping them costs rather than reassuring
        them that it is fine.
      */}
      <Card>
        <CardHeader
          title="What it takes to value it"
          subtitle={
            measured
              ? 'Enough to run. The file will open on its indicative figure.'
              : 'Skip these and the file opens on this same sheet instead of a figure — an area is what every approach measures a rate against.'
          }
        />
        <CardBody className="space-y-3">
          <div className="grid gap-3 [@container(min-width:30rem)]:grid-cols-3">
            <Field label="Plot area, sqm" hint="The land. Unlocks the cost and residual approaches.">
              <Input inputMode="decimal" value={landArea} onChange={(e) => setLandArea(e.target.value)} placeholder="1,200" />
            </Field>
            <Field label="Area being valued, sqm" hint="Saleable or carpet area. Unlocks the comparable and income approaches.">
              <Input inputMode="decimal" value={saleable} onChange={(e) => setSaleable(e.target.value)} placeholder="950" />
            </Field>
            <Field label="Built-up, sqm" hint="Constructed area, where it differs from the area being sold.">
              <Input inputMode="decimal" value={builtUp} onChange={(e) => setBuiltUp(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Asking price, INR" hint="Compared against the indicative range, never used to produce it.">
            <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
          </Field>
        </CardBody>
      </Card>

      {/*
        Folded, because none of it changes what the file can do.

        Four fields that file the project rather than describe the property.
        Open, they were four more rows between somebody and the button, on a
        form whose whole job is to get out of the way.
      */}
      <Disclosure title="Who it belongs to, and where it files">
        <div className="space-y-3 px-3 pb-3">
          <Field label="Owner / DD lead" hint="Who leads the diligence on this file.">
            <OwnerInput value={owner} onChange={setOwner} />
          </Field>
          <Field label="Developer" hint="The counterparty building or selling it.">
            <Input value={developer} onChange={(e) => setDeveloper(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jurisdiction" hint="The state whose statutory rules apply.">
              <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Karnataka" />
            </Field>
            <Field label="Portfolio" hint="Grouping across projects.">
              <Input value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="Bengaluru residential" />
            </Field>
          </div>
          <Field label="Description" hint="Anything the file should open with.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
        </div>
      </Disclosure>

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
