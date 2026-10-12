import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, FileInput, FileText, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  TEMPLATE_PATTERN_LABEL,
  TEMPLATE_STATUS_LABEL,
  departmentRole,
  roleCanDecide,
  roleCanEdit,
  templateSourceSaid,
  type DdProject,
  type DepartmentKey,
  type TemplateDecision,
  type TemplateFieldStatus,
  type TemplateRow,
  type TemplateSource,
  type TemplateView,
} from '@realytica/shared';
import { templateApi, type TemplateFileKind, type TemplateListed } from '../../lib/template-api';
import { useMe } from '../../lib/useMe';
import { AiMark, Badge, Button, Card, CardBody, CardHeader, Input, Select, Skeleton, cn, useToast, type Tone } from '../ui/kit';

type Filter = 'all' | 'open' | 'written';

const STATUS_TONE: Record<TemplateFieldStatus, Tone> = { accepted: 'good', typed: 'good', blank: 'neutral', offered: 'brand', no_source: 'warning' };

/** What a value was taken from, as a chip that opens the paper, and how that source stands. */
function Source({ source, onOpenDocument }: { source: TemplateSource; onOpenDocument: (evidenceId: string) => void }) {
  const said = templateSourceSaid(source);
  const chip = 'inline-flex max-w-full items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-micro text-ink-secondary ring-1 ring-inset ring-[var(--ring)]';
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      {source.evidenceId ? (
        <button type="button" onClick={() => onOpenDocument(source.evidenceId!)} title={source.quote ?? said} className={cn(chip, 'hover:text-ink')}>
          <FileText size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{said}</span>
        </button>
      ) : (
        <span className={chip}>
          <span className="truncate">{said}</span>
        </span>
      )}
      {source.standing.state === 'approved' ? <Badge tone="good">Approved by {source.standing.by}</Badge> : <Badge tone="warning" title="No named person has approved this on the record">Source waiting</Badge>}
    </span>
  );
}

