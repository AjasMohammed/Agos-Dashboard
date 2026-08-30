import { toast } from "sonner";
import { ApiError } from "@/api/client";

/** Best-effort human message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
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
  const title =
    err instanceof ApiError ? `${err.code} (${err.status})` : "Error";
  toast.error(title, { description: errorMessage(err) });
}
