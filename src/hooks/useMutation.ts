import { useCallback, useRef, useState } from 'react';
import { pushToast, useToastStore } from '../store/toastStore';

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * The shared write wrapper.
 *
 * Every repository mutation goes through `run`. On success it resolves with
 * the value; on failure it resolves with `undefined` and raises a retryable
 * toast. Callers therefore have to check the result before discarding the
 * user's input, which is what keeps a transient Supabase failure from
 * swallowing a typed task or timeblock:
 *
 *     const created = await run('Add task', () => repository.createEntry(input));
 *     if (!created) return;   // draft still on screen, safe to retry
 *     setDraft('');           // only now
 */
export function useMutation() {
  const [status, setStatus] = useState<MutationStatus>('idle');
  // Success is transient; the timer is cleared on unmount and on the next run.
  const successTimer = useRef<number | undefined>(undefined);

  const run = useCallback(
    async <T>(description: string, action: () => Promise<T>): Promise<T | undefined> => {
      window.clearTimeout(successTimer.current);
      setStatus('pending');
      try {
        const result = await action();
        setStatus('success');
        successTimer.current = window.setTimeout(() => setStatus('idle'), 1500);
        return result;
      } catch (error) {
        setStatus('error');
        const detail = error instanceof Error ? error.message : String(error);
        pushToast({
          tone: 'error',
          message: `${description} failed — nothing was saved. ${detail}`,
          retry: () => {
            void run(description, action);
          },
        });
        return undefined;
      }
    },
    [],
  );

  return {
    run,
    status,
    isPending: status === 'pending',
    isError: status === 'error',
    isSuccess: status === 'success',
  };
}

/** Number of unresolved failures, for anything that wants to show a marker. */
export function useFailureCount(): number {
  return useToastStore((state) => state.toasts.length);
}
