import { afterEach, describe, expect, it, vi } from "vitest";

const backendSummary = {
  id: "dataset-1",
  owner_subject: "publicador-uno",
  title: "Temperatura del campus",
  slug: "temperatura-campus",
  description: "Serie pública de temperatura exterior.",
  topic: "Clima",
  tags: ["temperatura"],
  license: "CC BY 4.0",
  status: "published",
  published_at: "2026-08-20T12:00:00Z",
  downloads: 15,
  current_version: 1,
  resource_count: 1,
  formats: ["csv"],
  row_count: 24,
  byte_size: 2048,
  spatial_coverage: { centroid_latitude: 4.71, centroid_longitude: -74.07, precision_reduced: true, crs: "EPSG:4326" },
  temporal_coverage: { starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-08-20T00:00:00Z", frequency: "1 hora", timezone_name: "UTC" },
};

describe("adaptadores del API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("convierte DatasetPage snake_case al modelo de catálogo", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [backendSummary], next_cursor: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await import("@/lib/api");

    const result = await getCatalog({ q: "temperatura", sensor: "Clima", variable: "temp_c", location: "campus", period: "12m", mapOnly: true, sort: "downloads" });

    expect(result.meta.source).toBe("api");
    expect(result.data.items[0]).toMatchObject({ organization: "publicador-uno", sensorType: "Clima", status: "published", rows: 24, formats: ["CSV"], temporal: { start: "2026-08-01", end: "2026-08-20", frequency: "1 hora" }, location: { latitude: 4.71, longitude: -74.07, precision: "aproximada" } });
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toContain("sensor=Clima");
    expect(requestUrl).toContain("variable=temp_c");
    expect(requestUrl).toContain("location=campus");
    expect(requestUrl).toContain("period=12m");
    expect(requestUrl).toContain("sort=downloads");
    expect(requestUrl).toContain("has_location=true");
  });

  it("expone y reenvía el cursor opaco sin inventar un total global", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [backendSummary], next_cursor: "opaque-page-2" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCatalog } = await import("@/lib/api");

    const first = await getCatalog({ sort: "title" });
    const second = await getCatalog({ sort: "title" }, first.data.nextCursor ?? undefined);

    expect(first.data).toMatchObject({ nextCursor: "opaque-page-2" });
    expect(first.data).not.toHaveProperty("availableTotal");
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=opaque-page-2");
    expect(second.data.nextCursor).toBeNull();
  });

  it("convierte QueryResult.rows a lecturas sólo cuando tiempo y valor son válidos", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ columns: ["observed_at", "sensor_id", "pm25", "unit"], rows: [{ observed_at: "2026-08-20T10:00:00Z", sensor_id: "S-1", pm25: 31.5, unit: "µg/m³" }, { observed_at: "sin-fecha", pm25: 9 }], returned: 2, limit: 100, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { getReadings } = await import("@/lib/api");

    const result = await getReadings("temperatura-campus");

    expect(result.data).toEqual([{ observedAt: "2026-08-20T10:00:00Z", station: "S-1", value: 31.5, unit: "µg/m³" }]);
  });

  it("consulta y prioriza el campo de medida mapeado sobre las coordenadas", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      columns: ["observed_at", "sensor_id", "leq_db"],
      rows: [{ observed_at: "2026-08-20T10:00:00Z", sensor_id: "S-2", longitude: -74.07, leq_db: 63.2 }],
      returned: 1,
      limit: 100,
      offset: 0,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getReadings } = await import("@/lib/api");

    const result = await getReadings("ruido", {
      timeField: "observed_at",
      sensorField: "sensor_id",
      measurementField: "leq_db",
      unit: "dB",
    });

    expect(result.data[0]).toEqual({ observedAt: "2026-08-20T10:00:00Z", station: "S-2", value: 63.2, unit: "dB" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ order_by: "observed_at", descending: false });
  });

  it("propaga un fallo real de la API cuando el modo demo está desactivado", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "API caída" }), { status: 503, headers: { "Content-Type": "application/json" } })));
    const { getCatalog } = await import("@/lib/api");

    await expect(getCatalog()).rejects.toThrow("API caída");
  });

  it("gestiona versiones y tokens sin volver a exponer secretos listados", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    const detail = {
      ...backendSummary,
      versions: [{ id: "version-1", number: 1, status: "published", changelog: "Inicial", is_current: true, published_at: backendSummary.published_at, resources: [], semantic_mappings: [], spatial_coverage: backendSummary.spatial_coverage, temporal_coverage: backendSummary.temporal_coverage }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "token-1", name: "Gateway", prefix: "abcd1234", scopes: ["records:write"], expires_at: null, last_used_at: null, revoked_at: null, created_at: "2026-09-08T12:00:00Z" }]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "token-2", name: "Nodo", prefix: "efgh5678", token: "oidt_efgh5678_secret", scopes: ["records:write"], expires_at: null }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getDatasetManagement, getApiTokens, issueApiToken, revokeApiToken } = await import("@/lib/api");

    const managed = await getDatasetManagement("dataset-1");
    const tokens = await getApiTokens("dataset-1");
    const issued = await issueApiToken({ datasetId: "dataset-1", name: "Nodo" });
    await revokeApiToken("dataset-1", "token-1");

    expect(managed.data.versions[0]).toMatchObject({ id: "version-1", number: 1, status: "published" });
    expect(tokens.data[0]).toMatchObject({ prefix: "abcd1234", revokedAt: null });
    expect(tokens.data[0]).not.toHaveProperty("token");
    expect(issued.data.token).toBe("oidt_efgh5678_secret");
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
  });

  it("actualiza decisiones de moderación con el contrato del backend", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/api/v1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "report-1", dataset_id: "dataset-1", dataset_title: "Temperatura", dataset_owner: "owner", reporter_subject: null, reason: "Privacidad", details: "Revisar ubicación", status: "resolved", created_at: "2026-09-08T12:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { updateModerationReport } = await import("@/lib/api");

    const result = await updateModerationReport("report-1", "resolved");

    expect(result.data).toMatchObject({ datasetId: "dataset-1", state: "resolved", status: "Revisado" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: "resolved" });
  });
});
