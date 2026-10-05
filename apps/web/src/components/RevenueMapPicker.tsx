import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Landmark, Square, Trash2, X } from 'lucide-react';
import { revenueReads, surveyNumberLines, surveyPieces, type DdProject, type RevenueMapRead, type SurveyNumberLine } from '@realytica/shared';
import { Button, Callout, Checkbox, Field, Input, Select, Spinner, cn } from './ui/kit';
import { api } from '../lib/api';
import { isTicked, lineDoubt, lineKey, lineSource, readInTurn, readsAgain, runPlan, settled, ticksAfter, type ReadState } from '../lib/revenue-run';

/**
 * The survey numbers, the way the revenue record keys them: state, district,
 * mandal or taluk, village — then the numbers.
 *
 * This is Kshetra's picker, on Realytica's file. The levels come from the
 * state's own cadastre one at a time (or from the engine's on-disk snapshot
 * when the map server is down, and the caption says which). Nothing here is
 * evidence; the read it produces is a government record read by machine, and
 * the card it sits in says so beside every hit.
 *
 * A site can stand on many survey numbers. Under the fields is one line for
 * each number the file knows — the project's own, every one a document was
 * read as stating, any a person types — and each is read on its own request,
 * in turn, so a line says where its number stands while the rest wait.
 */

type StateKey = 'TS' | 'KA';

const STATE_OPTIONS: { value: StateKey; label: string }[] = [
  { value: 'KA', label: 'Karnataka — Bengaluru region' },
  { value: 'TS', label: 'Telangana' },
];

function stateFromProject(project: DdProject): StateKey {
  const j = `${project.jurisdiction ?? ''} ${project.city ?? ''}`.toLowerCase();
  return /telangana|hyderabad|rangareddy|ranga reddy|medchal/.test(j) ? 'TS' : 'KA';
}

type Levels = { district: string; mandal: string; village: string };

type Suggestion = Awaited<ReturnType<typeof api.revenueSuggest>>;

/** A township's approval can list sixty numbers; past this many the rest wait behind one button. */
const LINES_SHOWN = 8;

/** One number, however it was spelt. */
function keyOf(surveyNo: string): string {
  return surveyNo.toUpperCase();
}

function NumberLine({
  line,
  ticked,
  state,
  locked,
  showVillage,
  onTick,
  onRemove,
}: {
  line: SurveyNumberLine;
  ticked: boolean;
  state: ReadState | undefined;
  locked: boolean;
  /** The reads kept span more than one village, so a read says which it is in. */
  showVillage: boolean;
  onTick: (next: boolean) => void;
  onRemove: (read: RevenueMapRead) => void;
}) {
  const source = lineSource(line, ticked);
  const read = line.read;
  // What the map answered with, from the read kept or, until the file is fetched again, from the request itself.
  const answered = read
    ? { surveyNo: read.surveyNo, areaSqm: read.areaSqm, village: showVillage ? read.village : null }
    : state?.phase === 'read'
      ? { surveyNo: state.surveyNo, areaSqm: state.areaSqm, village: null }
      : null;
  // What went wrong with the last attempt. A read that is kept stays kept when reading it again fails, and the line says both.
  // A piece that is not one survey number was never asked of the map, and says why.
  const trouble = line.unreadable
    ? { word: 'Not read', detail: line.unreadable }
    : state?.phase === 'absent'
      ? { word: 'Not in the published map', detail: state.near.length ? `Starts the same way: ${state.near.join(', ')}` : null }
      : state?.phase === 'full'
        ? { word: 'Not kept', detail: state.reason }
        : state?.phase === 'failed'
          ? { word: read ? 'Not read again' : 'Failed', detail: state.reason }
          : null;
  // A number that may be another one misread says so until it is read, in the colour of what a machine suggests.
  const doubt = trouble ? null : lineDoubt(line);
  // The state's map can hold a number under another: Karnataka's has whole survey numbers, so 41/2 is read as 41.
  const under = answered && keyOf(answered.surveyNo) !== keyOf(line.surveyNo) ? ` as Sy. ${answered.surveyNo}` : '';
  const status: ReactNode =
    state?.phase === 'reading' || state?.phase === 'waiting' ? (
      <span className="inline-flex items-center gap-1 text-ink-secondary">
        <Spinner size={12} />
        {state.phase === 'reading' ? 'Reading…' : `Waiting ${state.seconds} s, as the server asked`}
      </span>
    ) : answered || trouble ? (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        {answered ? (
          <span>
            <span className="font-medium text-[var(--status-good-text)]">Read{under}</span>
            <span className="tabular-nums text-ink-secondary">
              {answered.village ? ` · ${answered.village}` : ''} · {Math.round(answered.areaSqm).toLocaleString()} sqm
            </span>
          </span>
        ) : null}
        {trouble ? <span className="font-medium text-[var(--status-warning-text)]">{trouble.word}</span> : null}
      </span>
    ) : null;
  const detail = trouble?.detail ?? null;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-0.5">
      <Checkbox
        checked={ticked}
        disabled={locked || Boolean(line.unreadable)}
        onChange={onTick}
        label={
          <>
            <span className="sr-only">Survey number </span>
            <span className="font-mono">{line.surveyNo}</span>
          </>
        }
      />
      {/* Wraps and is never cut short: on a phone the end of this line is where it says a reading is not yet accepted. */}
      <span className={cn('min-w-0 flex-1 basis-32 text-[12px] leading-snug', source.waiting ? 'text-ai-ink' : 'text-ink-muted')}>{source.text}</span>
      {status ? <span className="text-[12px]">{status}</span> : null}
      {read ? (
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5 coarse:min-w-11"
          icon={<X size={13} />}
          disabled={locked}
          aria-label={`Remove the read of Sy. ${read.surveyNo}`}
          title={`Remove the read of Sy. ${read.surveyNo}`}
          onClick={() => onRemove(read)}
        />
      ) : null}
      {detail ? <p className="basis-full pl-6 text-[12px] leading-snug text-ink-secondary">{detail}</p> : null}
      {doubt ? <p className="basis-full pl-6 text-[12px] leading-snug text-ai-ink">{doubt}</p> : null}
    </li>
  );
}

