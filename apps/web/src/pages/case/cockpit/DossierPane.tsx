import { useMemo } from 'react';
import { AlarmClock, ExternalLink, FileText, FileWarning, Plug } from 'lucide-react';
import { buildDepartmentDossier } from '@realytica/shared';
import type { DdDomain, PropertyCase, ReferenceData } from '@realytica/shared';
import { DOCUMENT_KIND_LABEL, relativeTime, severityTone, titleCase } from '../../../lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, Tile, cn } from '../../../components/ui/kit';
import { DepartmentVisuals } from './visuals';

/**
 * One department's dossier: what we know, the picture, the papers.
 *
 * The anatomy repeats for all eight departments — it is a projection
 * (`buildDepartmentDossier`) rendered, never eight bespoke pages. The one
 * rule the markup enforces on top of the projection's own: every fact is
 * rendered WITH its source chip, and the chip is the control that opens the
 * proof. There is no code path that renders a fact without one, because
 * `DossierFact` cannot exist without a document behind it.
 */
export function DossierPane({
  caseData,
  domain,
  refData,
  onOpenProof,
  onAddDocument,
}: {
  caseData: PropertyCase;
  domain: DdDomain;
  refData: ReferenceData | null;
  /** Open a document at a page — the Study layout. */
  onOpenProof: (documentId: string, page?: number) => void;
  onAddDocument: () => void;
}) {
  const dossier = useMemo(
    () => buildDepartmentDossier(caseData, domain, { refData: refData ?? undefined, now: new Date().toISOString() }),
    [caseData, domain, refData],
  );

  const empty =
    dossier.facts.length === 0 &&
    dossier.documents.length === 0 &&
    dossier.gaps.length === 0 &&
    dossier.watchers.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">{dossier.label}</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-muted">{dossier.question}</div>
        </div>
        <div className="flex-grow" />
        <button
          type="button"
          onClick={onAddDocument}
          className="rounded-full border border-[var(--ring)] bg-surface px-3 py-1 text-[11.5px] text-ink-secondary hover:text-ink"
        >
          Add document
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {empty ? (
          <EmptyState
            icon={<FileText size={26} />}
            title={`Nothing filed to ${dossier.label} yet`}
            description="Documents route here by kind, and their facts come with them. An empty department is a coverage fact, not a clean bill."
          />
        ) : null}

        {dossier.watchers.length > 0 ? (
          <Card>
            <CardHeader title="Watch" subtitle="Carried from a date that has passed — not asserted wrong" icon={<AlarmClock size={15} />} />
            <CardBody className="flex flex-col gap-2">
              {dossier.watchers.map((w) => (
                <Tile key={w.key} tone={w.severity === 'serious' || w.severity === 'critical' ? 'critical' : 'warning'} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(w.severity)}>{titleCase(w.severity)}</Badge>
                    <span className="text-[13px] font-semibold text-ink">{w.label}</span>
                    <span className="tabular ml-auto text-[11px] text-ink-muted">{w.ageDays} days</span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{w.what}</p>
                </Tile>
              ))}
            </CardBody>
          </Card>
        ) : null}

        {dossier.facts.length > 0 ? (
          <section>
            <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              What we know{' '}
              <span className="font-normal normal-case tracking-normal text-ink-muted">· click a source to open the proof</span>
            </h3>
            <ul className="flex flex-col">
              {dossier.facts.map((fact) => (
                <li key={fact.key} className="border-b border-hairline py-1.5 last:border-b-0">
                  {fact.varies ? (
                    /* Both versions are shown, and neither is called wrong. A
                       mother deed and the sale deed recite different
                       considerations because they are different conveyances —
                       whether a difference is a CONTRADICTION is the title
                       graph's judgement, not this pane's. */
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">
                          {(fact.values?.length ?? 2)} versions on file
                        </Badge>
                        <span className="text-[12.5px] font-medium text-ink">{fact.label}</span>
                      </div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {(fact.values ?? []).map((v) => (
                          <li key={v.value} className="flex items-start gap-2 pl-1">
                            <span className="flex-grow text-[12.5px] leading-relaxed text-ink">
                              {v.value}
                              {fact.unit ? <span className="text-ink-secondary"> {fact.unit}</span> : null}
                            </span>
                            <SourceChips sources={v.sources} onOpenProof={onOpenProof} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <span className="flex-grow text-[12.5px] leading-relaxed text-ink">
                        {fact.label}: <span className="font-medium">{fact.value}</span>
                        {fact.unit ? <span className="text-ink-secondary"> {fact.unit}</span> : null}
                      </span>
                      <SourceChips sources={fact.sources} onOpenProof={onOpenProof} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <DepartmentVisuals caseData={caseData} domain={domain} />

        {dossier.gaps.length > 0 ? (
          <div className="rounded-xl bg-surface-2 p-3 ring-1 ring-[var(--ring)]">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              <FileWarning size={12} /> Still to obtain · {dossier.gaps.length}
            </p>
            <ul className="flex flex-col gap-0.5">
              {dossier.gaps.map((gap) => (
                <li key={gap.id} className="text-[12.5px] text-ink-secondary">
                  {gap.label} <span className="text-ink-faint">· {gap.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {dossier.documents.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              Documents in this department{' '}
              <span className="font-normal normal-case tracking-normal text-ink-muted">· {dossier.documents.length}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {dossier.documents.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProof(doc.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border border-[var(--ring)] bg-surface px-3 py-2 text-left',
                      'hover:border-[var(--axis)]',
                    )}
                  >
                    <FileText size={13} className="shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-grow truncate text-[12.5px] text-ink">{doc.fileName}</span>
                    <span className="shrink-0 text-[10.5px] text-ink-muted">{DOCUMENT_KIND_LABEL[doc.kind]}</span>
                    {doc.factCount > 0 ? (
                      <span className="tabular shrink-0 rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-secondary">
                        {doc.factCount} facts
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10.5px] text-ink-faint">{relativeTime(doc.uploadedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {dossier.connectors.length > 0 ? (
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              <Plug size={12} /> Portals &amp; authorities
            </h3>
            <ul className="flex flex-col gap-1.5">
              {dossier.connectors.map((c) => (
                <li key={c.key} className="rounded-lg border border-[var(--ring)] bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{c.label}</span>
                    <span className="ml-auto truncate text-[10.5px] text-ink-muted">{c.authority}</span>
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${c.label}`}
                        className="shrink-0 text-ink-muted hover:text-brand"
                      >
                        <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{c.settles}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Every document that states the fact, each one openable.
 *
 * Two chips beside one line is corroboration and should read as strength —
 * which is why the count is never collapsed to "2 sources": the reader has to
 * be able to open the second one as easily as the first.
 */
function SourceChips({
  sources,
  onOpenProof,
}: {
  sources: { documentId: string; documentName: string; page?: number }[];
  onOpenProof: (documentId: string, page?: number) => void;
}) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {sources.map((s) => (
        <button
          key={`${s.documentId}:${s.page ?? ''}`}
          type="button"
          onClick={() => onOpenProof(s.documentId, s.page)}
          title={`Open ${s.documentName}${s.page ? `, page ${s.page}` : ''}`}
          className="rounded-[5px] bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand hover:underline"
        >
          {shortName(s.documentName)}
          {s.page ? ` p.${s.page}` : ''}
        </button>
      ))}
    </span>
  );
}

/** Keeps a long filename from pushing the value off the row. */
function shortName(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '');
  return stem.length > 22 ? `${stem.slice(0, 22)}…` : stem;
}
