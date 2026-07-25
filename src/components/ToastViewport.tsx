import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';

/**
 * Failed writes surface here and stay until dismissed. A write that vanished
 * without a trace is worse than a loud one, so nothing here auto-hides.
 */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-start gap-3 border bg-card p-3 shadow-lg',
            toast.tone === 'error' ? 'border-destructive/50' : 'border-gray-700',
          )}
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 size-4 shrink-0',
              toast.tone === 'error' ? 'text-destructive' : 'text-primary',
            )}
          />
          <p className="min-w-0 flex-1 text-sm leading-5 text-gray-200">{toast.message}</p>
          {toast.retry && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Retry"
              onClick={() => {
                dismiss(toast.id);
                toast.retry?.();
              }}
            >
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
