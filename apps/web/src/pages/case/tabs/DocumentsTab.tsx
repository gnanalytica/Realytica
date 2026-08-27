import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileBarChart2,
  FileCheck2,
  FileImage,
  FileQuestion,
  FileSignature,
  FileText,
  Inbox,
  Landmark,
  ReceiptText,
  Loader2,
  Ruler,
  ScrollText,
  Trash2,
  UploadCloud,
  Zap,
} from 'lucide-react';
import type { CaseDocument, DocumentKind, ExtractedField } from '@realytica/shared';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Modal,
  ProgressBar,
  Select,
  Skeleton,
  useToast,
  cn,
} from '../../../components/ui/kit';
import { api, uploadLimits } from '../../../lib/api';
import type { UploadLimits } from '../../../lib/api';
import { useAsync } from '../../../lib/useAsync';
import { DOCUMENT_KIND_LABEL, fileSize, relativeTime, titleCase } from '../../../lib/format';
import type { TabProps } from '../tab-props';
import { RecordFetchCard } from '../../../components/RecordFetchCard';
import { SplitProse } from '../../../components/ui/prose';
import { DocumentPreview } from '../../../components/DocumentPreview';

const KIND_ICON: Record<DocumentKind, typeof FileText> = {
  title_deed: ScrollText,
  sale_agreement: FileSignature,
  encumbrance_certificate: FileCheck2,
  property_tax_receipt: FileText,
  approved_building_plan: Ruler,
  occupancy_certificate: FileCheck2,
  khata_extract: ScrollText,
  rera_registration: FileCheck2,
  valuation_report: FileBarChart2,
  lease_agreement: FileSignature,
  kadaster_extract: ScrollText,
  energy_label: Zap,
  woz_assessment: FileBarChart2,
  floor_plan: Ruler,
  photograph: FileImage,
  other: FileText,
  unclassified: FileQuestion,
  // Karnataka / Bengaluru pack
  mother_deed: ScrollText,
  conversion_certificate: FileCheck2,
  commencement_certificate: FileCheck2,
  betterment_charges_receipt: ReceiptText,
  possession_certificate: FileSignature,
  form_9_11: Landmark,
  sanctioned_plan_bbmp: Ruler,
  joint_development_agreement: FileSignature,
};

const REVIEW_THRESHOLD = 0.7;

interface PendingUpload {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'error';
  message?: string;
}

/**
 * Split an upload into requests the deployment will accept — no more than
 * `maxFiles` per request, and no more than `maxRequestBytes` of content.
 *
 * Every item is assumed to fit on its own; callers reject oversized files
 * before getting here, since no grouping can rescue one. Order is preserved,
 * so a partial failure leaves the earlier files uploaded and the rest not,
 * which is the behaviour the pending rows describe.
 */
