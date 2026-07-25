import { AlertOctagon } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence. Without it a render error anywhere unmounts the whole
 * tree and leaves a blank page with no way back — indistinguishable, to the
 * person using it, from the app having lost their data.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
        <div className="w-full max-w-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-3">
            <AlertOctagon className="size-5 shrink-0 text-destructive" />
            <h1 className="text-lg font-bold">Something broke on screen</h1>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground-secondary">
            Your saved data is untouched — this is a display failure, not a data one.
            Try this view again, or reload if it keeps happening.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto border border-border-subtle bg-black/30 p-3 text-xs text-foreground-muted">
            {error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
