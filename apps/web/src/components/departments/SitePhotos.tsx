import { useMemo, useState } from 'react';
import { Camera, Check, MapPin, Pencil, Sparkles } from 'lucide-react';
import { departmentRole, projectPhotos, roleCanEdit, type DdProject, type PhotoCandidate } from '@realytica/shared';
import { api } from '../../lib/api';
import { workspaceApi } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { Badge, Button, Card, CardBody, CardHeader, Input, Textarea, cn, useToast } from '../ui/kit';
import { CandidateThumb } from './ObservationsCard';

type Filter = 'all' | 'in' | 'out';

/**
 * One photograph: the picture, what a person says about it, what a model saw
 * in it, and whether it goes in the report.
 *
 * The caption and the area are the person's. A model's description arrives
 * as a suggestion, the way a value read off a document does: it is accepted
 * or edited here, and only then is it the photograph's description and
 * printed in the report. A photograph an observation cites is in the report with that
 * observation, so its switch is already on and says why.
 */
function PhotoCard({
  project,
  photo,
  mayEdit,
  refresh,
  onChanged,
}: {
  project: DdProject;
  photo: PhotoCandidate;
  mayEdit: boolean;
  refresh: () => Promise<void>;
  onChanged: (next: DdProject) => void;
}) {
  const toast = useToast();
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [area, setArea] = useState(photo.area ?? '');
  const [busy, setBusy] = useState<'save' | 'ai' | 'report' | null>(null);
  // The description being typed: null when nobody is typing.
  const [writing, setWriting] = useState<string | null>(null);
  const cited = photo.usedIn.length > 0;
  const on = cited || photo.inReport;

  /** A photograph is described and chosen by its row on the register; one from the site log gets its row here. */
  async function filed(): Promise<{ evidenceId: string; fileId: string } | undefined> {
    if (photo.evidenceId && photo.fileId) return { evidenceId: photo.evidenceId, fileId: photo.fileId };
    if (!photo.siteLog) return undefined;
    const res = await workspaceApi.fileSitePhoto(project.id, photo.siteLog.entryId, photo.siteLog.index);
    const row = res.project.evidence.find((e) => e.id === res.evidenceId);
    const shot = row?.attachments.find((a) => a.mimeType.startsWith('image/'));
    return shot ? { evidenceId: res.evidenceId, fileId: shot.id } : undefined;
  }

  async function act(kind: 'save' | 'ai' | 'report', work: (ids: { evidenceId: string; fileId: string }) => Promise<string | void>) {
    setBusy(kind);
    try {
      const ids = await filed();
      if (!ids) throw new Error('That photograph could not be found.');
      const said = await work(ids);
      await refresh();
      if (said) toast(said, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not save', 'critical');
    } finally {
      setBusy(null);
    }
  }

  const describe = (text: string | null) =>
    void act('save', async (ids) => {
      const res = await workspaceApi.setPhotoDescription(project.id, ids.evidenceId, text);
      onChanged(res.project);
      setWriting(null);
    });

  const dirty = caption.trim() !== (photo.caption ?? '') || area.trim() !== (photo.area ?? '');
  const save = () => {
    if (!dirty) return;
    void act('save', async (ids) => {
      await api.setCapture(project.id, ids.evidenceId, ids.fileId, { caption: caption.trim(), zone: area.trim() });
    });
  };

  return (
    <li className={cn('flex flex-col gap-2 rounded-xl p-2.5 ring-1 ring-inset transition-colors duration-quick ease-state', on ? 'bg-brand-soft/40 ring-brand/30' : 'bg-surface ring-[var(--ring)]')}>
      <CandidateThumb project={project} photo={photo} size="lg" />
      <Input value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={save} disabled={!mayEdit || busy !== null} placeholder="Caption" aria-label={`Caption for ${photo.title}`} />
      <Input value={area} onChange={(e) => setArea(e.target.value)} onBlur={save} disabled={!mayEdit || busy !== null} placeholder="Area" aria-label={`Area for ${photo.title}`} />
      <p className="flex flex-wrap items-center gap-x-2 text-micro text-ink-muted">
        {photo.takenAt ? new Date(photo.takenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded'}
        {photo.point ? (
          <span className="inline-flex items-center gap-0.5">
            <MapPin size={10} aria-hidden />
            {photo.point.lat.toFixed(4)}, {photo.point.lng.toFixed(4)}
          </span>
        ) : null}
      </p>
      {writing !== null ? (
        <div className="space-y-1.5">
          <Textarea value={writing} onChange={(e) => setWriting(e.target.value)} rows={3} placeholder="What it shows" aria-label={`What ${photo.title} shows`} />
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setWriting(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy === 'save'} disabled={!writing.trim() || busy !== null} onClick={() => describe(writing)}>
              Save
            </Button>
          </div>
        </div>
      ) : photo.shows ? (
        // Accepted or written by a person: this is what the report prints.
        <div className="space-y-1">
          <p className="text-[12px] text-ink">{photo.shows}</p>
          {mayEdit ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="ghost" icon={<Pencil size={13} />} disabled={busy !== null} onClick={() => setWriting(photo.shows ?? '')}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => describe(null)}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ) : photo.seen ? (
        // A model's reading, waiting. Nothing prints until a person accepts or corrects it.
        <div className="space-y-1.5 rounded-lg bg-brand-soft/50 p-2 ring-1 ring-inset ring-brand/20">
          <p className="flex items-start gap-1.5 text-[12px] text-ink">
            <Sparkles size={12} className="mt-0.5 shrink-0 text-brand" aria-hidden />
            <span>
              <span className="font-medium">AI suggests:</span> {photo.seen}
            </span>
          </p>
          {mayEdit ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="primary" icon={<Check size={13} />} loading={busy === 'save'} disabled={busy !== null} onClick={() => describe(photo.seen!)}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil size={13} />} disabled={busy !== null} onClick={() => setWriting(photo.seen ?? '')}>
                Edit
              </Button>
            </div>
          ) : null}
        </div>
      ) : mayEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles size={13} />}
            loading={busy === 'ai'}
            disabled={busy !== null}
            onClick={() =>
              void act('ai', async (ids) => {
                const res = await api.readPhotographs(project.id, ids);
                const failed = res.results?.find((r) => r.error)?.error;
                if (failed) throw new Error(failed);
                return res.read ? 'Suggestion ready.' : (res.note ?? 'Nothing was read.');
              })
            }
          >
            Describe with AI
          </Button>
          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} disabled={busy !== null} onClick={() => setWriting('')}>
            Write
          </Button>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <label className={cn('inline-flex items-center gap-1.5 text-[12px]', on ? 'font-medium text-ink' : 'text-ink-secondary')}>
          <input
            type="checkbox"
            checked={on}
            disabled={!mayEdit || cited || busy !== null}
            onChange={(e) =>
              void act('report', async (ids) => {
                const res = await workspaceApi.setPhotoInReport(project.id, ids.evidenceId, e.target.checked);
                onChanged(res.project);
              })
            }
            className="h-4 w-4 rounded border-[var(--axis)] text-brand focus:ring-brand coarse:h-5 coarse:w-5"
          />
          In report
        </label>
        {cited ? <Badge tone="brand">With observation {photo.usedIn.join(', ')}</Badge> : photo.provesAnAnswer ? <Badge tone="neutral">Proves an answer</Badge> : null}
      </div>
    </li>
  );
}

