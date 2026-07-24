import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PassphraseGate } from './components/PassphraseGate';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PassphraseGate>
      <App />
    </PassphraseGate>
  </React.StrictMode>,
);
