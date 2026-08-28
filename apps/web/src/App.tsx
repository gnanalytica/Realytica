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
import Cockpit from './pages/case/Cockpit';
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
          {/*
            * One shell. The cockpit IS the case: screening, departments,
            * documents, requests, graph and report are panes within it,
            * rather than a second tabbed workspace that rendered the eight
            * departments a second time and carried a second chat.
            *
            * `:tab` still resolves so that every link already pasted into a
            * message — and every navigation the copilot itself emits —
            * lands on the equivalent pane instead of a 404.
            */}
          <Route path="cases/:caseId" element={<Cockpit />} />
          <Route path="cases/:caseId/cockpit" element={<Cockpit />} />
          <Route path="cases/:caseId/:tab" element={<Cockpit />} />
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
