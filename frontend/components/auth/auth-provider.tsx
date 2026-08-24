"use client";

import Keycloak, { type KeycloakTokenParsed } from "keycloak-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface AuthUser {
  subject: string;
  displayName: string;
  email?: string;
}

interface AuthContextValue {
  ready: boolean;
  authenticated: boolean;
  user?: AuthUser;
  mode: "oidc" | "development-bypass" | "anonymous";
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromClaims(claims?: KeycloakTokenParsed): AuthUser | undefined {
  if (!claims?.sub) return undefined;
  return {
    subject: claims.sub,
    displayName: String(claims.preferred_username || claims.name || claims.sub),
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<Keycloak | null>(null);
  const [state, setState] = useState<Omit<AuthContextValue, "login" | "logout">>(() => {
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "true") return { ready: false, authenticated: false, mode: "anonymous" };
    const name = process.env.NEXT_PUBLIC_DEV_USER || "local-developer";
    return { ready: true, authenticated: true, mode: "development-bypass", user: { subject: name, displayName: name } };
  });

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true") return;

    const client = new Keycloak({
      url: process.env.NEXT_PUBLIC_OIDC_URL || "/auth",
      realm: process.env.NEXT_PUBLIC_OIDC_REALM || "openiotdata",
      clientId: process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || "openiotdata-web",
    });
    clientRef.current = client;
    let refreshTimer: number | undefined;

    const persistToken = () => {
      if (client.token) window.sessionStorage.setItem("openiotdata:access-token", client.token);
      else window.sessionStorage.removeItem("openiotdata:access-token");
    };
    const refresh = async () => {
      try {
        const changed = await client.updateToken(45);
        if (changed) persistToken();
      } catch {
        window.sessionStorage.removeItem("openiotdata:access-token");
        setState({ ready: true, authenticated: false, mode: "anonymous" });
      }
    };

    client.init({
      onLoad: "check-sso",
      pkceMethod: "S256",
      checkLoginIframe: false,
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    }).then((authenticated) => {
      persistToken();
      setState({ ready: true, authenticated, mode: authenticated ? "oidc" : "anonymous", user: authenticated ? userFromClaims(client.tokenParsed) : undefined });
      if (authenticated) refreshTimer = window.setInterval(refresh, 30_000);
    }).catch(() => {
      window.sessionStorage.removeItem("openiotdata:access-token");
      setState({ ready: true, authenticated: false, mode: "anonymous" });
    });

    client.onTokenExpired = refresh;
    client.onAuthLogout = () => {
      window.sessionStorage.removeItem("openiotdata:access-token");
      setState({ ready: true, authenticated: false, mode: "anonymous" });
    };

    return () => {
      if (refreshTimer) window.clearInterval(refreshTimer);
      clientRef.current = null;
    };
  }, []);

  const login = useCallback(async () => {
    if (clientRef.current) await clientRef.current.login({ redirectUri: window.location.href });
  }, []);
  const logout = useCallback(async () => {
    window.sessionStorage.removeItem("openiotdata:access-token");
    if (clientRef.current) await clientRef.current.logout({ redirectUri: window.location.origin });
  }, []);

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
