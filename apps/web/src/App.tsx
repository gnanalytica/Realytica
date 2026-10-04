import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { MotionRoot } from './lib/motion';
import AppShell from './components/layout/AppShell';
import { AuthGate } from './components/layout/AuthGate';
import { Spinner, ToastHost } from './components/ui/kit';
import MyWork from './pages/MyWork';
import Landing from './pages/Landing';

import ProjectList from './pages/projects/ProjectList';
import NewProject from './pages/projects/NewProject';
import ProjectLayout from './pages/projects/ProjectLayout';
import Overview from './pages/projects/Overview';
import Assets from './pages/projects/Assets';
import Diligence from './pages/projects/Diligence';
import DdWorkspace from './pages/projects/DdWorkspace';
import ScopeWorkspace from './pages/projects/ScopeWorkspace';
import { EvidenceRegister, FindingRegister } from './pages/projects/Registers';
import SiteView from './pages/projects/SiteView';
import { RisksActions, DecisionRegister } from './pages/projects/RisksDecisions';
import Reports from './pages/projects/Reports';
import Valuation from './pages/projects/Valuation';
import AiDrafts from './pages/projects/AiDrafts';
import ProjectPeople from './pages/projects/ProjectPeople';
import DepartmentPage from './pages/projects/departments/DepartmentPage';
import WorkstreamPage from './pages/projects/departments/WorkstreamPage';

/*
 * Split at the route, for the screens most sessions never open.
 *
 * Everything below was in the first chunk, so signing in meant downloading the
 * flow canvas, the prompt registry and the telemetry explorer before the
 * sign-in button could paint. These are whole screens reached by a deliberate
 * click, which makes them the cheapest possible thing to defer: nobody
 * navigates to the flow studio by accident, and by the time they do the chunk
 * is a single request against a warm connection.
 *
 * The project workspace deliberately stays eager. It is where people land and
 * where they spend the day, and a spinner between two tabs of the same screen
 * would be a worse trade than the bytes it saves.
 */
const About = lazy(() => import('./pages/About'));
const Members = lazy(() => import('./pages/Members'));
const Libraries = lazy(() => import('./pages/projects/Libraries'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Requests = lazy(() => import('./pages/Requests'));
const ReportPrint = lazy(() => import('./pages/projects/ReportPrint'));
/*
 * The example project carries every function's made-up data with it, a third
 * of a megabyte nobody working on a real project needs, so it arrives only
 * when it is opened.
 */
const ExampleWorkspace = lazy(() => import('./pages/example/ExampleWorkspace'));

/*
 * Two project tabs that are the exception to the eager rule above.
 *
 * The graph is a full node-and-edge canvas and the orchestration pane is a
 * second one; together they are most of the workspace's weight and neither is
 * on the path anybody takes to read a register. They are the only tabs inside
 * a project worth a spinner.
 */
const CockpitGraph = lazy(() => import('./pages/projects/cockpit/embed').then((m) => ({ default: m.CockpitGraph })));
const CockpitOrchestrate = lazy(() =>
  import('./pages/projects/cockpit/embed').then((m) => ({ default: m.CockpitOrchestrate })),
);

/** An old dashboard address: the same project's workspace, keeping any `?ask=`. */
function ToWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const { search } = useLocation();
  return <Navigate to={`/projects/${projectId}${search}`} replace />;
}

export default function App() {
  return (
    <MotionRoot>
    <ToastHost>
      <Routes>
        {/* The landing page is the one thing outside the gate: somebody has to
            be able to read what this is before being asked to sign in. */}
        <Route index element={<Landing />} />
        {/* The example project stands outside the gate too: it is the product
            shown whole, with made-up data and nothing saved, for somebody who
            has no account yet. It fills the window, so it is outside the
            shell as well. */}
        <Route
          path="example/:department?/:fn?"
          element={
            <Suspense fallback={<div className="grid h-[100dvh] place-items-center bg-page"><Spinner size={18} /></div>}>
              <ExampleWorkspace />
            </Suspense>
          }
        />
        {/* An address that runs on past a function is still the example's: without this it fell to the app's catch-all, which is the sign-in door for a visitor. */}
        <Route path="example/*" element={<Navigate to="/example" replace />} />
        {/* The printable report stands outside the shell, so the page that
            prints is the report and not the navigation around it. */}
        <Route
          path="projects/:projectId/reports/:reportId/print"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <ReportPrint />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          element={
            <AuthGate>
              <AppShell />
            </AuthGate>
          }
        >
          <Route path="app" element={<Navigate to="/portfolio" replace />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="requests" element={<Requests />} />
          <Route path="work" element={<MyWork />} />
          {/* Automations are off in this build; an old link lands somewhere useful. */}
          <Route path="flows/*" element={<Navigate to="/portfolio" replace />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/new" element={<NewProject />} />
          {/* The case dashboard is now the workspace's Overview. Old links, and a
              question asked from them, land there. */}
          <Route path="projects/:projectId/dashboard" element={<ToWorkspace />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Overview />} />
            <Route path="cockpit" element={<Navigate to=".." replace />} />
            <Route path="assets" element={<Assets />} />
            <Route path="dd" element={<Diligence />} />
            <Route path="dd/:ddId" element={<DdWorkspace />} />
            <Route path="dd/:ddId/scopes/:scopeId" element={<ScopeWorkspace />} />
            <Route path="evidence" element={<EvidenceRegister />} />
            <Route path="visits" element={<SiteView />} />
            {/* The page is called Site everywhere it is linked, so that is the
                address people bookmark and paste. Without this it fell through
                to the catch-all and landed them on the projects list. */}
            <Route path="site" element={<Navigate to="../visits" replace />} />
            <Route path="findings" element={<FindingRegister />} />
            <Route path="risks" element={<RisksActions />} />
            <Route path="decisions" element={<DecisionRegister />} />
            <Route path="reports" element={<Reports />} />
            <Route path="valuation" element={<Valuation />} />
            <Route path="graph" element={<CockpitGraph />} />
            <Route path="ai" element={<AiDrafts />} />
            <Route path="orchestrate" element={<CockpitOrchestrate />} />
            <Route path="people" element={<ProjectPeople />} />
            <Route path="d/:department" element={<DepartmentPage />} />
            <Route path="w/:workstream" element={<WorkstreamPage />} />
          </Route>
          <Route path="libraries" element={<Libraries />} />
          {/* Model operations are backend-only: the API keeps /api/telemetry
              and /api/prompts for admins, and the pages are not in the app. */}
          <Route path="observability" element={<Navigate to="/portfolio" replace />} />
          <Route path="prompts" element={<Navigate to="/portfolio" replace />} />
          <Route path="members" element={<Members />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/portfolio" replace />} />
        </Route>
      </Routes>
    </ToastHost>
    </MotionRoot>
  );
}
