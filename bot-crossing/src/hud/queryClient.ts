'use client';
import { QueryClient } from '@tanstack/react-query';

// One client for the whole app. drei/Html renders into its own React root,
// so the inspector mounts a provider with this same instance; the cache is
// shared either way.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});
