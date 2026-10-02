import { useMemo, useState } from 'react';
import { BadgeCheck, RotateCcw } from 'lucide-react';
import {
  QUICK_VERDICT_LABEL,
  certifiedReadout,
  departmentRole,
  roleCanDecide,
  workstreamDefinition,
  workstreamDocuments,
  type CertifiedReport,
  type DdProject,
} from '@realytica/shared';
import { workspaceApi, type FileCertifiedBody } from '../../lib/workspace-api';
import { useMe } from '../../lib/useMe';
import { money } from '../../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, Textarea, useToast } from '../ui/kit';
import { VERDICT_TONE } from './QuickAssessmentCard';

function day(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function figureText(project: DdProject, figure?: { value: number; unit: 'INR' | '%' }): string | null {
  if (!figure) return null;
  return figure.unit === '%' ? `${figure.value}% complete` : money(figure.value, project.currency ?? 'INR');
}

/**
 * The certified reports for a workstream: the current one is the figure of
 * record, with who signed it, their registration, the date and scope. When the
 * quick assessment has moved far enough since, it is flagged for revisiting,
 * and its lead or signer says they have seen it.
 */
export function CertifiedPanel({ project, workstream, onChanged }: { project: DdProject; workstream: string; onChanged: (p: DdProject) => void }) {
  const me = useMe();
  const toast = useToast();
  const [filing, setFiling] = useState(false);
  const [busy, setBusy] = useState(false);
  const ws = workstreamDefinition(workstream)!;
  const reports = (project.certifiedReports ?? []).filter((r) => r.workstream === workstream);
  const current = reports.find((r) => r.status === 'current');
  const earlier = reports.filter((r) => r.status === 'superseded').reverse();
  const role = me ? departmentRole(project, { email: me.email, workspaceRole: me.role }, ws.department) : undefined;
  const mayDecide = roleCanDecide(role);

  async function acknowledge(report: CertifiedReport) {
    setBusy(true);
    try {
      const res = await workspaceApi.acknowledgeRevisit(project.id, report.id);
      onChanged(res.project);
      toast('Noted. The flag stays in the history.', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not acknowledge it', 'critical');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<BadgeCheck size={15} />}
        title="Certified report"
        subtitle={current ? 'The figure of record' : `Signed by ${ws.signers.length ? ws.signers.join(' or ') : 'a named professional'}`}
        info="A report a named professional signs. It is the figure of record; the quick assessment keeps running beside it and flags it for revisiting when later evidence moves the estimate more than 10%, progress by more than 5 points, or a new blocker or condition appears."
        action={
          mayDecide ? (
            <Button size="sm" onClick={() => setFiling(true)}>
              {current ? 'File a newer one' : 'File a certified report'}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {current ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-[15px] font-semibold text-ink">{current.title}</p>
              {current.verdict ? <Badge tone={VERDICT_TONE[current.verdict]}>{QUICK_VERDICT_LABEL[current.verdict]}</Badge> : null}
              {figureText(project, current.figure) ? <span className="text-[15px] font-semibold tabular-nums text-ink">{figureText(project, current.figure)}</span> : null}
            </div>
            <p className="text-[13px] text-ink-secondary">
              {current.signer.name}, {current.signer.profession}
              {current.signer.registration ? ` · ${current.signer.registration}` : ''}
              {current.signer.firm ? ` · ${current.signer.firm}` : ''}
              {current.issuedOn ? ` · ${day(current.issuedOn)}` : ''}
            </p>
            {current.scope ? <p className="text-[13px] text-ink-secondary">Covers: {current.scope}</p> : null}
            {current.conditions.length ? (
              <ul className="list-disc pl-4 text-[13px] text-ink">
                {current.conditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : null}
            {current.revisit && !current.revisit.acknowledgedAt ? (
              <div className="flex flex-wrap items-start gap-3 rounded-lg bg-warning/15 px-3 py-2 ring-1 ring-inset ring-warning/40">
                <RotateCcw size={15} className="mt-0.5 shrink-0 text-ink" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">May need revisiting</p>
                  <p className="text-[13px] text-ink-secondary">{current.revisit.reasons.join(' ')}</p>
                  <p className="mt-0.5 text-micro text-ink-muted">Flagged {day(current.revisit.flaggedAt)} for the department lead and {current.signer.name}.</p>
                </div>
                {mayDecide ? (
                  <Button size="sm" loading={busy} onClick={() => void acknowledge(current)}>
                    Seen it
                  </Button>
                ) : null}
              </div>
            ) : current.revisit?.acknowledgedAt ? (
              <p className="text-micro text-ink-muted">A revisit flag was acknowledged by {current.revisit.acknowledgedBy} on {day(current.revisit.acknowledgedAt)}.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-ink-secondary">
            None on file. Upload the signed report to the documents, then file it here: its figures, signer and date are read off it for you to confirm.
          </p>
        )}
        {earlier.length ? (
          <details className="text-[12px] text-ink-secondary">
            <summary className="cursor-pointer select-none">Earlier reports · {earlier.length}</summary>
            <ul className="mt-1 space-y-0.5">
              {earlier.map((r) => (
                <li key={r.id}>
                  {r.title} — {r.signer.name}
                  {r.issuedOn ? `, ${day(r.issuedOn)}` : ''}
                  {figureText(project, r.figure) ? ` · ${figureText(project, r.figure)}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
      {filing ? <FileCertifiedModal project={project} workstream={workstream} onClose={() => setFiling(false)} onFiled={onChanged} /> : null}
    </Card>
  );
}

/**
 * Filing a certified report: pick the signed document from the vault, read
 * what it says, confirm every value against the page, file.
 */
function FileCertifiedModal({ project, workstream, onClose, onFiled }: { project: DdProject; workstream: string; onClose: () => void; onFiled: (p: DdProject) => void }) {
  const toast = useToast();
  const ws = workstreamDefinition(workstream)!;
  const owned = useMemo(() => workstreamDocuments(project, workstream), [project, workstream]);
  const others = project.evidence.filter((e) => e.attachments.length && !owned.includes(e));
  const [evidenceId, setEvidenceId] = useState(owned.find((e) => e.attachments.length)?.id ?? '');
  const [form, setForm] = useState<FileCertifiedBody>(() => blank(evidenceId));
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Array<{ field: string; page?: number; quote?: string }>>([]);

  function blank(id: string): FileCertifiedBody {
    const row = project.evidence.find((e) => e.id === id);
    return { workstream, title: row?.title ?? '', evidenceId: id, signer: { name: '', profession: ws.signers[0] ?? '' }, conditions: [] };
  }

  function read(id: string) {
    setEvidenceId(id);
    if (!id) return;
    try {
      // The read-out is a pure function of what the vault already read; the
      // browser holds the same file the server does.
      const r = certifiedReadout(project, id);
      setSources(r.sources);
      setForm({
        workstream,
        title: r.title,
        evidenceId: id,
        signer: { name: r.signer.name ?? '', profession: r.signer.profession ?? ws.signers[0] ?? '', ...(r.signer.registration ? { registration: r.signer.registration } : {}) },
        ...(r.issuedOn ? { issuedOn: r.issuedOn } : {}),
        ...(r.scope ? { scope: r.scope } : {}),
        ...(r.figure ? { figure: r.figure } : {}),
        ...(r.verdict ? { verdict: r.verdict } : {}),
        conditions: r.conditions,
      });
    } catch {
      setForm(blank(id));
    }
  }

  async function file() {
    setBusy(true);
    try {
      const res = await workspaceApi.fileCertified(project.id, { ...form, conditions: (form.conditions ?? []).filter(Boolean) });
      onFiled(res.project);
      toast(`${res.report.title} is the figure of record for ${ws.label}.`, 'good');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not file it', 'critical');
    } finally {
      setBusy(false);
    }
  }

  const said = (field: string) => sources.find((s) => s.field === field);
  const hint = (field: string) => {
    const s = said(field);
    return s ? `Read on page ${s.page ?? '?'}: “${(s.quote ?? '').slice(0, 120)}”` : undefined;
  };
  const figureOn = Boolean(form.figure);

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={`File a certified report · ${ws.label}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!evidenceId || !form.signer.name || !form.signer.profession || (!form.figure && !form.verdict)} onClick={() => void file()}>
            File as the figure of record
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="The signed report" hint="Upload it in Documents first. Reports this workstream owns are listed first.">
          <Select value={evidenceId} onChange={(e) => read(e.target.value)}>
            <option value="">Choose a document…</option>
            {owned.filter((e) => e.attachments.length).map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.documentType ? ` — ${e.documentType}` : ''}
              </option>
            ))}
            {others.length ? <option disabled>──────────</option> : null}
            {others.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.documentType ? ` — ${e.documentType}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Dated" hint={hint('issuedOn')}>
            <Input type="date" value={form.issuedOn ?? ''} onChange={(e) => setForm({ ...form, issuedOn: e.target.value || undefined })} />
          </Field>
          <Field label="Signed by" hint={hint('signer.name')}>
            <Input value={form.signer.name} onChange={(e) => setForm({ ...form, signer: { ...form.signer, name: e.target.value } })} />
          </Field>
          <Field label="Profession">
            <Input value={form.signer.profession} onChange={(e) => setForm({ ...form, signer: { ...form.signer, profession: e.target.value } })} />
          </Field>
          <Field label="Registration" hint={hint('signer.registration') ?? 'Enrolment, IBBI or council number, as the report states it'}>
            <Input value={form.signer.registration ?? ''} onChange={(e) => setForm({ ...form, signer: { ...form.signer, registration: e.target.value || undefined } })} />
          </Field>
          <Field label="Firm">
            <Input value={form.signer.firm ?? ''} onChange={(e) => setForm({ ...form, signer: { ...form.signer, firm: e.target.value || undefined } })} />
          </Field>
        </div>
        <Field label="What it covers" hint={hint('scope')}>
          <Textarea rows={2} value={form.scope ?? ''} onChange={(e) => setForm({ ...form, scope: e.target.value || undefined })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Conclusion" hint={hint('verdict')}>
            <Select value={form.verdict ?? ''} onChange={(e) => setForm({ ...form, verdict: (e.target.value || undefined) as FileCertifiedBody['verdict'] })}>
              <option value="">No conclusion stated</option>
              <option value="clear">Clear</option>
              <option value="conditions">Clear with conditions</option>
              <option value="blockers">Blockers</option>
            </Select>
          </Field>
          <Field label="Certified figure" hint={hint('figure') ?? 'A value in rupees, or progress as a percentage'}>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={figureOn ? String(form.figure!.value) : ''}
                onChange={(e) => setForm({ ...form, figure: e.target.value ? { value: Number(e.target.value), unit: form.figure?.unit ?? (workstream === 'construction.progress' ? '%' : 'INR') } : undefined })}
              />
              <Select value={form.figure?.unit ?? (workstream === 'construction.progress' ? '%' : 'INR')} onChange={(e) => form.figure && setForm({ ...form, figure: { ...form.figure, unit: e.target.value as 'INR' | '%' } })}>
                <option value="INR">₹</option>
                <option value="%">%</option>
              </Select>
            </div>
          </Field>
        </div>
        <Field label="Conditions" hint="One per line, as the report puts them">
          <Textarea rows={3} value={(form.conditions ?? []).join('\n')} onChange={(e) => setForm({ ...form, conditions: e.target.value.split('\n') })} />
        </Field>
      </div>
    </Modal>
  );
}
