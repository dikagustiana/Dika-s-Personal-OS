import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PassphraseGate } from './components/PassphraseGate';
import { PassphraseRecovery, readRecoveryToken } from './components/PassphraseRecovery';
import { ToastViewport } from './components/ToastViewport';
import { readShareToken, SharePage } from './views/share/SharePage';
import './index.css';

/**
 * All the routing the app has, and both branches exist for the same reason:
 * someone is arriving with a token instead of the passphrase, so the view has
 * to take the gate's PLACE rather than sit behind it.
 *
 * A share link is checked first and never falls through. Whoever opens one has
 * no passphrase and must not be shown a screen asking for one — and, more to
 * the point, App and AppShell are never mounted on this path, which is what
 * makes "a share link renders one page with nowhere to navigate to" a fact
 * about what exists rather than a promise about what is hidden.
 *
 * The share token stays in the URL (the page is meant to be reopened);
 * clearing the recovery token is the recovery view's job, since that one is
 * single-use.
 */
function Root() {
  const [shareToken] = useState(readShareToken);
  const [recoveryToken, setRecoveryToken] = useState(readRecoveryToken);
  if (shareToken) return <SharePage token={shareToken} />;
  if (recoveryToken) {
    return (
      <PassphraseRecovery token={recoveryToken} onDone={() => setRecoveryToken(null)} />
    );
  }
  return (
    <PassphraseGate>
      <App />
    </PassphraseGate>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
      <ToastViewport />
    </ErrorBoundary>
  </React.StrictMode>,
);
