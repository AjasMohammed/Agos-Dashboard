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
  const title =
    err instanceof ApiError ? `${err.code} (${err.status})` : "Error";
  toast.error(title, { description: errorMessage(err) });
}
