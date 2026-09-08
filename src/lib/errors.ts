import { toast } from "sonner";
import { ApiError } from "@/api/client";

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "name" in err
    ? String((err as { name?: unknown }).name)
    : undefined;
}

/**
 * Best-effort human message from any thrown value. Browser-native failures
 * (`TypeError: Failed to fetch`, `TimeoutError: signal timed out`) get a
 * sentence that says what to do rather than the engine's own wording.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const name = errorName(err);
  if (name === "TimeoutError") {
    return "The API took too long to respond. Check that the kernel is running, then retry.";
  }
  if (name === "AbortError") return "The request was cancelled.";
  if (err instanceof TypeError) {
    return "Can’t reach the API. Check that the kernel is running and that the panel points at its address.";
  }
  if (err instanceof SyntaxError) {
    return "The API returned something that isn’t JSON. Check the API address.";
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/** The request deadline fired (`AbortSignal.timeout`). */
export function isTimeoutError(err: unknown): boolean {
  return errorName(err) === "TimeoutError";
}

/** True for failures that come from the network, not from the API's own logic. */
export function isNetworkError(err: unknown): boolean {
  const name = errorName(err);
  return name === "TimeoutError" || (err instanceof TypeError && !(err instanceof ApiError));
}

/** Surface an error as a toast. 401s are silent (the guard handles redirect). */
export function toastError(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) return;
  if (err instanceof ApiError && err.status === 429) {
    // Per-IP throttle on the API (120-request burst, 2/s refill). Name it —
    // before this it surfaced as an opaque "CORS error".
    toast.warning("Rate limited", {
      id: "rate-limited",
      description: "The API is throttling this browser. Wait a few seconds and retry.",
    });
    return;
  }
  if (errorName(err) === "AbortError") return; // the caller cancelled it on purpose
  if (isNetworkError(err)) {
    toast.error("Connection problem", { id: "network-error", description: errorMessage(err) });
    return;
  }
  const title = err instanceof ApiError ? `${err.code} (${err.status})` : "Error";
  toast.error(title, { description: errorMessage(err) });
}