/**
 * Every photograph on the project as a contact sheet: caption and area to
 * fill in, a model's description to ask for, and one switch each for whether
 * it prints in the report.
 */
export function SitePhotos({ project, refresh, onChanged }: { project: DdProject; refresh: () => Promise<void>; onChanged: (next: DdProject) => void }) {
  const me = useMe();
  const toast = useToast();
  const mayEdit = me ? roleCanEdit(departmentRole(project, { email: me.email, workspaceRole: me.role }, 'construction')) : false;
  const photos = useMemo(() => projectPhotos(project, 'construction'), [project]);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const inReport = photos.filter((p) => p.inReport || p.usedIn.length > 0);
  const undescribed = photos.filter((p) => p.evidenceId && !p.described);
  const choosable = photos.filter((p) => p.evidenceId && p.usedIn.length === 0);
  const waiting = photos.filter((p) => p.seen && !p.shows).length;
  const shown = photos.filter((p) => (filter === 'all' ? true : filter === 'in' ? inReport.includes(p) : !inReport.includes(p)));
  if (!photos.length) return null;

  async function describeAll() {
    setBusy(true);
    try {
      const res = await api.readPhotographs(project.id, { limit: 12 });
      await refresh();
      toast(res.read ? `${res.read} photograph${res.read === 1 ? '' : 's'} described.` : (res.note ?? 'Nothing was read.'), res.read ? 'good' : 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not describe the photographs', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function setAll(on: boolean) {
    setBusy(true);
    try {
      let last: DdProject | undefined;
      for (const p of choosable) {
        if (p.inReport === on) continue;
        last = (await workspaceApi.setPhotoInReport(project.id, p.evidenceId!, on)).project;
      }
      if (last) onChanged(last);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not save', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const chips: Array<{ key: Filter; label: string; n: number }> = [
    { key: 'all', label: 'All', n: photos.length },
    { key: 'in', label: 'In report', n: inReport.length },
    { key: 'out', label: 'Not in report', n: photos.length - inReport.length },
  ];

  return (
    <Card>
      <CardHeader
        icon={<Camera size={15} />}
        title="Photographs"
        subtitle={`${photos.length} · ${inReport.length} in report${waiting ? ` · ${waiting} to review` : ''}`}
        action={
          mayEdit ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {undescribed.length ? (
                <Button size="sm" variant="secondary" icon={<Sparkles size={13} />} loading={busy} onClick={() => void describeAll()}>
                  Describe {undescribed.length > 12 ? 'next 12' : `all ${undescribed.length}`}
                </Button>
              ) : null}
              {choosable.some((p) => !p.inReport) ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setAll(true)}>
                  Add all
                </Button>
              ) : null}
              {choosable.some((p) => p.inReport) ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setAll(false)}>
                  Clear
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                filter === c.key ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
              )}
            >
              {c.label}
              <span className="font-mono tabular-nums">{c.n}</span>
            </button>
          ))}
        </div>
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
          {shown.map((photo) => (
            <PhotoCard key={`${photo.key}:${photo.caption ?? ''}:${photo.area ?? ''}`} project={project} photo={photo} mayEdit={mayEdit} refresh={refresh} onChanged={onChanged} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
