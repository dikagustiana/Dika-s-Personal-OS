import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PassphraseGate } from './components/PassphraseGate';
import { ToastViewport } from './components/ToastViewport';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PassphraseGate>
        <App />
      </PassphraseGate>
      <ToastViewport />
    </ErrorBoundary>
  </React.StrictMode>,
);
