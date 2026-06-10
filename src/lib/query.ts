import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";

/**
 * Shared QueryClient. Queries get a sane staleTime and never retry on 4xx
 * (client errors won't fix themselves). Mutation errors are surfaced per call
 * site (every `mutateAsync` has a local `.catch(toastError)` / try-catch), so
 * there is intentionally no global mutation `onError` here — a global one would
 * double-toast on top of the local handlers.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
