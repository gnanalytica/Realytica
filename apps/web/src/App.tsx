import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { AuthGate } from './components/layout/AuthGate';
import { ToastHost } from './components/ui/kit';
import About from './pages/About';
import Members from './pages/Members';
import Observability from './pages/Observability';
import Prompts from './pages/Prompts';
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
import Libraries from './pages/projects/Libraries';
import Valuation from './pages/projects/Valuation';
import AiDrafts from './pages/projects/AiDrafts';
import { CockpitGraph, CockpitOrchestrate } from './pages/projects/cockpit/embed';
import ProjectPeople from './pages/projects/ProjectPeople';

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
