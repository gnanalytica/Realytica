import { useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, HardHat, Plus, Sparkles, Trash2, X } from 'lucide-react';
import {
  TECHNICAL_SYSTEMS,
  TECHNICAL_SYSTEM_LABEL,
  acceptedTechnicalFindings,
  groupFindingsBySystem,
  openTechnicalFindingCounts,
  proposedTechnicalFindings,
  technicalDocumentChecklist,
  totalOpenEstimatedCost,
} from '@realytica/shared';
import type { CaseDocument, CurrencyCode, RiskSeverity, RiskStatus, TechnicalDdPhase, TechnicalFinding, TechnicalFindingDraft, TechnicalSystem } from '@realytica/shared';
import type { TabProps } from '../tab-props';
import { api } from '../../../lib/api';
import { money, severityTone, titleCase } from '../../../lib/format';
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Select, StatTile, Textarea, Toggle, cn, useToast } from '../../../components/ui/kit';

const SEVERITIES: RiskSeverity[] = ['critical', 'serious', 'warning', 'info'];
const STATUSES: RiskStatus[] = ['open', 'mitigated', 'accepted'];

const EMPTY_DRAFT: TechnicalFindingDraft = {
  system: 'structural',
  zone: '',
  observation: '',
  severity: 'warning',
  recommendation: '',
  codeCitation: undefined,
  evidenceDocumentIds: [],
};

