import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  tone: 'error' | 'info';
  /** Present when the failed action can simply be tried again. */
  retry?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Callable outside React (from the mutation wrapper) as well as inside it.
 * Failures are never auto-dismissed: a write that silently vanished is the
 * exact failure mode this is here to make impossible.
 */
export function pushToast(toast: Omit<Toast, 'id'>): string {
  return useToastStore.getState().push(toast);
}
