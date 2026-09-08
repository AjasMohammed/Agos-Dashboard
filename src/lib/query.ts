import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { isTimeoutError } from "@/lib/errors";

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Shared QueryClient. Queries get a sane staleTime and never retry on 4xx
 * (client errors won't fix themselves) — except 429, which is the one 4xx that
 * asks to be retried, after the delay the server names in `Retry-After`.
 * Mutation errors are surfaced per call site (every `mutateAsync` has a local
 * `.catch(toastError)` / try-catch), so there is intentionally no global
 * mutation `onError` here — a global one would double-toast on top of the
 * local handlers.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A 30s deadline won't clear on the next try; three of them is a
        // 90-second skeleton. The error state offers Retry instead.
        if (isTimeoutError(error)) return false;
        if (error instanceof ApiError) {
          // A non-JSON 2xx recast by client.ts: wrong origin or a proxy page,
          // not a blip.
          if (error.code === "BAD_GATEWAY") return false;
          if (error.status === 429) return failureCount < 2;
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt, error) => {
        const hinted = error instanceof ApiError ? error.retryAfterMs : undefined;
        return Math.min(hinted ?? 1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
      },
      refetchOnWindowFocus: false,
    },
  },
});
