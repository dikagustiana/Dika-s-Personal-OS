import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PassphraseGate } from './components/PassphraseGate';
import { PassphraseRecovery, readRecoveryToken } from './components/PassphraseRecovery';
import { ToastViewport } from './components/ToastViewport';
import './index.css';

/**
 * The one piece of routing the app has. A recovery link is followed while the
 * passphrase is unknown, so the token is read from the URL once at boot and the
 * recovery view takes the gate's place rather than sitting behind it. Clearing
 * the token from the URL is the recovery view's job; this only stops rendering
 * it once the owner is done.
 */
function Root() {
  const [recoveryToken, setRecoveryToken] = useState(readRecoveryToken);
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
