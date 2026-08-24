export type FrontendAuthMode = "oidc-token" | "development-bypass" | "anonymous";

/**
 * Adaptador mínimo de autenticación para el cliente API.
 *
 * En producción, el shell OIDC debe guardar temporalmente el access token en
 * sessionStorage bajo `openiotdata:access-token`. No se persiste en localStorage.
 * El bypass sólo emite X-Dev-User cuando fue habilitado explícitamente al compilar.
 */
export function getAuthContext(): { mode: FrontendAuthMode; headers: HeadersInit } {
  if (typeof window !== "undefined") {
    const accessToken = window.sessionStorage.getItem("openiotdata:access-token");
    if (accessToken) return { mode: "oidc-token", headers: { Authorization: `Bearer ${accessToken}` } };
  }

  if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true") {
    return {
      mode: "development-bypass",
      headers: { "X-Dev-User": process.env.NEXT_PUBLIC_DEV_USER || "local-developer" },
    };
  }

  return { mode: "anonymous", headers: {} };
}

export function hasPublisherSession(): boolean {
  return getAuthContext().mode !== "anonymous";
}
