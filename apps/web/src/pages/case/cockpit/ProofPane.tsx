import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText } from 'lucide-react';
import type { CaseDocument, ExtractedField } from '@realytica/shared';
import { DocumentViewer } from '../../../components/viewer/DocumentViewer';
import { OriginalScript } from '../../../components/OriginalScript';
import { documentFileUrl } from '../../../components/viewer/source';
import { Button, cn } from '../../../components/ui/kit';
import { DOCUMENT_KIND_LABEL, relativeTime, titleCase } from '../../../lib/format';

/**
 * A document, open at its proof.
 *
 * The page renders on the left and what was read off it on the right, and the
 * two are linked in the direction that matters: click a fact and the viewer
 * goes to the page it came from and marks the words. That is the whole claim
 * of the product made checkable — a fact whose page you cannot reach is a
 * fact you are being asked to take on trust.
 *
 * The value itself is used as the search term because it is the only anchor
 * the extraction records; there is no stored snippet. When the term is not
 * found anywhere, nothing is marked and the recorded page is still shown,
 * which is the honest outcome — the viewer never invents a location.
 *
 * The header names the page the extraction RECORDED, not the page on screen:
 * the viewer moves to wherever the words actually turn out to be, and its own
 * toolbar is what reports that. Two places both claiming to say "the page you
 * are looking at" is how they come to disagree.
 */
export function ProofPane({
  caseId,
  document: doc,
  citedPage,
  onClose,
}: {
  caseId: string;
  document: CaseDocument;
  /** From the URL, so a shared cockpit link opens on the same page. */
  citedPage?: number;
  onClose: () => void;
}) {
  const [active, setActive] = useState<ExtractedField | null>(null);

  /* A new document, or a new citation, resets which fact is being traced. */
  useEffect(() => {
    setActive(citedPage ? doc.extracted.find((f) => f.sourcePage === citedPage) ?? null : null);
  }, [doc.id, citedPage, doc.extracted]);

  const page = active?.sourcePage ?? citedPage;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-hairline px-5 py-3">
        <FileText size={14} className="text-ink-muted" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{doc.fileName}</div>
          <div className="text-[11px] text-ink-muted">
            {DOCUMENT_KIND_LABEL[doc.kind]} · {relativeTime(doc.uploadedAt)}
            {page ? ` · cited at page ${page}` : ''}
          </div>
        </div>
        <div className="flex-grow" />
        <a
          href={documentFileUrl(caseId, doc.id)}
          download={doc.fileName}
          title="Download the original file"
          className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11.5px] text-ink-secondary hover:text-ink"
        >
          <Download size={12} /> Original
        </a>
        <Button variant="secondary" size="sm" onClick={onClose}>
          <ArrowLeft size={12} /> Dossier
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <DocumentViewer caseId={caseId} document={doc} citedPage={page} highlightTerm={active?.value} />
        </div>

        <aside className="flex w-[264px] shrink-0 flex-col border-l border-hairline bg-surface-2">
          <h3 className="border-b border-hairline px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            What this establishes
          </h3>
          {doc.extracted.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-ink-muted">Nothing has been extracted from this document yet.</p>
          ) : (
            <ul className="flex-1 overflow-y-auto">
              {doc.extracted.map((f) => {
                const on = active?.key === f.key;
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => setActive(on ? null : f)}
                      aria-pressed={on}
                      className={cn(
                        'block w-full border-b border-hairline px-4 py-2 text-left',
                        on ? 'bg-brand-soft' : 'hover:bg-surface-3',
                      )}
                    >
                      <span className="block text-[11px] text-ink-secondary">{f.label}</span>
                      <span className="block text-[12.5px] font-medium text-ink">
                        {f.value}
                        {f.unit ? <span className="font-normal text-ink-secondary"> {f.unit}</span> : null}
                        <OriginalScript original={f.originalValue} script={f.originalScript} className="ml-1.5 font-normal text-ink-secondary" />
                      </span>
                      <span className="tabular mt-0.5 block text-[10.5px] text-ink-muted">
                        {Math.round(f.confidence * 100)}% · {titleCase(f.method)}
                        {f.sourcePage ? ` · p.${f.sourcePage}` : ' · page not recorded'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-hairline px-4 py-2.5 text-[10.5px] leading-relaxed text-ink-muted">
            Selecting a fact goes to its page and marks where the value appears. Nothing is marked when the words are not
            found there.
          </p>
        </aside>
      </div>
    </div>
  );
}
