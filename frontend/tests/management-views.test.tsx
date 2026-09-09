import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  archiveDataset: vi.fn(),
  createDatasetVersion: vi.fn(),
  getApiTokens: vi.fn(),
  getDatasetManagement: vi.fn(),
  getJob: vi.fn(),
  getModerationQueue: vi.fn(),
  issueApiToken: vi.fn(),
  publishDatasetVersion: vi.fn(),
  revokeApiToken: vi.fn(),
  updateModerationReport: vi.fn(),
  uploadVersionResource: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  mode: "oidc" as const,
  user: { subject: "owner", displayName: "Owner", roles: ["publisher", "moderator"] },
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => auth }));

import { DatasetManagementView } from "@/components/account/dataset-management-view";
import { AdminView } from "@/components/admin/admin-view";

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const dataset = {
  id: "dataset-1", slug: "temperatura", title: "Temperatura", description: "Serie", organization: "owner", author: "owner", sensorType: "Clima", variable: "temp", topic: "Clima", tags: [], license: "CC BY 4.0", formats: ["CSV"], rows: 12, size: "1 KB", downloads: 0, updatedAt: "2026-09-08", publishedAt: "2026-09-08", version: "1", apiAvailable: true, temporal: { start: "2026-09-01", end: "2026-09-08", frequency: "1 hora" }, schema: [], resources: [], activity: [], quality: { technical: "Aprobada", completeness: 100, provenance: "Verificada" }, status: "published",
};

describe("vistas de gestión", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user.roles = ["publisher", "moderator"];
    api.getDatasetManagement.mockResolvedValue({ data: { dataset, versions: [{ id: "version-1", number: 1, status: "published", changelog: "Inicial", isCurrent: true, publishedAt: "2026-09-08T00:00:00Z", resources: [] }] }, meta: { source: "api" } });
    api.getApiTokens.mockResolvedValue({ data: [], meta: { source: "api" } });
    api.issueApiToken.mockResolvedValue({ data: { id: "token-1", name: "Gateway", prefix: "abcd1234", token: "oidt_abcd1234_secret", scopes: ["records:write"], expiresAt: null }, meta: { source: "api" } });
    api.archiveDataset.mockResolvedValue({ data: undefined, meta: { source: "api" } });
    api.getModerationQueue.mockResolvedValue({ data: [{ id: "report-1", datasetId: "dataset-1", dataset: "Temperatura", owner: "owner", reason: "Privacidad", details: "Revisar coordenadas", state: "open", status: "Pendiente", reportedAt: "2026-09-08T00:00:00Z" }], meta: { source: "api" } });
    api.updateModerationReport.mockResolvedValue({ data: { id: "report-1", datasetId: "dataset-1", dataset: "Temperatura", owner: "owner", reason: "Privacidad", details: "Revisar coordenadas", state: "resolved", status: "Revisado", reportedAt: "2026-09-08T00:00:00Z" }, meta: { source: "api" } });
  });

  it("muestra el secreto sólo tras crear el token y confirma antes de archivar", async () => {
    renderWithQuery(<DatasetManagementView datasetId="dataset-1" />);
    await screen.findByRole("heading", { name: "Temperatura" });

    await userEvent.type(screen.getByLabelText(/nombre de la credencial/i), "Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Crear token" }));
    expect(await screen.findByText("oidt_abcd1234_secret")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText("oidt_abcd1234_secret")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Archivar" }));
    expect(screen.getByRole("group", { name: "Confirmar archivo" })).toBeInTheDocument();
    expect(api.archiveDataset).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group", { name: "Confirmar archivo" })).not.toBeInTheDocument();
  });

  it("permite a moderación resolver un reporte y actualiza su estado", async () => {
    renderWithQuery(<AdminView />);
    await screen.findByText("Revisar coordenadas");
    await userEvent.click(screen.getByRole("button", { name: "Resolver" }));

    await waitFor(() => expect(api.updateModerationReport).toHaveBeenCalledWith("report-1", "resolved"));
    expect(await screen.findByText("Decisión registrada")).toBeInTheDocument();
  });

  it("bloquea la cola cuando la cuenta no tiene rol de moderación", async () => {
    auth.user.roles = ["publisher"];
    renderWithQuery(<AdminView />);

    expect(screen.getByRole("heading", { name: "Acceso de moderación" })).toBeInTheDocument();
    expect(api.getModerationQueue).not.toHaveBeenCalled();
  });

  it("presenta un error de operación sin ocultarlo con datos demo", async () => {
    api.issueApiToken.mockRejectedValueOnce(new Error("No tienes permiso para emitir tokens"));
    renderWithQuery(<DatasetManagementView datasetId="dataset-1" />);
    await screen.findByRole("heading", { name: "Temperatura" });

    await userEvent.type(screen.getByLabelText(/nombre de la credencial/i), "Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Crear token" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No tienes permiso para emitir tokens");
  });
});
