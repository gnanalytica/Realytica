import { useEffect, useState } from 'react';
import { Landmark, Trash2 } from 'lucide-react';
import { surveyNoFromParcelId, type DdProject, type GisOverlayRead } from '@realytica/shared';
import { Button, Callout, Field, Input, Select } from './ui/kit';
import { api } from '../lib/api';

/**
 * The survey number, the way the revenue record keys it: state, district,
 * mandal or taluk, village — then the number.
 *
 * This is Kshetra's picker, on Realytica's file. The levels come from the
 * state's own cadastre one at a time (or from the engine's on-disk snapshot
 * when the map server is down, and the caption says which). Nothing here is
 * evidence; the read it produces is a government record read by machine, and
 * the card it sits in says so beside every hit.
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

export function RevenueMapPicker({
  project,
  read,
  onRead,
}: {
  project: DdProject;
  read: GisOverlayRead['revenue'] | undefined;
  onRead: () => Promise<void>;
}) {
  const [state, setState] = useState<StateKey>(() => stateFromProject(project));
  const [labels, setLabels] = useState<Levels>({ district: 'District', mandal: 'Mandal', village: 'Village' });
  const [districts, setDistricts] = useState<string[]>([]);
  const [mandals, setMandals] = useState<string[]>([]);
  const [villages, setVillages] = useState<string[]>([]);
  const [district, setDistrict] = useState('');
  const [mandal, setMandal] = useState('');
  const [village, setVillage] = useState('');
  const [surveyNo, setSurveyNo] = useState(() => surveyNoFromParcelId(project.parcelId));
  const [snapshotOn, setSnapshotOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingLevel, setLoadingLevel] = useState(false);

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

  const canRead = Boolean(district && mandal && village && surveyNo.trim()) && !busy;

  const readNow = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.readRevenueMap(project.id, { state, district, mandal, village, surveyNo: surveyNo.trim() });
      setNote(r.note);
      await onRead();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The revenue map could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.clearRevenueMap(project.id);
      await onRead();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The read could not be cleared.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-sunken p-3 ring-1 ring-inset ring-[var(--ring)]">
      <p className="text-[12px] leading-relaxed text-ink-secondary">
        Read the state’s revenue map for a survey number: the parcel as the cadastre draws it, the government layers
        around it, and the published guidance value. A record read by machine — not a survey, not evidence.
      </p>
      {read ? (
        <p className="text-[12px] text-ink">
          On file: Sy. {read.surveyNo}
          {read.village ? `, ${read.village}` : ''} — {read.sourceLabel}, read {read.readAt.slice(0, 10)}.{' '}
          <span className="tabular-nums">{read.featureCount}</span> features
          {read.unreadLayers.length ? `; ${read.unreadLayers.length} layer${read.unreadLayers.length === 1 ? '' : 's'} unread` : ''}.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="State">
          <Select value={state} onChange={(e) => setState(e.target.value as StateKey)}>
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.district}>
          <Select value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!districts.length}>
            <option value="">{districts.length ? `Select ${labels.district.toLowerCase()}` : loadingLevel ? 'Loading…' : '—'}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.mandal}>
          <Select value={mandal} onChange={(e) => setMandal(e.target.value)} disabled={!mandals.length}>
            <option value="">{mandals.length ? `Select ${labels.mandal.toLowerCase()}` : district && loadingLevel ? 'Loading…' : '—'}</option>
            {mandals.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.village}>
          <Select value={village} onChange={(e) => setVillage(e.target.value)} disabled={!villages.length}>
            <option value="">{villages.length ? 'Select village' : mandal && loadingLevel ? 'Loading…' : '—'}</option>
            {villages.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Survey no">
          <Input value={surveyNo} onChange={(e) => setSurveyNo(e.target.value)} placeholder="e.g. 12 or 12/1" inputMode="text" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" icon={<Landmark size={13} />} loading={busy} disabled={!canRead} onClick={() => void readNow()}>
          {read ? 'Read again' : 'Read the revenue map'}
        </Button>
        {read ? (
          <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void clear()}>
            Clear the read
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
        <Callout tone="warning" title="The revenue map did not answer">
          {error}
        </Callout>
      ) : null}
      {note ? <p className="text-[12px] leading-relaxed text-ink-secondary">{note}</p> : null}
    </div>
  );
}
