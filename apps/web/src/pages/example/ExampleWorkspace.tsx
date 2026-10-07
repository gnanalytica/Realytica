import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '../../components/ui/kit';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { CopilotChat } from './CopilotChat';
import { DocumentViewer } from './DocumentViewer';
import { hash } from './engine';
import { ExampleFoot } from './parts';
import { PlaceProvider, readPlace, usePlace } from './place';
import { backToPicked } from './seek';
import { ExampleProvider, useExample } from './state';
import { FunctionPage } from './FunctionPage';
import { Overview } from './Overview';
import { ProofPane } from './proof/ProofPane';
import { SummaryPage } from './SummaryPage';
import { WorkBar } from './WorkBar';

/** From this width the copilot has a column of its own. Below it, it is a drawer. Tailwind's `xl`. */
const COPILOT_BESIDE = '(min-width: 1280px)';

/**
 * The example project: a whole workspace anybody can open and press, with
 * made-up data and nothing saved.
 *
 * Three panels. The copilot on the left, the work in the middle, and on the
 * right the proof of whatever is picked, which is there only while something
 * is. On a narrow screen the copilot is a drawer, and the proof takes the
 * lower part of the window, at most half of it, with the work above.
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
  const place = useMemo(() => readPlace(params.department, params.fn, stage, part), [params.department, params.fn, stage, part]);
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
  const paperOpen = state.viewing !== null && state.viewing.at === place.key;
  // Open as a drawer: on a wide screen the copilot is a column, always there, and covers nothing.
  const beside = useMediaQuery(COPILOT_BESIDE);
  const drawerOpen = copilotOpen && !beside;
  const behind = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Each page starts at its top, with the bar lying flat on it.
  useEffect(() => setScrolled(false), [place.key]);

  // While the drawer is open nothing behind it can be reached. Set before any effect that moves the keyboard.
  useLayoutEffect(() => {
    if (behind.current) behind.current.inert = drawerOpen;
  }, [drawerOpen]);

  // A drawer that closes hands the keyboard back to what opened it, unless something it showed has taken it.
  useEffect(() => {
    if (drawerOpen) return;
    const held = document.activeElement;
    if (opener.current && !(held && behind.current?.contains(held))) opener.current.focus();
    opener.current = null;
  }, [drawerOpen]);

  // Escape puts away the nearest thing: the copilot's drawer, then the proof. A menu or a paper that took the key closes itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || paperOpen) return;
      if (drawerOpen) setCopilotOpen(false);
      else if (proofOpen) {
        dispatch({ type: 'close' });
        backToPicked();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, proofOpen, paperOpen, dispatch]);

  const toggleCopilot = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCopilotOpen((open) => !open);
  };

  return (
    <div
      className={cn(
        'relative grid h-[100dvh] grid-cols-[minmax(0,1fr)] overflow-hidden bg-page text-ink',
        proofOpen
          ? cn(
              // Narrow: the proof is a row under the work, as tall as it needs and never more than half the window.
              // It gives way where the work would be left under 22.5rem (the bar, the row of icons, one field with
              // its buttons), though not below 12rem of its own.
              'grid-rows-[minmax(0,1fr)_fit-content(min(50%,max(12rem,100%_-_22.5rem)))]',
              // A phone held sideways has no height to share: the two stand side by side instead.
              'max-lg:short:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-lg:short:grid-rows-[minmax(0,1fr)]',
              'lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[304px_minmax(0,1fr)_440px]',
            )
          : 'grid-rows-[minmax(0,1fr)] xl:grid-cols-[304px_minmax(0,1fr)]',
      )}
    >
      {/* Behind the copilot's drawer on a narrow screen: pressing anywhere outside it puts it away. */}
      {drawerOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close the copilot"
          onClick={() => setCopilotOpen(false)}
          className="absolute inset-0 z-[19] cursor-default bg-[rgba(var(--shadow-tint),0.3)]"
        />
      ) : null}
      <CopilotChat open={drawerOpen} onClose={() => setCopilotOpen(false)} />
      {/* The work and its proof: one group, so both go out of reach together while the drawer is open. It adds no box of its own. */}
      <div ref={behind} className="contents">
        {/* The container the bar measures itself by. */}
        <main aria-label="Work" className="flex min-h-0 min-w-0 flex-col [container-type:inline-size]">
          <WorkBar scrolled={scrolled} copilotOpen={drawerOpen} onCopilot={toggleCopilot} />
          {/*
            Keyed by the page, so each one starts at its top. It is the container every breakpoint inside it measures.
            And the box anything inside it is placed by: text kept for a screen reader is placed out of the flow, and
            left to the frame it made the frame as tall as the page, so a link to a section scrolled the frame as well.
          */}
          <div
            key={place.key}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [container-type:inline-size]"
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
      </div>
      <DocumentViewer />
    </div>
  );
}
