import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { AuthGate } from './components/layout/AuthGate';
import { ToastHost } from './components/ui/kit';
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
import SiteRecord from './pages/projects/SiteRecord';
import { RisksActions, DecisionRegister } from './pages/projects/RisksDecisions';
import Reports from './pages/projects/Reports';
import Valuation from './pages/projects/Valuation';
import AiDrafts from './pages/projects/AiDrafts';
import ProjectPeople from './pages/projects/ProjectPeople';

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
const FlowList = lazy(() => import('./pages/flows/FlowList'));
const FlowStudio = lazy(() => import('./pages/flows/FlowStudio'));
const Observability = lazy(() => import('./pages/Observability'));
const Prompts = lazy(() => import('./pages/Prompts'));
const Libraries = lazy(() => import('./pages/projects/Libraries'));

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

export default function App() {
  return (
    <ToastHost>
      <Routes>
        {/* The landing page is the one thing outside the gate: somebody has to
            be able to read what this is before being asked to sign in. */}
        <Route index element={<Landing />} />
        <Route
          element={
            <AuthGate>
              <AppShell />
            </AuthGate>
          }
        >
          <Route path="app" element={<Navigate to="/projects" replace />} />
          <Route path="work" element={<MyWork />} />
          <Route path="flows" element={<FlowList />} />
          <Route path="flows/:flowId" element={<FlowStudio />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/new" element={<NewProject />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Overview />} />
            <Route path="cockpit" element={<Navigate to=".." replace />} />
            <Route path="assets" element={<Assets />} />
            <Route path="dd" element={<Diligence />} />
            <Route path="dd/:ddId" element={<DdWorkspace />} />
            <Route path="dd/:ddId/scopes/:scopeId" element={<ScopeWorkspace />} />
            <Route path="evidence" element={<EvidenceRegister />} />
            <Route path="visits" element={<SiteRecord />} />
            <Route path="findings" element={<FindingRegister />} />
            <Route path="risks" element={<RisksActions />} />
            <Route path="decisions" element={<DecisionRegister />} />
            <Route path="reports" element={<Reports />} />
            <Route path="valuation" element={<Valuation />} />
            <Route path="graph" element={<CockpitGraph />} />
            <Route path="ai" element={<AiDrafts />} />
            <Route path="orchestrate" element={<CockpitOrchestrate />} />
            <Route path="people" element={<ProjectPeople />} />
          </Route>
          <Route path="libraries" element={<Libraries />} />
          <Route path="observability" element={<Observability />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="members" element={<Members />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </ToastHost>
  );
}
