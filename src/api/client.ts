import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./types.gen";
import { useAuthStore } from "@/auth/store";

/**
 * Origin for the REST API (mock in dev, real agentos-api in integration). The
 * OpenAPI paths already carry the `/api/v1` prefix, so this is the bare origin
 * (or empty for same-origin) — it must NOT include `/api/v1`.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/** Default per-request deadline so a hung/black-holed API rejects instead of spinning forever. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * A failed API call. `status` is the HTTP status; `code` is the machine-readable
 * `ApiErrorBody.code` (e.g. `NOT_FOUND`, `FORBIDDEN`); `message` is human-facing.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Inject `Authorization: Bearer <key>` from the auth store, and on a 401 clear
 * the store so the route guard bounces the user to `/login`. Error *throwing*
 * is handled by {@link unwrap} so callers get a typed success payload or an
 * {@link ApiError}.
 */
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const key = useAuthStore.getState().apiKey;
    if (key) request.headers.set("Authorization", `Bearer ${key}`);
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) {
      useAuthStore.getState().clear();
    }
    return response;
  },
};

export const client = createClient<paths>({
  baseUrl: API_BASE,
  // No caller passes a per-call signal to the typed client, so overriding
  // `signal` with a deadline here is safe and gives every request a timeout.
  fetch: (input) => fetch(input, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
});
client.use(authMiddleware);

/**
 * `fetch` for the hand-rolled (non-openapi-fetch) calls — multipart upload, SSE
 * stream, file export. Injects the bearer and clears the auth store on 401 (so
 * the route guard bounces to `/login`, same as the typed client's middleware),
 * and applies the default request deadline. Pass `timeoutMs = null` for
 * streaming responses, whose body is read for far longer than any deadline.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number | null = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const key = useAuthStore.getState().apiKey;
  const headers = new Headers(init.headers);
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const signal =
    timeoutMs != null && !init.signal ? AbortSignal.timeout(timeoutMs) : init.signal;
  const res = await fetch(input, { ...init, headers, signal });
  if (res.status === 401) useAuthStore.getState().clear();
  return res;
}

/** The error body returned by the API on non-2xx responses. */
interface ApiErrorBody {
  code?: string;
  message?: string;
  status?: number;
}

/** Result shape returned by every `openapi-fetch` call. */
interface FetchResult<TData> {
  data?: TData;
  error?: unknown;
  response: Response;
}

/**
 * Normalize an error body into an {@link ApiError}. The live agentos-api wraps
 * it as `{ error: { code, message, status } }`; older builds (and the contract)
 * use the flat `{ code, message, status }` — accept both.
 */
function toApiError(error: unknown, response: Response): ApiError {
  const raw = (error ?? {}) as { error?: ApiErrorBody } & ApiErrorBody;
  const e = raw.error && typeof raw.error === "object" ? raw.error : raw;
  return new ApiError(
    e.status ?? response.status,
    e.code ?? "UNKNOWN",
    e.message ?? (response.statusText || "Request failed"),
  );
}

/**
 * Unwrap the server success envelope `{ data: T }` into `T`, or throw an
 * {@link ApiError} built from the error body.
 *
 * Usage: `const sessions = unwrap(await client.GET("/api/v1/chat/sessions"));`
 */
export function unwrap<T>(result: FetchResult<{ data: T }>): T {
  if (result.error !== undefined) {
    throw toApiError(result.error, result.response);
  }
  if (result.data === undefined) {
    throw new ApiError(result.response.status, "EMPTY", "Empty response body");
  }
  return result.data.data;
}

/** Unwrap a list envelope `{ data: T[], meta: { total } }` into `{ items, total }`. */
export function unwrapList<T>(
  result: FetchResult<{ data: T[]; meta?: { total?: number } }>,
): { items: T[]; total: number } {
  if (result.error !== undefined) {
    throw toApiError(result.error, result.response);
  }
  const body = result.data;
  return { items: body?.data ?? [], total: body?.meta?.total ?? body?.data?.length ?? 0 };
}
