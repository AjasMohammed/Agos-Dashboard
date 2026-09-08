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
    /** From a `Retry-After` header (429/503), in ms — drives the query retry delay. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A signal that aborts when any of the inputs does. `AbortSignal.any` where the
 * runtime has it; a manual fan-in otherwise (older Safari, jsdom).
 */
export function anySignal(
  signals: (AbortSignal | null | undefined)[],
): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => Boolean(s));
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function looksLikeJson(response: Response): boolean {
  return /\bjson\b/i.test(response.headers.get("content-type") ?? "");
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
    // A 2xx that carries something other than JSON (a proxy interstitial, a
    // captive portal, the dev server's index.html from a misrouted base URL)
    // used to surface as a raw `SyntaxError` from the JSON parser — retried
    // twice, then printed verbatim. Recast it as a gateway error the rest of
    // the pipeline already understands. Empty bodies are left alone.
    const contentType = response.headers.get("content-type");
    if (
      response.ok &&
      response.status !== 204 &&
      contentType &&
      !looksLikeJson(response) &&
      response.headers.get("content-length") !== "0"
    ) {
      return new Response(
        JSON.stringify({
          error: {
            code: "BAD_GATEWAY",
            message: `The API answered with ${contentType.split(";")[0]} instead of JSON. Check that the panel points at the kernel's API origin.`,
            status: 502,
          },
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    return response;
  },
};

export const client = createClient<paths>({
  baseUrl: API_BASE,
  // Every request gets a deadline, merged with whatever signal the caller
  // attached (TanStack's per-query `signal`, so a superseded search request is
  // actually cancelled instead of running to completion).
  fetch: (input: Request) =>
    fetch(input, { signal: anySignal([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) }),
});
client.use(authMiddleware);

/**
 * `fetch` for the hand-rolled (non-openapi-fetch) calls — multipart upload, SSE
 * stream, file export. Injects the bearer and clears the auth store on 401 (so
 * the route guard bounces to `/login`, same as the typed client's middleware),
 * and applies a request deadline merged with any caller signal. Pass
 * `timeoutMs = null` for streaming responses, whose body is read for far
 * longer than any deadline.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number | null = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const key = useAuthStore.getState().apiKey;
  const headers = new Headers(init.headers);
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const signal = anySignal([
    init.signal,
    timeoutMs != null ? AbortSignal.timeout(timeoutMs) : undefined,
  ]);
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
    retryAfterMs(response),
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
  // 204 is "done, nothing to return" — a success, not an empty-body failure.
  if (result.response.status === 204) return undefined as T;
  if (result.data === undefined) {
    throw new ApiError(result.response.status, "EMPTY", "Empty response body");
  }
  // Shape drift (a bare payload with no envelope) used to resolve every hook to
  // `undefined`, which QueryState treated as data and rendered into a crash.
  if (typeof result.data !== "object" || result.data === null || !("data" in result.data)) {
    throw new ApiError(
      result.response.status,
      "SHAPE",
      "The API response is missing its data envelope — the kernel and panel versions may not match.",
    );
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
