import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '../../components/ui/kit';
import { hash } from './engine';
import { ExampleFoot } from './parts';
import { PlaceProvider, readPlace, usePlace } from './place';
import { ExampleProvider, useExample } from './state';
import { CopilotChat } from './CopilotChat';
import { DocumentViewer } from './DocumentViewer';
import { FunctionPage } from './FunctionPage';
import { Overview } from './Overview';
import { ProofPane } from './proof/ProofPane';
import { SummaryPage } from './SummaryPage';
import { WorkBar } from './WorkBar';

/**
 * The example project: a whole workspace anybody can open and press, with
 * made-up data and nothing saved.
 *
 * Three panels. The copilot on the left, the work in the middle, and on the
 * right the proof of whatever is picked, which is there only while something
 * is. On a narrow screen the copilot is a drawer and the proof lies over the
 * lower part of the work.
 */
export default function ExampleWorkspace() {
  return (
    <ExampleProvider>
      <Routed />
    </ExampleProvider>
  );
}

/** Reads the address: the page it means, or the address to go to instead. */
function Routed() {
  const params = useParams<{ department?: string; fn?: string }>();
  const [query] = useSearchParams();
  const location = useLocation();
  const stage = query.get('stage');
  const part = query.get('part');
  const place = useMemo(() => readPlace(params.department, params.fn, stage), [params.department, params.fn, stage]);
  // A new object for each visit, so going to the same section twice brings it into view twice.
  const jump = useMemo(() => (part ? { id: part, at: hash(location.key) } : null), [part, location.key]);

  if ('redirect' in place) return <Navigate to={place.redirect} replace />;
  return (
    <PlaceProvider value={place}>
      <Frame jump={jump} />
    </PlaceProvider>
  );
}

function Frame({ jump }: { jump: { id: string; at: number } | null }) {
  const place = usePlace();
  const { state, dispatch } = useExample();
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const proofOpen = state.picked !== null && state.picked.at === place.key;

  // Each page starts at its top, with the bar lying flat on it.
  useEffect(() => setScrolled(false), [place.key]);

  // Escape puts away the nearest thing: the copilot's drawer, then the proof. An open paper closes itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || state.viewing) return;
      if (copilotOpen) setCopilotOpen(false);
      else if (proofOpen) dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copilotOpen, proofOpen, state.viewing, dispatch]);

  return (
    <div
      className={cn(
        'relative grid h-[100dvh] grid-cols-[minmax(0,1fr)] overflow-hidden bg-page text-ink',
        proofOpen ? 'lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[304px_minmax(0,1fr)_440px]' : 'xl:grid-cols-[304px_minmax(0,1fr)]',
      )}
    >
      {/* Behind the copilot's drawer on a narrow screen: pressing anywhere outside it puts it away. */}
      {copilotOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close the copilot"
          onClick={() => setCopilotOpen(false)}
          className="absolute inset-0 z-[19] cursor-default bg-[rgba(var(--shadow-tint),0.3)] xl:hidden"
        />
      ) : null}
      <CopilotChat open={copilotOpen} onClose={() => setCopilotOpen(false)} />
      <main aria-label="Work" className="flex min-h-0 min-w-0 flex-col">
        <WorkBar scrolled={scrolled} copilotOpen={copilotOpen} onCopilot={() => setCopilotOpen((open) => !open)} />
        {/* Keyed by the page, so each one starts at its top. It is the container every breakpoint inside it measures. */}
        <div
          key={place.key}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [container-type:inline-size]"
        >
          <div className="mx-auto flex max-w-[1440px] flex-col gap-3.5 px-5 pb-14 pt-3.5">
            {!place.dept ? (
              <Overview />
            ) : place.fn ? (
              <FunctionPage dept={place.dept} fn={place.fn} jump={jump} />
            ) : (
              <SummaryPage dept={place.dept} stage={place.stage} jump={jump} />
            )}
            <ExampleFoot />
          </div>
        </div>
      </main>
      <ProofPane />
      <DocumentViewer />
    </div>
  );
}
