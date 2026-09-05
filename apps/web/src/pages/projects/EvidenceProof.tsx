import { Suspense, lazy, useEffect, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import type { EvidenceAttachment, EvidenceRecord } from '@realytica/shared';
import { evidenceFileUrl } from '../../lib/api';
import { Button } from '../../components/ui/kit';
import { fetchEvidenceFile, renderKindFor, type DocumentSourceState } from '../../components/viewer/source';

/*
 * Both readers are loaded only when a document of that kind is opened.
 *
 * They carry the two largest dependencies in the app — a PDF engine and a
 * .docx converter — and most sessions open neither. Paying for them before the
 * sign-in screen paints was the single biggest thing in the bundle.
 */
const PdfView = lazy(() => import('../../components/viewer/PdfView').then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import('../../components/viewer/DocxView').then((m) => ({ default: m.DocxView })));

export function EvidenceProof({
  projectId,
  evidence,
  file,
  quotes,
  citedPage,
  highlightTerm,
  onClose,
}: {
  projectId: string;
  evidence: EvidenceRecord;
  file?: EvidenceAttachment;
  quotes?: Array<{ text: string; page?: number }>;
  citedPage?: number;
  highlightTerm?: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<DocumentSourceState>({ status: 'loading' });

  useEffect(() => {
    if (!file) {
      setState({ status: 'absent' });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void fetchEvidenceFile(projectId, evidence.id, file.id, file.fileName, file.mimeType).then((next) => {
      if (cancelled) {
        if (next.status === 'ready') URL.revokeObjectURL(next.url);
        return;
      }
      if (next.status === 'ready') objectUrl = next.url;
      setState(next);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, evidence.id, file?.id, file?.fileName, file?.mimeType, file]);

  const page = citedPage ?? quotes?.find((q) => q.page)?.page ?? evidence.quotes?.find((q) => q.page)?.page;
  const term = highlightTerm ?? quotes?.[0]?.text ?? evidence.quotes?.[0]?.text;
  const shownQuotes = quotes?.length ? quotes : evidence.quotes;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[min(92dvh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-ink">{evidence.title}</h2>
            <p className="truncate text-[11.5px] text-ink-muted">{file?.fileName ?? 'No file on this row'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {file ? (
              <a
                href={evidenceFileUrl(projectId, evidence.id, file.id)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-brand hover:bg-brand-soft"
              >
                <Download size={12} /> Download
              </a>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>
        {shownQuotes?.length ? (
          <div className="shrink-0 space-y-1 border-b border-hairline bg-sunken px-4 py-2">
            {shownQuotes.slice(0, 4).map((q, i) => (
              <p key={i} className="text-[12px] leading-relaxed text-ink-secondary">
                “{q.text}”{q.page ? <span className="text-ink-muted"> · p.{q.page}</span> : null}
              </p>
            ))}
          </div>
        ) : null}
        <div className="min-h-[18rem] flex-1 overflow-hidden bg-sunken">
          <ProofBody state={state} fileName={file?.fileName ?? evidence.title} citedPage={page} highlightTerm={term} />
        </div>
      </div>
    </div>
  );
}

function ProofBody({
  state,
  fileName,
  citedPage,
  highlightTerm,
}: {
  state: DocumentSourceState;
  fileName: string;
  citedPage?: number;
  highlightTerm?: string;
}) {
  if (state.status === 'loading') {
    return <Shell>Loading the file…</Shell>;
  }
  if (state.status === 'absent') {
    return (
      <Shell>
        <FileWarning size={20} className="text-ink-muted" />
        <p className="text-[12.5px] text-ink-secondary">This evidence row has no file behind it yet.</p>
        <p className="max-w-[420px] text-center text-[11.5px] text-ink-muted">
          Attach it in chat or on the register. Any quotes above came from ingest and are not the file.
        </p>
      </Shell>
    );
  }
  if (state.status === 'error') {
    return <Shell>The file could not be read: {state.message}</Shell>;
  }
  const kind = renderKindFor(state.contentType);
  if (kind === 'pdf') {
    return (
      <Suspense fallback={<Shell>Loading the PDF reader…</Shell>}>
        <PdfView
          url={state.url}
          citedPage={citedPage}
          highlight={highlightTerm ? { page: citedPage ?? 1, term: highlightTerm } : undefined}
        />
      </Suspense>
    );
  }
  if (kind === 'docx') {
    return (
      <Suspense fallback={<Shell>Loading the document reader…</Shell>}>
        <DocxView blob={state.blob} highlightTerm={highlightTerm} />
      </Suspense>
    );
  }
  if (kind === 'image') {
    return (
      <div className="h-full overflow-auto p-4">
        <img src={state.url} alt={fileName} className="mx-auto block max-w-full bg-white shadow" />
      </div>
    );
  }
  if (kind === 'text') return <TextView blob={state.blob} />;
  return (
    <Shell>
      <p className="text-[12.5px] text-ink-secondary">Nothing here can render a {state.contentType.replace(/^application\//, '')} file.</p>
      <p className="max-w-[420px] text-center text-[11.5px] text-ink-muted">
        Download it rather than see an approximation. Any quotes above came from ingest.
      </p>
    </Shell>
  );
}

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void blob.text().then((t) => {
      if (!cancelled) setText(t);
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (text === null) return <Shell>Reading the file…</Shell>;
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-white px-8 py-8 font-mono text-[12px] leading-relaxed text-ink">
      {text}
    </pre>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-ink-secondary">{children}</div>;
}
