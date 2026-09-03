import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, Card, CardBody, EmptyState } from '../ui/kit';

/**
 * The last thing between a thrown render and a white screen.
 *
 * ## Why this exists at all
 *
 * React unmounts the whole tree when a render throws and nothing catches it.
 * Not the failing pane — the entire application, down to a blank document
 * with the reason visible only in a console nobody has open. This codebase
 * shipped exactly that bug once: a register read a `const` inside a filter
 * callback that ran before the declaration, and the only symptom anywhere in
 * the product was that the screen went white.
 *
 * A boundary does not fix the bug. It changes the failure from "the product
 * is gone" to "this pane is broken and the rest still works", which is the
 * difference between a support call and a reload.
 *
 * ## Why it resets on navigation
 *
 * A boundary that has caught stays caught until its state is cleared, so
 * without a reset the first throw would poison every subsequent screen — the
 * user clicks away to a healthy pane and still sees the error. `resetKey`
 * carries the current path in; a different path clears the error and lets
 * the tree render again. That is also why `RouteErrorBoundary` exists as a
 * wrapper: hooks cannot be used in a class, and the path is a hook.
 *
 * ## What it deliberately does not do
 *
 * It does not report anywhere. There is no error sink in this deployment yet,
 * and a boundary that silently swallowed a stack while pretending to have
 * handled it would be worse than the white screen — at least a white screen
 * is unambiguous. The stack goes to the console, and to the screen behind a
 * disclosure, so whoever is looking at it can paste it into a bug report.
 */

interface Props {
  children: ReactNode;
  /** Changing this clears a caught error and re-renders the children. */
  resetKey?: string;
  /** Named in the message, so "Findings could not be drawn" beats "something went wrong". */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    // A new route is a new attempt. Without this the first throw is terminal
    // for the session: every later screen renders the same caught error.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink there is. Keep the component stack with it
    // — the message alone rarely says which pane threw.
    console.error('[ui] render failed', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const what = this.props.label ? `${this.props.label} could not be drawn` : 'This screen could not be drawn';

    return (
      <div className="p-4">
        <Card>
          <CardBody>
            <EmptyState
              icon={<TriangleAlert size={22} />}
              title={what}
              description="The rest of the app is still working — this is one pane, not the session. Nothing you had saved is affected."
              action={
                <Button size="sm" icon={<RotateCw size={13} />} onClick={this.retry}>
                  Try again
                </Button>
              }
            />
            <details className="mt-2 rounded-lg bg-sunken p-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
                What went wrong
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-muted">
                {error.message}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            </details>
          </CardBody>
        </Card>
      </div>
    );
  }
}

/**
 * The boundary with the current route wired to its reset.
 *
 * Use this anywhere inside the router. `ErrorBoundary` itself stays usable
 * outside one — the landing page and anything mounted above `BrowserRouter`
 * cannot call `useLocation`.
 */
export function RouteErrorBoundary({ children, label }: { children: ReactNode; label?: string }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname} label={label}>
      {children}
    </ErrorBoundary>
  );
}
