import { Suspense, lazy, useEffect, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import type { CaseDocument } from '@realytica/shared';
import { DocxView } from './DocxView';
import { documentFileUrl, fetchDocument, renderKindFor } from './source';
import type { DocumentSourceState } from './source';

/*
 * pdf.js is ~1.4 MB of parser and it is loaded only by a session that opens a
 * PDF — the app shell must not carry a renderer for a file nobody has clicked
 * on. Mammoth is deferred the same way, inside DocxView.
 */
const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));

/**
 * The document itself, rendered.
 *
 * Everything in Realytica is supposed to be traceable to a page someone can
 * look at; until this existed, "open the proof" showed a list of extracted
 * fields and a note admitting the page was not rendered — which is a citation
 * you cannot check, i.e. the one thing the product says it will not ship.
 *
 * The renderer is chosen from the type the SERVER resolved by sniffing the
 * bytes, never from the mime type the uploading client announced. A file this
 * app cannot render is offered as a download with the reason stated, rather
 * than handed to a renderer that will make something up.
 */
export function DocumentViewer({
  caseId,
  document: doc,
  citedPage,
  highlightTerm,
}: {
  caseId: string;
  document: CaseDocument;
  /** 1-based page the citation points at. */
  citedPage?: number;
  /** Usually the extracted value, so the proof is marked where it is stated. */
  highlightTerm?: string;
}) {
  const [state, setState] = useState<DocumentSourceState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void fetchDocument(caseId, doc.id).then((next) => {
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
  }, [caseId, doc.id]);

  if (state.status === 'loading') {
    return <Shell>Loading the file…</Shell>;
  }

  if (state.status === 'absent') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-2 text-center">
          <FileWarning size={20} className="text-ink-muted" />
          <p className="text-[12.5px] text-ink-secondary">
            This record has no file behind it.
          </p>
          <p className="max-w-[420px] text-[11.5px] text-ink-muted">
            The case names <span className="text-ink-secondary">{doc.fileName}</span> and holds what was extracted from it,
            but the bytes were never uploaded — every document in the seeded demo case is in this state. Upload the file to
            read it here.
          </p>
        </div>
      </Shell>
    );
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <p className="text-[12.5px] text-ink-secondary">The file could not be read: {state.message}</p>
      </Shell>
    );
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
    return <DocxView blob={state.blob} highlightTerm={highlightTerm} />;
  }

  if (kind === 'image') {
    return (
      <div className="h-full overflow-auto bg-surface-3 p-4">
        <img src={state.url} alt={doc.fileName} className="mx-auto block max-w-full bg-white shadow" />
      </div>
    );
  }

  if (kind === 'text') {
    return <TextView blob={state.blob} highlightTerm={highlightTerm} />;
  }

  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[12.5px] text-ink-secondary">
          Nothing here can render a {state.contentType.replace(/^application\//, '')} file.
        </p>
        <p className="max-w-[420px] text-[11.5px] text-ink-muted">
          It is stored and can be downloaded unchanged — but it is not being shown, rather than shown approximately.
        </p>
        <a
          href={documentFileUrl(caseId, doc.id)}
          download={doc.fileName}
          className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11.5px] font-medium text-[var(--brand-ink)]"
        >
          <Download size={12} /> Download {doc.fileName}
        </a>
      </div>
    </Shell>
  );
}

function TextView({ blob, highlightTerm }: { blob: Blob; highlightTerm?: string }) {
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

  const term = highlightTerm?.trim();
  return (
    <div className="h-full overflow-auto bg-surface-3 p-4">
      <pre className="mx-auto max-w-[820px] whitespace-pre-wrap bg-white px-8 py-8 font-mono text-[12px] leading-relaxed text-ink shadow">
        {term && term.length >= 2 ? markText(text, term) : text}
      </pre>
    </div>
  );
}

function markText(text: string, term: string) {
  const out: React.ReactNode[] = [];
  const needle = term.toLowerCase();
  let rest = text;
  let key = 0;
  let idx = rest.toLowerCase().indexOf(needle);
  while (idx !== -1) {
    if (idx > 0) out.push(rest.slice(0, idx));
    out.push(<mark key={key++}>{rest.slice(idx, idx + term.length)}</mark>);
    rest = rest.slice(idx + term.length);
    idx = rest.toLowerCase().indexOf(needle);
  }
  out.push(rest);
  return out;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-surface-3 p-8">{children}</div>;
}
