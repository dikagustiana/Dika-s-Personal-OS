import type { KeyboardEvent } from 'react';

/**
 * Enter submits, and nothing else is intercepted.
 *
 * Extracted from the deleted views/work/Timebox.tsx (its handleDraftKey,
 * lines 116-124 at deletion) before that file went — it was the dead
 * timebox's one piece worth keeping, and the one-field create flow needs it.
 * preventDefault matters: inside a <form> the bare Enter would otherwise
 * submit the form too and fire the action twice.
 */
export function submitOnEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      action();
    }
  };
}