function batchToFit<T extends { file: File }>(items: T[], limits: UploadLimits): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const wouldOverflow = currentBytes + item.file.size > limits.maxRequestBytes || current.length >= limits.maxFiles;
    if (current.length > 0 && wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

interface RequiredRow {
  key: string;
  label: string;
  icon: DocumentKind;
  weight: number;
  required: boolean;
  present: boolean;
  note?: string;
}

export default function DocumentsTab({ caseData, result, refresh }: TabProps) {
  const toast = useToast();
  const { data: reference } = useAsync(() => api.reference(), []);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [docPendingDelete, setDocPendingDelete] = useState<CaseDocument | null>(null);
  const [docPreview, setDocPreview] = useState<{ doc: CaseDocument; page?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const seq = useRef(0);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFiles = async (files: File[]) => {
    const nonEmpty = files.filter((f) => f.size > 0);
    const emptyCount = files.length - nonEmpty.length;
    if (emptyCount > 0) {
      toast(`Skipped ${emptyCount} empty file${emptyCount === 1 ? '' : 's'}.`, 'warning');
    }
    if (nonEmpty.length === 0) return;

    const limits = await uploadLimits();

    // Reject what this deployment cannot take, by name and size. The
    // alternative is sending it and surfacing whatever the platform says,
    // which on a serverless host is an opaque payload-too-large page with no
    // indication of which file caused it or what the limit is.
    const tooLarge = nonEmpty.filter((f) => f.size > limits.maxFileBytes);
    const valid = nonEmpty.filter((f) => f.size <= limits.maxFileBytes);
    if (tooLarge.length > 0) {
      const names = tooLarge.map((f) => `${f.name} (${fileSize(f.size)})`).join(', ');
      toast(`Too large for this deployment — the limit is ${fileSize(limits.maxFileBytes)} per file: ${names}`, 'critical');
    }
    if (valid.length === 0) return;

    const queued = valid.map((file) => ({
      file,
      row: { id: `${Date.now()}-${seq.current++}`, name: file.name, size: file.size, status: 'uploading' } as PendingUpload,
    }));
    const rows = queued.map((q) => q.row);
    setPending((prev) => [...prev, ...rows]);

    // Files that each fit can still exceed the cap together, so send them in
    // groups that fit rather than as one request. Sequentially: these are
    // multi-megabyte uploads, and firing them in parallel competes for the
    // same connection for no gain.
    const created: CaseDocument[] = [];
    try {
      for (const batch of batchToFit(queued, limits)) {
        created.push(...(await api.uploadDocuments(caseData.id, batch.map((q) => q.file))));
        const done = new Set(batch.map((q) => q.row.id));
        setPending((prev) => prev.filter((p) => !done.has(p.id)));
      }
      await refresh();
      const needsReview = created.filter((d) => d.classificationConfidence < REVIEW_THRESHOLD).length;
      const total = created.length;
      toast(
        needsReview > 0
          ? `${total} document${total === 1 ? '' : 's'} classified — ${needsReview} need${needsReview === 1 ? 's' : ''} review.`
          : `${total} document${total === 1 ? '' : 's'} classified.`,
        needsReview > 0 ? 'warning' : 'good',
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed.';
      // Only the rows still pending failed — earlier batches already landed
      // and were cleared, and their documents are on the case.
      setPending((prev) => prev.map((p) => (rows.some((r) => r.id === p.id) ? { ...p, status: 'error', message } : p)));
      toast(message, 'critical');
      if (created.length > 0) await refresh();
    }
  };

  const dismissPending = (id: string) => setPending((prev) => prev.filter((p) => p.id !== id));

  const handleKindChange = async (doc: CaseDocument, kind: DocumentKind) => {
    if (kind === doc.kind) return;
    try {
      await api.updateDocument(caseData.id, doc.id, { kind });
      await refresh();
      toast(`Reclassified as "${DOCUMENT_KIND_LABEL[kind]}" — extracted fields refreshed.`, 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update the document.', 'critical');
    }
  };

  const confirmDelete = async () => {
    if (!docPendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteDocument(caseData.id, docPendingDelete.id);
      await refresh();
      toast(`Deleted "${docPendingDelete.fileName}".`, 'neutral');
      setDocPendingDelete(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete the document.', 'critical');
    } finally {
      setDeleting(false);
    }
  };

  const pack = useMemo(
    () => reference?.countryPacks.find((p) => p.country === caseData.identity.country) ?? null,
    [reference, caseData.identity.country],
  );

  const requiredRows: RequiredRow[] = useMemo(() => {
    if (result) {
      return [...result.completeness.items]
        .map((item) => ({
          key: item.key,
          label: item.label,
          icon: item.satisfiedBy[0] ?? 'other',
          weight: item.weight,
          required: item.required,
          present: item.present,
          note: item.note,
        }))
        .sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight);
    }
    if (!pack) return [];
    return [...pack.requiredDocuments]
      .map((rd) => ({
        key: rd.kind,
        label: rd.label,
        icon: rd.kind,
        weight: rd.weight,
        required: rd.required,
        present: caseData.documents.some((d) => d.kind === rd.kind),
      }))
      .sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight);
  }, [result, pack, caseData.documents]);

  const priorityDocs = useMemo(() => {
    if (!pack) return [];
    return [...pack.requiredDocuments]
      .filter((d) => d.required)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((d) => d.label);
  }, [pack]);

  return (
    <div className="flex flex-col gap-5">
      {/*
        * Fetching sits above uploading, not below it.
        *
        * A record you can pull is a record you do not have to go and get, and
        * where no vendor is connected this panel is still the fastest route:
        * it names what each record settles and exactly how to obtain it,
        * which is more useful than a dropzone that assumes you already have
        * the file.
        */}
      <RecordFetchCard caseData={caseData} onChanged={refresh} />

      <Card>
        <CardBody className="flex flex-col gap-3">
          <Dropzone onFiles={(files) => void handleFiles(files)} />
          {pending.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-xs">
                  {p.status === 'uploading' ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-ink-muted" />
                  ) : (
                    <AlertTriangle size={13} className="shrink-0 text-critical" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                  <span className="shrink-0 text-ink-muted">{fileSize(p.size)}</span>
                  {p.message ? <span className="shrink-0 text-critical">{p.message}</span> : null}
                  {p.status === 'error' ? (
                    <button
                      onClick={() => dismissPending(p.id)}
                      aria-label={`Dismiss ${p.name}`}
                      className="shrink-0 text-ink-muted hover:text-ink"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr,320px]">
        <Card>
          <CardHeader title="Documents" subtitle={`${caseData.documents.length} uploaded`} />
          {caseData.documents.length === 0 ? (
            <EmptyState
              icon={<Inbox size={26} />}
              title="No documents yet"
              description={
                priorityDocs.length > 0
                  ? `Start with what matters most for ${pack?.countryName ?? 'this country'}: ${priorityDocs.join(', ')}.`
                  : 'Upload the documents you already hold for this property — they are classified and extracted from automatically.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="w-8 px-3 py-2" />
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Pages</th>
                    <th className="px-3 py-2">Uploaded</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {caseData.documents.map((doc) => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      expanded={expandedIds.has(doc.id)}
                      onToggle={() => toggleExpand(doc.id)}
                      onKindChange={(kind) => void handleKindChange(doc, kind)}
                      onDelete={() => setDocPendingDelete(doc)}
                      onPreview={() => setDocPreview({ doc })}
                      onPreviewPage={(page) => setDocPreview({ doc, page })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Required documents"
            subtitle={result ? 'From this screen’s completeness check' : pack ? `${pack.countryName} country pack` : undefined}
          />
          <CardBody>
            {!reference && !result ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : requiredRows.length === 0 ? (
              <p className="text-xs text-ink-muted">No reference data available for this country yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {requiredRows.map((row) => {
                  const StatusIcon = row.present ? CheckCircle2 : Circle;
                  return (
                    <li key={row.key} className="flex items-start gap-2">
                      <StatusIcon
                        size={14}
                        className={cn(
                          'mt-0.5 shrink-0',
                          row.present ? 'text-[var(--status-good-text)]' : row.required ? 'text-critical' : 'text-ink-muted',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('text-[13px]', row.present ? 'text-ink' : 'text-ink-secondary')}>{row.label}</span>
                          {row.required && !row.present ? <Badge tone="critical">Missing</Badge> : null}
                          {!row.required ? <Badge tone="neutral">Optional</Badge> : null}
                        </div>
                        {row.note ? <SplitProse text={row.note} className="mt-0.5" /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {docPreview ? (
        <DocumentPreview
          caseId={caseData.id}
          doc={docPreview.doc}
          page={docPreview.page}
          onClose={() => setDocPreview(null)}
        />
      ) : null}

      <Modal
        open={docPendingDelete !== null}
        onClose={() => setDocPendingDelete(null)}
        title="Delete document"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          Delete <span className="font-medium">{docPendingDelete?.fileName}</span>? Its extracted fields will no longer back the last
          screen result until you re-run the screen.
        </p>
      </Modal>
    </div>
  );
}

function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload documents — drag and drop or click to browse"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
        dragging ? 'border-brand bg-brand-soft' : 'border-hairline bg-sunken hover:border-[var(--axis)]',
      )}
    >
      <UploadCloud size={22} className="text-ink-muted" />
      <p className="text-[13px] font-medium text-ink">Drag and drop documents here, or click to browse</p>
      <p className="text-xs text-ink-muted">Title deeds, agreements, plans, certificates, photographs — PDF, JPG or PNG</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function DocRow({
  doc,
  expanded,
  onToggle,
  onKindChange,
  onDelete,
  onPreview,
  onPreviewPage,
}: {
  doc: CaseDocument;
  expanded: boolean;
  onToggle: () => void;
  onKindChange: (kind: DocumentKind) => void;
  onDelete: () => void;
  onPreview: () => void;
  onPreviewPage: (page?: number) => void;
}) {
  const Icon = KIND_ICON[doc.kind];
  const needsReview = doc.classificationConfidence < REVIEW_THRESHOLD && !doc.kindConfirmedByUser;

  return (
    <>
      <tr className="border-b border-hairline last:border-0 hover:bg-sunken/60">
        <td className="px-3 py-2 align-top">
          <button
            onClick={onToggle}
            aria-label={expanded ? `Collapse extracted fields for ${doc.fileName}` : `Expand extracted fields for ${doc.fileName}`}
            aria-expanded={expanded}
            className="text-ink-muted hover:text-ink"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-start gap-2">
            <Icon size={15} className="mt-0.5 shrink-0 text-ink-muted" />
            <div className="min-w-0">
              {/*
                * The filename opens the file. It is the thing a reader
                * reaches for first, and until there was a route to serve the
                * bytes it was inert text — a case could cite a document by
                * name that nobody could open.
                */}
              <button
                type="button"
                onClick={onPreview}
                title={`Open ${doc.fileName}`}
                className="block max-w-full truncate text-left font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
              >
                {doc.fileName}
              </button>
              {needsReview ? (
                <Badge tone="warning" className="mt-1">
                  Needs review
                </Badge>
              ) : null}
            </div>
          </div>
        </td>
        <td className="tabular px-3 py-2 align-top text-ink-secondary">{fileSize(doc.sizeBytes)}</td>
        <td className="tabular px-3 py-2 align-top text-ink-secondary">{doc.pages || '—'}</td>
        <td className="px-3 py-2 align-top text-ink-secondary">{relativeTime(doc.uploadedAt)}</td>
        <td className="px-3 py-2 align-top">
          <Select
            value={doc.kind}
            onChange={(e) => onKindChange(e.target.value as DocumentKind)}
            aria-label={`Kind for ${doc.fileName}`}
            className="!h-8 min-w-[10rem]"
          >
            {(Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[]).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          {doc.kindConfirmedByUser ? <div className="mt-1 text-[10px] text-ink-muted">Confirmed by user</div> : null}
        </td>
        <td className="px-3 py-2 align-top">
          <div className="w-24">
            <ProgressBar value={doc.classificationConfidence * 100} tone={needsReview ? 'warning' : 'good'} showValue={false} />
          </div>
          <div className="tabular mt-1 text-[11px] text-ink-muted">{Math.round(doc.classificationConfidence * 100)}%</div>
        </td>
        <td className="px-3 py-2 text-right align-top">
          <button onClick={onDelete} aria-label={`Delete ${doc.fileName}`} className="rounded p-1 text-ink-muted hover:bg-critical/10 hover:text-critical">
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-hairline bg-sunken/40 last:border-0">
          <td />
          <td colSpan={7} className="px-3 py-3">
            <ExtractedFieldsTable fields={doc.extracted} onOpenSource={onPreviewPage} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExtractedFieldsTable({
  fields,
  onOpenSource,
}: {
  fields: ExtractedField[];
  onOpenSource: (page?: number) => void;
}) {
  if (fields.length === 0) {
    return <p className="text-xs text-ink-muted">No fields extracted from this document yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="py-1 pr-3 font-medium">Label</th>
            <th className="py-1 pr-3 font-medium">Value</th>
            <th className="py-1 pr-3 font-medium">Unit</th>
            <th className="py-1 pr-3 font-medium">Confidence</th>
            <th className="py-1 pr-3 font-medium">Method</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const low = f.confidence < 0.6;
            return (
              <tr key={f.key} className="border-t border-hairline/70">
                <td className="py-1.5 pr-3 text-ink-secondary">{f.label}</td>
                <td className="py-1.5 pr-3 font-medium text-ink">{f.value}</td>
                <td className="py-1.5 pr-3 text-ink-muted">{f.unit ?? '—'}</td>
                <td className="py-1.5 pr-3">
                  <span className="tabular text-ink-secondary">{Math.round(f.confidence * 100)}%</span>
                  {low ? (
                    <Badge tone="warning" className="ml-1.5">
                      Low
                    </Badge>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-ink-muted">{titleCase(f.method)}</td>
                {/*
                  * Open the document this value came from — at its page when
                  * an extractor genuinely located one, and at the top when
                  * none did. The label says which, because "page 3" and "no
                  * page recorded" are different claims about how well this
                  * value is evidenced.
                  */}
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenSource(f.sourcePage)}
                    className="text-[11.5px] text-brand hover:underline"
                  >
                    {f.sourcePage ? `Page ${f.sourcePage}` : 'Open'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