function AddFindingForm({
  caseId,
  photos,
  onAdded,
  onCancel,
  onUploaded,
}: {
  caseId: string;
  /** The case's own photograph-kind documents — the only evidence a finding can point at, so a made-up id can never reach the case. */
  photos: CaseDocument[];
  onAdded: (f: TechnicalFinding) => void;
  onCancel: () => void;
  /** Refresh the case after a capture upload, so the new photos join the list. */
  onUploaded?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<TechnicalFindingDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const captureInputRef = useRef<HTMLInputElement>(null);

  /*
   * Capture at the point of truth: a shot taken here is uploaded with the
   * form's own zone and system as its capture mapping, so it enters the
   * evidence graph already connected to where it was taken and what it looks
   * at — never as a loose file to be sorted later. It is also ticked into
   * this finding's evidence immediately.
   */
  const captureShots = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const created = await api.uploadDocuments(caseId, files, {
        zone: draft.zone.trim() || undefined,
        system: draft.system,
      });
      const photoIds = created.filter((d) => d.kind === 'photograph').map((d) => d.id);
      setDraft((d) => ({ ...d, evidenceDocumentIds: [...d.evidenceDocumentIds, ...photoIds] }));
      await onUploaded?.();
      const where = draft.zone.trim() ? ` · ${draft.zone.trim()}` : '';
      toast(`${created.length} photo${created.length === 1 ? '' : 's'} captured against ${TECHNICAL_SYSTEM_LABEL[draft.system]}${where}`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not upload the photos', 'critical');
    } finally {
      setUploading(false);
    }
  };

  const canSave = draft.zone.trim().length > 0 && draft.observation.trim().length > 0 && draft.recommendation.trim().length > 0;

  const togglePhoto = (docId: string) =>
    setDraft((d) => ({
      ...d,
      evidenceDocumentIds: d.evidenceDocumentIds.includes(docId) ? d.evidenceDocumentIds.filter((id) => id !== docId) : [...d.evidenceDocumentIds, docId],
    }));

  const save = async () => {
    setSaving(true);
    try {
      const finding = await api.createTechnicalFinding(caseId, {
        ...draft,
        codeCitation: draft.codeCitation?.trim() || undefined,
      });
      onAdded(finding);
      toast('Finding added', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the finding', 'critical');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Add a finding" subtitle="What you observed on site — the same shape as a technical DD walk-through" />
      <CardBody className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
            System
            <Select value={draft.system} onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value as TechnicalSystem }))}>
              {TECHNICAL_SYSTEMS.map((s) => (
                <option key={s} value={s}>
                  {TECHNICAL_SYSTEM_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
            Zone
            <Input value={draft.zone} onChange={(e) => setDraft((d) => ({ ...d, zone: e.target.value }))} placeholder="e.g. Basement 2, DG room" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Observation
          <Textarea value={draft.observation} onChange={(e) => setDraft((d) => ({ ...d, observation: e.target.value }))} placeholder="What did you actually see?" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
            Severity
            <Select value={draft.severity} onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value as RiskSeverity }))}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
            Code citation (optional)
            <Input
              value={draft.codeCitation ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, codeCitation: e.target.value }))}
              placeholder="e.g. NBC 2005, Part 4, Clause 4.16.7"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Recommendation
          <Textarea value={draft.recommendation} onChange={(e) => setDraft((d) => ({ ...d, recommendation: e.target.value }))} placeholder="What should be done about it?" />
        </label>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-medium text-ink-muted">Evidence photos (optional)</h4>
            <Button
              variant="secondary"
              size="sm"
              icon={<Camera size={13} />}
              loading={uploading}
              onClick={() => captureInputRef.current?.click()}
            >
              Capture photos
            </Button>
            <input
              ref={captureInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void captureShots(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
          <p className="mb-1.5 text-[11px] leading-relaxed text-ink-subtle">
            Photos captured here arrive already mapped to {TECHNICAL_SYSTEM_LABEL[draft.system]}
            {draft.zone.trim() ? ` in ${draft.zone.trim()}` : ''} and attach to this finding.
          </p>
          {photos.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-ink-subtle">
              No photographs are on this case yet — capture some above, or upload from the Documents tab.
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-2 ring-1 ring-[var(--ring)]">
              {photos.map((doc) => {
                const checked = draft.evidenceDocumentIds.includes(doc.id);
                return (
                  <label key={doc.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-3">
                    <input type="checkbox" checked={checked} onChange={() => togglePhoto(doc.id)} className="h-3.5 w-3.5 accent-brand" />
                    <Camera size={13} className="shrink-0 text-ink-faint" />
                    <span className="truncate text-[12.5px] text-ink-secondary">{doc.fileName}</span>
                    {doc.captureZone || doc.captureSystem ? (
                      <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint">
                        {[doc.captureSystem ? TECHNICAL_SYSTEM_LABEL[doc.captureSystem] : null, doc.captureZone].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canSave} loading={saving} onClick={() => void save()}>
            Save finding
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function FindingRow({
  finding,
  photos,
  currency,
  onChanged,
  onDeleted,
}: {
  finding: TechnicalFinding;
  /** The case's photograph documents, to resolve `evidenceDocumentIds` to a file name a reviewer recognises. */
  photos: CaseDocument[];
  /** The case's own currency — cost is entered in it, never a currency the finding invents. */
  currency: CurrencyCode;
  onChanged: (f: TechnicalFinding) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [costDraft, setCostDraft] = useState(finding.estimatedCost !== undefined ? String(finding.estimatedCost) : '');
  const [ownerDraft, setOwnerDraft] = useState(finding.owner ?? '');

  const patch = async (body: Parameters<typeof api.updateTechnicalFinding>[2]) => {
    setBusy(true);
    try {
      onChanged(await api.updateTechnicalFinding(finding.caseId, finding.id, body));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the finding', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const saveCost = () => {
    const trimmed = costDraft.trim();
    const parsed = trimmed === '' ? undefined : Number(trimmed);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
      toast('Cost must be a positive number', 'critical');
      setCostDraft(finding.estimatedCost !== undefined ? String(finding.estimatedCost) : '');
      return;
    }
    if (parsed === finding.estimatedCost) return;
    void patch({ estimatedCost: parsed, estimatedCostCurrency: parsed !== undefined ? currency : undefined });
  };

  const saveOwner = () => {
    const trimmed = ownerDraft.trim();
    if (trimmed === (finding.owner ?? '')) return;
    void patch({ owner: trimmed || undefined });
  };

  const setStatus = (status: RiskStatus) => void patch({ status });
  const toggleDeviation = () => void patch({ deviatesFromApproved: !finding.deviatesFromApproved });

  const review = async (reviewState: 'accepted' | 'rejected') => {
    setBusy(true);
    try {
      onChanged(await api.reviewTechnicalFinding(finding.caseId, finding.id, reviewState));
      toast(reviewState === 'accepted' ? 'Accepted onto the case' : 'Rejected', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not review the finding', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteTechnicalFinding(finding.caseId, finding.id);
      onDeleted(finding.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete the finding', 'critical');
      setBusy(false);
    }
  };

  const proposed = finding.reviewState === 'proposed';

  return (
    <div className={cn('rounded-lg p-3 ring-1', proposed ? 'bg-brand-soft/40 ring-brand/30' : 'bg-surface-2 ring-[var(--ring)]')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={severityTone(finding.severity)}>{titleCase(finding.severity)}</Badge>
          <span className="text-[13px] font-semibold text-ink">{finding.zone}</span>
          {finding.deviatesFromApproved && (
            <Badge tone="warning" icon={<AlertTriangle size={11} />}>
              Deviates from approved plan
            </Badge>
          )}
          {proposed && (
            <Badge tone="brand" icon={<Sparkles size={11} />}>
              Drafted by copilot — awaiting review
            </Badge>
          )}
        </div>
        {!proposed && (
          <div className="flex items-center gap-1.5">
            <Select value={finding.status} disabled={busy} onChange={(e) => void setStatus(e.target.value as RiskStatus)} className="!h-7 !py-0 text-[12px]">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void remove()} />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{finding.observation}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink">
        <span className="font-medium text-ink-secondary">Recommendation: </span>
        {finding.recommendation}
      </p>
      {finding.codeCitation && <p className="mt-1 text-[12px] text-ink-muted">{finding.codeCitation}</p>}
      {finding.evidenceDocumentIds.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
          <Camera size={12} className="shrink-0" />
          {finding.evidenceDocumentIds
            .map((id) => photos.find((p) => p.id === id)?.fileName ?? 'photo no longer on this case')
            .join(', ')}
        </p>
      )}
      {proposed ? (
        <div className="mt-2.5 flex gap-2">
          <Button variant="primary" size="sm" icon={<Check size={13} />} disabled={busy} onClick={() => void review('accepted')}>
            Accept
          </Button>
          <Button variant="ghost" size="sm" icon={<X size={13} />} disabled={busy} onClick={() => void review('rejected')}>
            Reject
          </Button>
        </div>
      ) : (
        // FINANCIAL enrichments — always a person's own entry, never the
        // copilot's: see the field comments on TechnicalFinding for why.
        <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-hairline pt-2.5">
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-ink-muted">
            Est. cost to fix ({currency})
            <Input
              type="number"
              min={0}
              value={costDraft}
              disabled={busy}
              onChange={(e) => setCostDraft(e.target.value)}
              onBlur={saveCost}
              placeholder="Not yet costed"
              className="!h-7 w-32 text-[12.5px]"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-ink-muted">
            Owner
            <Input
              value={ownerDraft}
              disabled={busy}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onBlur={saveOwner}
              placeholder="Who closes this out"
              className="!h-7 w-40 text-[12.5px]"
            />
          </label>
          <Button
            variant={finding.deviatesFromApproved ? 'secondary' : 'ghost'}
            size="sm"
            icon={<AlertTriangle size={13} />}
            disabled={busy}
            onClick={toggleDeviation}
          >
            {finding.deviatesFromApproved ? 'Marked as a deviation' : 'Mark as a deviation from approved plan'}
          </Button>
        </div>
      )}
    </div>
  );
}

function DocumentChecklist({ caseId, phase, provided, onToggled }: { caseId: string; phase: TechnicalDdPhase; provided: Record<string, boolean>; onToggled: (id: string, v: boolean) => void }) {
  const items = technicalDocumentChecklist(phase);
  const bySystem = TECHNICAL_SYSTEMS.map((system) => ({ system, items: items.filter((i) => i.system === system) })).filter((g) => g.items.length > 0);
  const suppliedCount = items.filter((i) => provided[i.id]).length;

  return (
    <Card>
      <CardHeader
        title={phase === 'built' ? 'Phase I — built building' : 'Phase II — proposed building'}
        subtitle={`${suppliedCount} of ${items.length} supplied`}
      />
      <CardBody className="flex flex-col gap-4">
        {bySystem.map((group) => (
          <div key={group.system}>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">{TECHNICAL_SYSTEM_LABEL[group.system]}</h4>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <span className={cn('text-[13px] leading-relaxed', provided[item.id] ? 'text-ink-muted line-through' : 'text-ink-secondary')}>{item.label}</span>
                  <Toggle
                    checked={!!provided[item.id]}
                    onChange={(next) => {
                      onToggled(item.id, next);
                      void api.setTechnicalDocumentProvided(caseId, item.id, next);
                    }}
                    size="sm"
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export default function TechnicalDiligenceTab({ caseData, refresh }: TabProps) {
  const [findings, setFindings] = useState<TechnicalFinding[]>(caseData.technicalFindings ?? []);
  const [provided, setProvided] = useState<Record<string, boolean>>(caseData.technicalDocumentsProvided ?? {});
  const [showAdd, setShowAdd] = useState(false);
  const [phase, setPhase] = useState<TechnicalDdPhase>('built');

  const photos = caseData.documents.filter((d) => d.kind === 'photograph');
  const proposed = proposedTechnicalFindings(findings);
  const accepted = acceptedTechnicalFindings(findings);
  const counts = openTechnicalFindingCounts(findings);
  const openExposure = totalOpenEstimatedCost(findings);
  const grouped = groupFindingsBySystem(accepted);

  const replace = (f: TechnicalFinding) => setFindings((prev) => prev.map((x) => (x.id === f.id ? f : x)));
  const remove = (id: string) => setFindings((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Callout tone="neutral" title="Building condition, not title or value" collapsible>
        This is a different axis from the rest of the case: structural, MEP, fire and statutory condition of the physical building, its
        operational baseline, and what fixing what's wrong actually costs — the questions a technical due-diligence walk-through asks,
        not what the title or the market says. Opt-in, and separate from the deterministic screen.
      </Callout>

      {findings.length === 0 && !showAdd ? (
        <EmptyState
          icon={<HardHat size={28} />}
          title="No technical findings yet"
          description="Add what you observed on site, or ask the copilot about a defect and it can draft one for your review."
          action={
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setShowAdd(true)}>
              Add a finding
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatTile label="Open critical" value={counts.openCritical} tone={counts.openCritical > 0 ? 'critical' : 'neutral'} />
            <StatTile label="Open serious" value={counts.openSerious} tone={counts.openSerious > 0 ? 'warning' : 'neutral'} />
            <StatTile label="Mitigated" value={counts.mitigated} tone="neutral" />
            <StatTile label="Resolved" value={counts.accepted} tone="good" />
            <StatTile
              label="Open exposure"
              value={openExposure !== undefined ? money(openExposure, caseData.identity.currency) : 'Not costed'}
              tone="neutral"
              hint="Sum of what's been priced — findings with no cost entered yet aren't in this number"
            />
          </div>

          {proposed.length > 0 && (
            <Card>
              <CardHeader
                title="Drafted for your review"
                subtitle="The copilot proposed these — nothing here counts toward the case until you accept it"
                icon={<Sparkles size={16} />}
              />
              <CardBody className="flex flex-col gap-2">
                {proposed.map((f) => (
                  <FindingRow key={f.id} finding={f} photos={photos} currency={caseData.identity.currency} onChanged={replace} onDeleted={remove} />
                ))}
              </CardBody>
            </Card>
          )}

          {!showAdd && (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setShowAdd(true)}>
                Add a finding
              </Button>
            </div>
          )}

          {grouped.map((group) => (
            <Card key={group.system}>
              <CardHeader title={TECHNICAL_SYSTEM_LABEL[group.system]} subtitle={`${group.findings.length} finding${group.findings.length === 1 ? '' : 's'}`} />
              <CardBody className="flex flex-col gap-2">
                {group.findings.map((f) => (
                  <FindingRow key={f.id} finding={f} photos={photos} currency={caseData.identity.currency} onChanged={replace} onDeleted={remove} />
                ))}
              </CardBody>
            </Card>
          ))}
        </>
      )}

      {showAdd && (
        <AddFindingForm
          caseId={caseData.id}
          photos={photos}
          onUploaded={refresh}
          onCancel={() => setShowAdd(false)}
          onAdded={(f) => {
            setFindings((prev) => [...prev, f]);
            setShowAdd(false);
          }}
        />
      )}

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPhase('built')}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium ring-1', phase === 'built' ? 'bg-brand-soft ring-brand text-brand' : 'bg-surface-2 ring-[var(--ring)] text-ink-secondary')}
          >
            Phase I — built
          </button>
          <button
            type="button"
            onClick={() => setPhase('proposed')}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium ring-1', phase === 'proposed' ? 'bg-brand-soft ring-brand text-brand' : 'bg-surface-2 ring-[var(--ring)] text-ink-secondary')}
          >
            Phase II — proposed
          </button>
        </div>
        <DocumentChecklist caseId={caseData.id} phase={phase} provided={provided} onToggled={(id, v) => setProvided((p) => ({ ...p, [id]: v }))} />
      </div>
    </div>
  );
}
