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
});
