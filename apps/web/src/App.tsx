import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { ToastHost } from './components/ui/kit';
import Dashboard from './pages/Dashboard';
import NewCase from './pages/NewCase';
import Compare from './pages/Compare';
import About from './pages/About';
import Observability from './pages/Observability';
import Prompts from './pages/Prompts';
import Intake from './pages/Intake';
import CaseWorkspace from './pages/case/CaseWorkspace';

export default function App() {
  return (
    <ToastHost>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="start" element={<Intake />} />
          <Route path="cases/new" element={<NewCase />} />
          <Route path="cases/:caseId" element={<CaseWorkspace />} />
          <Route path="cases/:caseId/:tab" element={<CaseWorkspace />} />
          <Route path="compare" element={<Compare />} />
          <Route path="observability" element={<Observability />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastHost>
  );
}
