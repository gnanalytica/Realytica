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
import Landing from './pages/Landing';

export default function App() {
  return (
    <ToastHost>
      <Routes>
        {/*
          * The landing page sits outside the app shell, at the root.
          *
          * It has no sidebar, no top bar and no case context, so wrapping it
          * in `AppShell` would hand a first-time visitor the navigation of a
          * product they have not entered yet. The app itself moves to /app;
          * every deeper route keeps the path it always had, so existing links
          * to a case still resolve.
          */}
        <Route index element={<Landing />} />
        <Route element={<AppShell />}>
          <Route path="app" element={<Intake />} />
          <Route path="cases" element={<Dashboard />} />
          <Route path="cases/new" element={<NewCase />} />
          <Route path="cases/:caseId" element={<CaseWorkspace />} />
          <Route path="cases/:caseId/:tab" element={<CaseWorkspace />} />
          <Route path="compare" element={<Compare />} />
          <Route path="observability" element={<Observability />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="about" element={<About />} />
          {/* An unknown path inside the app returns to the app, not to the
              marketing page — being ejected to a sales pitch is a worse
              answer to a typo than landing on the chat. */}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Routes>
    </ToastHost>
  );
}