export function RevenueMapPicker({ project, onRead }: { project: DdProject; onRead: () => Promise<void> }) {
  const [state, setState] = useState<StateKey>(() => stateFromProject(project));
  const [labels, setLabels] = useState<Levels>({ district: 'District', mandal: 'Mandal', village: 'Village' });
  const [districts, setDistricts] = useState<string[]>([]);
  const [mandals, setMandals] = useState<string[]>([]);
  const [villages, setVillages] = useState<string[]>([]);
  const [district, setDistrict] = useState('');
  const [mandal, setMandal] = useState('');
  const [village, setVillage] = useState('');
  /* What a person has typed into the field: numbers to read beside the ones the file states. */
  const [typed, setTyped] = useState('');
  const [snapshotOn, setSnapshotOn] = useState<string | null>(null);
  /* What went wrong, under a heading that says which thing it was: the map, the run, or a change to the file. */
  const [error, setErrorUnder] = useState<{ title: string; text: string } | null>(null);
  const setError = (text: string | null, title = 'The revenue map did not answer') => setErrorUnder(text ? { title, text } : null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingLevel, setLoadingLevel] = useState(false);

  const reads = useMemo(() => revenueReads(project), [project]);
  const lines = useMemo(() => surveyNumberLines(project, typed), [project, typed]);
  /* Ticks a person set by hand. A line they have not touched is ticked when they typed it, or when it is stated, accepted and not yet read. */
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  /* Where each number of the last run stands. A read that is kept speaks for itself; this holds the rest. */
  const [states, setStates] = useState<Record<string, ReadState>>({});
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  /*
   * A run of numbers takes minutes, and a person can leave for another
   * project while one is being read. What comes back after that is not put on
   * the screen they are now looking at, and the numbers still waiting are
   * not asked for.
   */
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  const [showAll, setShowAll] = useState(false);
  const plan = runPlan(lines, choices);

  /*
   * Where to start: the last read, or the village the site address names.
   * Applied a level at a time as each list arrives, and only into fields
   * nobody has touched — a person's own pick is never overwritten.
   */
  const [suggested, setSuggested] = useState<Suggestion | null>(null);
  const [touched, setTouched] = useState(false);
  const lastReadAt = reads.reduce((latest, r) => (r.readAt > latest ? r.readAt : latest), '');
  useEffect(() => {
    let live = true;
    void api
      .revenueSuggest(project.id)
      .then((s) => {
        if (!live) return;
        setSuggested(s);
        if (s.state && s.state !== state) setState(s.state);
      })
      .catch(() => {
        /* the picker starts empty, as it always did */
      });
    return () => {
      live = false;
    };
    // Once per project and per read: a fresh read is the new place to start from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, lastReadAt]);
  useEffect(() => {
    if (touched || !suggested?.district || district || !districts.includes(suggested.district)) return;
    setDistrict(suggested.district);
  }, [suggested, districts, district, touched]);
  useEffect(() => {
    if (touched || !suggested?.mandal || mandal || !mandals.includes(suggested.mandal)) return;
    setMandal(suggested.mandal);
  }, [suggested, mandals, mandal, touched]);
  useEffect(() => {
    if (touched || !suggested?.village || village || !villages.includes(suggested.village)) return;
    setVillage(suggested.village);
  }, [suggested, villages, village, touched]);
  const prefilled = Boolean(!touched && suggested?.from && village && village === suggested.village);

  useEffect(() => {
    let live = true;
    setLoadingLevel(true);
    setDistricts([]);
    setMandals([]);
    setVillages([]);
    setDistrict('');
    setMandal('');
    setVillage('');
    void api
      .revenueLevels(project.id, { state })
      .then((r) => {
        if (!live) return;
        setDistricts(r.items);
        setLabels(r.labels);
        setSnapshotOn(r.snapshotOn ?? null);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'The district list did not load.'))
      .finally(() => live && setLoadingLevel(false));
    return () => {
      live = false;
    };
  }, [project.id, state]);

  useEffect(() => {
    if (!district) return;
    let live = true;
    setLoadingLevel(true);
    setMandals([]);
    setVillages([]);
    setMandal('');
    setVillage('');
    void api
      .revenueLevels(project.id, { state, district })
      .then((r) => {
        if (!live) return;
        setMandals(r.items);
        setSnapshotOn(r.snapshotOn ?? null);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'The list did not load.'))
      .finally(() => live && setLoadingLevel(false));
    return () => {
      live = false;
    };
  }, [project.id, state, district]);

  useEffect(() => {
    if (!district || !mandal) return;
    let live = true;
    setLoadingLevel(true);
    setVillages([]);
    setVillage('');
    void api
      .revenueLevels(project.id, { state, district, mandal })
      .then((r) => {
        if (!live) return;
        setVillages(r.items);
        setSnapshotOn(r.snapshotOn ?? null);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'The village list did not load.'))
      .finally(() => live && setLoadingLevel(false));
    return () => {
      live = false;
    };
  }, [project.id, state, district, mandal]);

  const locked = running || busy;
  // Only a number read in the place picked needs one; a kept parcel read again does not.
  const placed = Boolean(district && mandal && village);
  const canRead = plan.length > 0 && !locked && (placed || plan.every((step) => readsAgain(step.line)));

  /*
   * Read every ticked line, one request each, in the order of the lines. A
   * number read in the place picked is answered from the parcel already kept
   * when the map turns out to hold it as one that is.
   */
  const readNow = async () => {
    const run = new Map(plan.map((step) => [step.key, step]));
    const keysOf = (key: string) => [key, ...(run.get(key)?.also ?? [])];
    const all = [...run.keys()].flatMap(keysOf);
    stop.current = false;
    setRunning(true);
    setShowAll(true);
    setError(null);
    setNote(null);
    setStates((now) => Object.fromEntries(Object.entries(now).filter(([k]) => !all.includes(k))));
    const outcome = await readInTurn(
      [...run.keys()],
      (key) => {
        const line = run.get(key)?.line;
        const several = run.size > 1;
        if (line?.read && readsAgain(line)) return api.readRevenueMap(project.id, { parcelRef: line.read.parcelRef, several });
        return api.readRevenueMap(project.id, { state, district, mandal, village, surveyNo: line?.surveyNo ?? '', several, unlessKept: true });
      },
      {
        // Lines that are one parcel, read again by one request, stand or fall together.
        state: (key, next) =>
          setStates((now) => {
            const rest = { ...now };
            for (const k of keysOf(key)) {
              if (next) rest[k] = next;
              else delete rest[k];
            }
            return rest;
          }),
        stop: () => stop.current || !here.current,
      },
    );
    if (!here.current) return;
    // A typed number that was read is on the file now, and leaves the field. What was typed and is not a number stays, to be put right.
    const done = new Set(outcome.done.map((key) => keyOf(run.get(key)?.line.surveyNo ?? '')));
    setTyped((now) =>
      surveyPieces(now)
        .filter((piece) => !done.has(keyOf(piece.surveyNo)))
        .map((piece) => piece.surveyNo)
        .join(', '),
    );
    setChoices((now) => ticksAfter(now, outcome.done.flatMap(keysOf)));
    if (outcome.ended) setError(outcome.ended, 'Stopped before every number was read');
    else setNote(outcome.note ?? null);
    // The map and the brief are fetched once, when the run is over: the map
    // frames the site once, on all of it, and not afresh as each parcel lands.
    try {
      await onRead();
      // From here the file says which numbers are read; the run no longer does.
      setStates(settled);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reload the page to see what was read.', 'The file could not be fetched again');
    } finally {
      setRunning(false);
    }
  };

  const change = async (act: () => Promise<void>, failed: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await act();
      if (!here.current) return;
      await onRead();
      // A read that is gone must not go on being called read by what a run left behind.
      setStates(settled);
    } catch (e) {
      setError(e instanceof Error ? e.message : failed, 'The file was not changed');
    } finally {
      setBusy(false);
    }
  };

  const everyStepIsAgain = plan.length > 0 && plan.every((step) => readsAgain(step.line));
  const readLabel =
    plan.length <= 1
      ? everyStepIsAgain
        ? 'Read again'
        : 'Read the revenue map'
      : everyStepIsAgain
        ? `Read ${plan.length} again`
        : `Read ${plan.length} numbers`;
  const shown = showAll ? lines : lines.slice(0, LINES_SHOWN);
  const showVillage = new Set(reads.map((r) => r.village)).size > 1;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium text-ink">Revenue map by survey number</p>
        <p className="text-[12px] text-ink-muted">Parcel boundary · government layers around it · guidance value</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="State">
          <Select
            value={state}
            disabled={running}
            onChange={(e) => {
              setTouched(true);
              setState(e.target.value as StateKey);
            }}
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.district}>
          <Select
            value={district}
            onChange={(e) => {
              setTouched(true);
              setDistrict(e.target.value);
            }}
            disabled={running || !districts.length}
          >
            <option value="">{districts.length ? `Select ${labels.district.toLowerCase()}` : loadingLevel ? 'Loading…' : '—'}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.mandal}>
          <Select
            value={mandal}
            onChange={(e) => {
              setTouched(true);
              setMandal(e.target.value);
            }}
            disabled={running || !mandals.length}
          >
            <option value="">{mandals.length ? `Select ${labels.mandal.toLowerCase()}` : district && loadingLevel ? 'Loading…' : '—'}</option>
            {mandals.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.village}>
          <Select
            value={village}
            onChange={(e) => {
              setTouched(true);
              setVillage(e.target.value);
            }}
            disabled={running || !villages.length}
          >
            <option value="">{villages.length ? 'Select village' : mandal && loadingLevel ? 'Loading…' : '—'}</option>
            {villages.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Survey no">
          <Input value={typed} disabled={running} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. 41/2, 41/3 and 42" inputMode="text" />
        </Field>
      </div>
      {prefilled ? (
        <p className="text-[12px] text-ink-secondary">
          {suggested?.from === 'last read' ? 'Filled from the last read.' : suggested?.note ?? 'Filled from the site address. Check it before reading.'}
        </p>
      ) : !touched && suggested?.note && !suggested.from ? (
        <p className="text-[12px] text-ink-muted">{suggested.note}</p>
      ) : null}
      {lines.length ? (
        <div>
          <ul aria-label="Survey numbers" className="divide-y divide-hairline">
            {shown.map((line) => (
              <NumberLine
                key={lineKey(line)}
                line={line}
                ticked={isTicked(line, choices)}
                state={states[lineKey(line)]}
                locked={locked}
                showVillage={showVillage}
                onTick={(next) => setChoices((now) => ({ ...now, [lineKey(line)]: next }))}
                onRemove={(read) => void change(() => api.removeRevenueRead(project.id, read.parcelRef), 'The read could not be removed.')}
              />
            ))}
          </ul>
          {shown.length < lines.length ? (
            <button
              type="button"
              className="mt-1 rounded text-[12px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              onClick={() => setShowAll(true)}
            >
              Show all {lines.length} numbers
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={<Landmark size={13} />} loading={running} disabled={!canRead} onClick={() => void readNow()}>
          {readLabel}
        </Button>
        {running ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Square size={11} />}
            onClick={() => {
              stop.current = true;
            }}
          >
            Stop after this one
          </Button>
        ) : null}
        {reads.length && !running ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={13} />}
            disabled={busy}
            onClick={() => {
              // One read is a press to put back. A dozen are an afternoon against a slow map.
              if (reads.length > 1 && !confirm(`Clear all ${reads.length} reads? Each would have to be read from the state’s map again.`)) return;
              void change(() => api.clearRevenueMap(project.id), 'The read could not be cleared.');
            }}
          >
            {reads.length === 1 ? 'Clear the read' : `Clear all ${reads.length} reads`}
          </Button>
        ) : null}
        {snapshotOn ? (
          <span className="text-[12px] text-ink-muted">
            {state === 'KA'
              ? `Place names from the K-GIS village index captured on ${snapshotOn}.`
              : `Place names from the engine’s snapshot of ${snapshotOn}; the live map is down.`}
          </span>
        ) : null}
      </div>
      {error ? (
        <Callout tone="warning" title={error.title}>
          {error.text}
        </Callout>
      ) : null}
      {note ? (
        <Callout tone="info" title="Read done">
          {note}
        </Callout>
      ) : null}
    </div>
  );
}
