import { client, unwrap, ApiError } from "@/api/client";
import { useAuthStore } from "./store";

/** Exchange an operator credential for an API key and store the session. */
export async function login(credential: string): Promise<void> {
  const issued = unwrap(await client.POST("/api/v1/auth/login", { body: { credential } }));
  useAuthStore.getState().setSession({
    apiKey: issued.api_key,
    keyId: issued.key_id,
    name: issued.name,
    scopes: issued.scopes,
    expiresAt: issued.expires_at ?? null,
  });
}

/**
 * Refresh scopes/identity from `GET /auth/me` on app load. No-op when no key is
 * present. Only a revoked/expired key (401/403) logs the user out — a transient
 * network or server error must NOT wipe a valid persisted session.
 */
export async function hydrateSession(): Promise<void> {
  if (!useAuthStore.getState().apiKey) {
    useAuthStore.setState({ hydrated: true });
    return;
  }
  try {
    const me = unwrap(await client.GET("/api/v1/auth/me"));
    useAuthStore.getState().setSession({
      keyId: me.key_id,
      name: me.name,
      scopes: me.scopes,
      expiresAt: me.expires_at ?? null,
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      useAuthStore.getState().clear();
    } else {
      // Keep the session; just mark hydration done so the app renders.
      useAuthStore.setState({ hydrated: true });
    }
  }
}

export function logout(): void {
  useAuthStore.getState().clear();
}
