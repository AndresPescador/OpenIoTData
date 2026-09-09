import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const keycloak = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(false),
  login: vi.fn().mockResolvedValue(undefined),
  register: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  updateToken: vi.fn().mockResolvedValue(false),
  token: undefined as string | undefined,
  tokenParsed: undefined as import("keycloak-js").KeycloakTokenParsed | undefined,
  onTokenExpired: undefined as (() => Promise<void>) | undefined,
  onAuthLogout: undefined as (() => void) | undefined,
}));

vi.mock("keycloak-js", () => ({
  default: vi.fn(function KeycloakMock() { return keycloak; }),
}));

import { AuthProvider, useAuth } from "@/components/auth/auth-provider";

function AuthActions() {
  const auth = useAuth();
  return <><span>{auth.user?.roles.join(",")}</span><button type="button" onClick={() => void auth.login()}>Ingresar</button><button type="button" onClick={() => void auth.register()}>Crear cuenta</button><button type="button" onClick={() => void auth.logout()}>Salir</button></>;
}

describe("AuthProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("expone registro y login mediante Keycloak", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "false");
    keycloak.tokenParsed = { sub: "moderator-1", preferred_username: "moderator", realm_access: { roles: ["publisher", "moderator"] } };
    keycloak.init.mockResolvedValueOnce(true);
    render(<AuthProvider><AuthActions /></AuthProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeEnabled());
    expect(screen.getByText("publisher,moderator")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await userEvent.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(keycloak.register).toHaveBeenCalledWith({ redirectUri: window.location.href });
    expect(keycloak.login).toHaveBeenCalledWith({ redirectUri: window.location.href });

    keycloak.token = "rotated-token";
    keycloak.updateToken.mockResolvedValueOnce(true);
    await keycloak.onTokenExpired?.();
    expect(keycloak.updateToken).toHaveBeenCalledWith(45);
    expect(window.sessionStorage.getItem("openiotdata:access-token")).toBe("rotated-token");

    await userEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(keycloak.logout).toHaveBeenCalledWith({ redirectUri: window.location.origin });
    expect(window.sessionStorage.getItem("openiotdata:access-token")).toBeNull();
  });
});