function FieldRow({
  row,
  mayEdit,
  busy,
  onDecide,
  onOpenDocument,
}: {
  row: TemplateRow;
  mayEdit: boolean;
  busy: boolean;
  onDecide: (decision: TemplateDecision) => void;
  onOpenDocument: (evidenceId: string) => void;
}) {
  const { field, status, offers } = row;
  const offer = offers[0];
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const written = status === 'accepted' || status === 'typed';
  const source = written ? field.source : offer?.source;

  function type() {
    setDraft(field.value ?? offer?.value ?? '');
    setTyping(true);
  }
  function save() {
    if (!draft.trim()) return;
    onDecide({ fieldId: field.id, decision: 'type', value: draft.trim() });
    setTyping(false);
  }

  return (
    <li className="px-3 py-2.5">
      {/* Three columns where the card has the room, so the values line up down the list; stacked where it has not. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 [@container(min-width:52rem)]:grid [@container(min-width:52rem)]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_21rem]">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13px] font-medium text-ink">{field.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-ink-muted" title={[TEMPLATE_PATTERN_LABEL[field.pattern], field.context].filter(Boolean).join(': ')}>
            <span className="font-mono">{field.where}</span>
            {field.asks ? (
              <span className="inline-flex items-center gap-1 text-ai" title="A model read what this blank asks for. The value is the record’s own.">
                <AiMark size="xs" />
                read as {field.asks.key.replace(/_/g, ' ')}
              </span>
            ) : null}
          </p>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          {typing ? (
            <div className="flex items-center gap-1.5">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' ? setTyping(false) : undefined)} aria-label={`Value for ${field.label}`} maxLength={2000} autoFocus />
              <Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTyping(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <p className={cn('break-words text-[13px]', written ? 'font-medium text-ink' : offer ? 'text-brand' : 'text-ink-muted')}>{written ? field.value : status === 'blank' ? '—' : (offer?.value ?? 'Nothing on the record')}</p>
              {source ? <Source source={source} onOpenDocument={onOpenDocument} /> : null}
              {!written && offers.length > 1 ? <p className="mt-1 text-micro text-ink-muted">{offers.length - 1} other on the record</p> : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 [@container(min-width:52rem)]:justify-end">
          <Badge tone={STATUS_TONE[status]}>{TEMPLATE_STATUS_LABEL[status]}</Badge>
          {mayEdit && !typing ? (
            field.decision ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={busy} onClick={() => onDecide({ fieldId: field.id, decision: 'reopen' })}>
                Undo
              </Button>
            ) : (
              <>
                {offer ? (
                  <Button size="sm" variant="secondary" icon={<Check size={13} />} disabled={busy} onClick={() => onDecide({ fieldId: field.id, decision: 'accept', value: offer.value })}>
                    Accept
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} disabled={busy} onClick={type}>
                  {offer ? 'Edit' : 'Type'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide({ fieldId: field.id, decision: 'blank' })}>
                  Leave blank
                </Button>
              </>
            )
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * An empty form, filled from the record.
 *
 * A Word file or a workbook is uploaded and its blanks listed. Each is shown
 * with what the record offers for it and where that came from, and a person
 * accepts it, types something else or leaves it blank. The same file goes
 * back with only what was accepted or typed, beside a list of its sources.
 */
export function TemplateCard({ project, department = 'construction', onOpenDocument }: { project: DdProject; department?: DepartmentKey; onOpenDocument: (evidenceId: string) => void }) {
  const me = useMe();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, department) : undefined;
  const mayEdit = roleCanEdit(role);
  const mayDecide = roleCanDecide(role);
  const [listed, setListed] = useState<TemplateListed[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateView | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);

  const projectId = project.id;
  useEffect(() => {
    let live = true;
    setListed(null);
    setTemplate(null);
    setPickedId(null);
    templateApi
      .list(projectId, department)
      .then((res) => live && setListed(res.templates))
      // Somebody with no place here is shown no card at all.
      .catch(() => live && setListed([]));
    return () => {
      live = false;
    };
  }, [projectId, department]);

  const shownId = pickedId ?? listed?.[listed.length - 1]?.id ?? null;
  // The papers move on under an open template: what is offered is read again whenever the project does.
  const stamp = project.updatedAt;
  useEffect(() => {
    if (!shownId) {
      setTemplate(null);
      return;
    }
    let live = true;
    templateApi
      .get(projectId, shownId)
      .then((res) => live && setTemplate(res.template))
      // One that can no longer be read is off the list, so the card does not wait on it.
      .catch(() => live && (setTemplate(null), setPickedId(null), setListed((was) => (was ?? []).filter((t) => t.id !== shownId))));
    return () => {
      live = false;
    };
  }, [projectId, shownId, stamp]);

  const kept = useCallback((next: TemplateView) => {
    setTemplate(next);
    const { rows: _rows, ...row } = next;
    setListed((was) => (was ?? []).map((t) => (t.id === next.id ? row : t)));
  }, []);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await templateApi.upload(projectId, file, department);
      const { rows: _rows, ...row } = res.template;
      setListed((was) => [...(was ?? []), row]);
      setTemplate(res.template);
      setPickedId(res.template.id);
      const s = res.template.summary;
      toast(`${s.total} blank${s.total === 1 ? '' : 's'} · ${s.offered} offered`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that file', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function decide(decisions: TemplateDecision[]) {
    if (!template || !decisions.length) return;
    setBusy(true);
    try {
      kept((await templateApi.decide(projectId, template.id, decisions)).template);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not keep that', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function save(kind: TemplateFileKind) {
    if (!template) return;
    setBusy(true);
    try {
      const stem = template.fileName.replace(/\.[a-z0-9]+$/i, '');
      await templateApi.save(projectId, template.id, kind, kind === 'original' ? template.fileName : kind === 'sources' ? `${stem} - sources.pdf` : `${stem} - filled.${template.format}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not take the file out', 'critical');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template) return;
    setBusy(true);
    try {
      await templateApi.remove(projectId, template.id);
      setListed((was) => (was ?? []).filter((t) => t.id !== template.id));
      setTemplate(null);
      setPickedId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the template', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".docx,.xlsx"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void upload(file);
      }}
    />
  );
  const icon = <FileInput size={15} />;

  if (listed === null || (shownId && !template)) {
    return (
      <Card>
        <CardHeader icon={icon} title="Templates" subtitle="An empty form, filled from the record" />
        <CardBody>
          <Skeleton className="h-9 w-full" />
        </CardBody>
      </Card>
    );
  }

  if (!template) {
    return (
      <Card>
        <CardHeader icon={icon} title="Templates" subtitle="An empty form, filled from the record" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">No template yet.</p>
            {mayEdit ? (
              <Button size="sm" variant="primary" icon={<Upload size={13} />} loading={busy} onClick={() => input.current?.click()}>
                Upload a form
              </Button>
            ) : null}
          </div>
        </CardBody>
        {picker}
      </Card>
    );
  }

  const s = template.summary;
  const offered = template.rows.filter((row) => row.status === 'offered');
  const shown = template.rows.filter((row) => filter === 'all' || (filter === 'written' ? row.status === 'accepted' || row.status === 'typed' : row.status === 'offered' || row.status === 'no_source'));
  const filters: Array<{ key: Filter; label: string; n: number }> = [
    { key: 'all', label: 'All', n: s.total },
    { key: 'open', label: 'To decide', n: s.offered + s.noSource },
    { key: 'written', label: 'Written', n: s.written },
  ];

  return (
    <Card>
      <CardHeader
        icon={icon}
        title={template.title}
        subtitle={`${s.written}/${s.total} written · ${s.offered} offered · ${s.noSource} no source${s.blank ? ` · ${s.blank} left blank` : ''}`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {listed.length > 1 ? (
              <Select aria-label="Template" value={template.id} onChange={(e) => setPickedId(e.target.value)} className="w-auto">
                {listed.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button size="sm" variant="secondary" icon={<Download size={13} />} disabled={busy} title={`The same ${template.format === 'docx' ? 'Word file' : 'workbook'}, with what was accepted or typed`} onClick={() => void save('filled')}>
              Filled file
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} title="Each value written, and where it came from" onClick={() => void save('sources')}>
              Sources
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={busy} title="The file as it was sent" onClick={() => void save('original')}>
              As sent
            </Button>
            {mayEdit ? (
              <Button size="sm" variant="ghost" icon={<Upload size={13} />} loading={busy} onClick={() => input.current?.click()}>
                Upload
              </Button>
            ) : null}
          </div>
        }
      />
      <CardBody className="space-y-3">
        {template.leftOut ? <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-ink">{template.leftOut}</p> : null}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Show">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick ease-state coarse:min-h-11',
                filter === f.key ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
              )}
            >
              {f.label}
              <span className="font-mono tabular-nums">{f.n}</span>
            </button>
          ))}
          {offered.length && mayEdit ? (
            <Button size="sm" variant="secondary" icon={<Check size={13} />} loading={busy} onClick={() => void decide(offered.map((row) => ({ fieldId: row.field.id, decision: 'accept', value: row.offers[0]!.value })))}>
              Accept all {offered.length}
            </Button>
          ) : null}
        </div>

        {shown.length ? (
          <ul className="divide-y divide-hairline rounded-xl ring-1 ring-inset ring-[var(--ring)]">
            {shown.map((row) => (
              <FieldRow key={`${row.field.id}:${row.field.decidedAt ?? ''}`} row={row} mayEdit={mayEdit} busy={busy} onDecide={(decision) => void decide([decision])} onOpenDocument={onOpenDocument} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-secondary">Nothing here.</p>
        )}

        {mayDecide ? (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        ) : null}
      </CardBody>
      {picker}
    </Card>
  );
}
