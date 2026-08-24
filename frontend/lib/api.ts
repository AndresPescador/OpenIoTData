import { demoDatasets, demoModeration, demoReadings } from "@/lib/demo-data";
import { getAuthContext } from "@/lib/auth";
import type {
  ApiEnvelope,
  CatalogFilters,
  CatalogResponse,
  Dataset,
  DatasetPoint,
  DraftPayload,
  ModerationItem,
  SensorReading,
} from "@/lib/types";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const API_URL = configuredApiUrl ?? "/api/v1";
const allowDemoFallback = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
const demoNotice = "Datos ilustrativos: el backend no está disponible o el modo demostración está activo.";

interface BackendSpatialCoverage {
  centroid_latitude: number | null;
  centroid_longitude: number | null;
  precision_reduced: boolean;
  crs: string;
}

interface BackendTemporalCoverage {
  starts_at: string | null;
  ends_at: string | null;
  frequency: string | null;
  timezone_name: string;
}

interface BackendField {
  name: string;
  physical_type: string;
  logical_type: string;
  nullable: boolean;
  null_count: number;
  examples: Array<string | number | boolean>;
  semantic_hint: string | null;
}

interface BackendResource {
  id: string;
  name: string;
  original_filename: string;
  format: string;
  byte_size: number;
  checksum_sha256: string;
  row_count: number | null;
  status: string;
  schema_profile: { row_count: number; column_count: number; quality_summary: Record<string, unknown>; fields: BackendField[] } | null;
}

interface BackendSemanticMapping {
  resource_id: string;
  observed_at_field: string | null;
  latitude_field: string | null;
  longitude_field: string | null;
  sensor_id_field: string | null;
  variable_units: Record<string, string>;
  crs: string;
}

interface BackendVersion {
  id: string;
  number: number;
  status: string;
  changelog: string;
  is_current: boolean;
  published_at: string | null;
  resources: BackendResource[];
  semantic_mappings: BackendSemanticMapping[];
  spatial_coverage: BackendSpatialCoverage | null;
  temporal_coverage: BackendTemporalCoverage | null;
}

interface BackendDatasetSummary {
  id: string;
  owner_subject: string;
  title: string;
  slug: string;
  description: string;
  topic: string | null;
  tags: string[];
  license: string | null;
  status: string;
  published_at: string | null;
  downloads: number;
  current_version: number | null;
  resource_count: number;
  formats: string[];
  variables?: string[];
  row_count: number;
  byte_size: number;
  spatial_coverage: BackendSpatialCoverage | null;
  temporal_coverage: BackendTemporalCoverage | null;
}

interface BackendDatasetDetail extends BackendDatasetSummary { versions: BackendVersion[] }
interface BackendDatasetPage { items: BackendDatasetSummary[]; next_cursor: string | null }
interface BackendQueryResult { columns: string[]; rows: Array<Record<string, unknown>>; returned: number; limit: number; offset: number }

const wait = (duration = 180) => new Promise((resolve) => setTimeout(resolve, duration));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = getAuthContext();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...auth.headers, ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string | Array<{ msg?: string }> } | null;
    const message = Array.isArray(detail?.detail) ? detail.detail.map((item) => item.msg).filter(Boolean).join(" ") : detail?.detail;
    throw new Error(message || `La API respondió ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const auth = getAuthContext();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: form,
    cache: "no-store",
    headers: auth.headers,
    signal: AbortSignal.timeout(900_000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(detail?.detail || `La carga respondió ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString("es-CO", { maximumFractionDigits: 1 })} ${units[index]}`;
}

function formatResource(value: string): Dataset["formats"][number] {
  const normalized = value.toLowerCase();
  if (normalized === "csv") return "CSV";
  if (normalized === "tsv") return "TSV";
  if (normalized === "json") return "JSON";
  if (normalized === "ndjson" || normalized === "jsonl") return "NDJSON";
  if (normalized === "geojson") return "GeoJSON";
  return "Parquet";
}

function fieldType(field: BackendField): Dataset["schema"][number]["type"] {
  const type = `${field.logical_type} ${field.physical_type}`.toLowerCase();
  if (type.includes("timestamp") || type.includes("date")) return "timestamp";
  if (type.includes("bool")) return "boolean";
  if (type.includes("int")) return "integer";
  if (type.includes("float") || type.includes("double") || type.includes("decimal")) return "number";
  if (type.includes("struct") || type.includes("json")) return "object";
  return "string";
}

function semanticType(value: string | null): Dataset["schema"][number]["semantic"] {
  if (!value) return undefined;
  const hint = value.toLowerCase();
  if (hint === "observed_at" || hint.includes("time") || hint.includes("date")) return "time";
  if (hint.includes("latitude")) return "latitude";
  if (hint.includes("longitude")) return "longitude";
  if (hint.includes("sensor")) return "sensor";
  if (hint.includes("measure") || hint.includes("variable")) return "measure";
  return undefined;
}

function locationFrom(coverage: BackendSpatialCoverage | null, fallback = "Cobertura declarada"): Dataset["location"] {
  if (coverage?.centroid_latitude == null || coverage.centroid_longitude == null) return undefined;
  return {
    name: fallback,
    latitude: coverage.centroid_latitude,
    longitude: coverage.centroid_longitude,
    precision: coverage.precision_reduced ? "aproximada" : "exacta",
  };
}

function emptyDataset(summary: BackendDatasetSummary): Dataset {
  const date = summary.published_at?.slice(0, 10) ?? "1970-01-01";
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    description: summary.description,
    organization: summary.owner_subject,
    author: summary.owner_subject,
    sensorType: summary.topic || "Sensor IoT",
    variable: summary.variables?.[0] || summary.topic || "Variable sin mapear",
    topic: summary.topic || "Sin tema",
    tags: summary.tags,
    license: summary.license || "Licencia no declarada",
    formats: Array.from(new Set(summary.formats.map(formatResource))),
    rows: summary.row_count,
    size: formatBytes(summary.byte_size),
    downloads: summary.downloads,
    updatedAt: date,
    publishedAt: date,
    version: String(summary.current_version ?? 1),
    apiAvailable: true,
    location: locationFrom(summary.spatial_coverage),
    temporal: {
      start: summary.temporal_coverage?.starts_at?.slice(0, 10) ?? date,
      end: summary.temporal_coverage?.ends_at?.slice(0, 10) ?? date,
      frequency: summary.temporal_coverage?.frequency ?? "No declarada",
    },
    schema: [],
    resources: [],
    activity: [],
    quality: { technical: "Con observaciones", completeness: 0, provenance: "Declarada" },
    status: summary.status,
  };
}

function adaptDataset(summary: BackendDatasetSummary | BackendDatasetDetail): Dataset {
  if (!("versions" in summary)) return emptyDataset(summary);
  const version = summary.versions.find((item) => item.is_current) ?? summary.versions.find((item) => item.number === summary.current_version) ?? summary.versions.at(-1);
  const resources = version?.resources ?? [];
  const fields = resources[0]?.schema_profile?.fields ?? [];
  const mapping = version?.semantic_mappings?.find((item) => item.resource_id === resources[0]?.id);
  const rows = resources.reduce((sum, resource) => sum + (resource.row_count ?? resource.schema_profile?.row_count ?? 0), 0);
  const bytes = resources.reduce((sum, resource) => sum + resource.byte_size, 0);
  const totalCells = rows * Math.max(fields.length, 1);
  const nulls = fields.reduce((sum, field) => sum + field.null_count, 0);
  const base = emptyDataset(summary);
  const date = version?.published_at?.slice(0, 10) ?? base.publishedAt;
  const time = version?.temporal_coverage;
  const measure = fields.find((field) => mapping?.variable_units[field.name] != null)
    ?? fields.find((field) => semanticType(field.semantic_hint) === "measure");
  return {
    ...base,
    variable: measure?.name ?? base.variable,
    formats: Array.from(new Set(resources.map((resource) => formatResource(resource.format)))),
    rows,
    size: formatBytes(bytes),
    updatedAt: date,
    version: String(version?.number ?? summary.current_version ?? 1),
    location: locationFrom(version?.spatial_coverage ?? summary.spatial_coverage),
    temporal: {
      start: time?.starts_at?.slice(0, 10) ?? base.temporal.start,
      end: time?.ends_at?.slice(0, 10) ?? date,
      frequency: time?.frequency ?? "No declarada",
    },
    schema: fields.map((field) => {
      const mappedSemantic = field.name === mapping?.observed_at_field
        ? "time" as const
        : field.name === mapping?.latitude_field
          ? "latitude" as const
          : field.name === mapping?.longitude_field
            ? "longitude" as const
            : field.name === mapping?.sensor_id_field
              ? "sensor" as const
              : mapping?.variable_units[field.name] != null
                ? "measure" as const
                : semanticType(field.semantic_hint);
      return {
        name: field.name,
        type: fieldType(field),
        nullable: field.nullable,
        nullRate: rows ? field.null_count / rows : 0,
        semantic: mappedSemantic,
        unit: mapping?.variable_units[field.name],
        examples: field.examples,
      };
    }),
    resources: resources.map((resource) => ({
      id: resource.id,
      name: resource.original_filename || resource.name,
      format: formatResource(resource.format),
      size: formatBytes(resource.byte_size),
      rows: resource.row_count ?? resource.schema_profile?.row_count ?? 0,
      checksum: `sha256:${resource.checksum_sha256}`,
      status: resource.status === "ready" ? "ready" : resource.status === "quarantined" ? "quarantined" : "processing",
      downloadUrl: `${API_URL}/datasets/${encodeURIComponent(summary.slug)}/resources/${resource.id}/download`,
    })),
    activity: summary.versions.slice().reverse().map((item) => ({
      id: item.id,
      date: item.published_at?.slice(0, 10) ?? date,
      title: `Versión ${item.number} · ${item.status}`,
      detail: item.changelog || "Sin notas de cambio declaradas.",
    })),
    quality: {
      technical: resources.every((resource) => resource.status === "ready") ? "Aprobada" : "Con observaciones",
      completeness: totalCells ? Math.max(0, 100 - (nulls / totalCells) * 100) : 0,
      provenance: resources.every((resource) => Boolean(resource.checksum_sha256)) ? "Verificada por checksum" : "Declarada",
    },
  };
}

function filterDemo(filters: CatalogFilters): Dataset[] {
  const query = filters.q?.trim().toLocaleLowerCase("es") ?? "";
  const variable = filters.variable?.trim().toLocaleLowerCase("es") ?? "";
  const location = filters.location?.trim().toLocaleLowerCase("es") ?? "";
  const now = Date.now();
  const periodCutoff = filters.period === "12m"
    ? now - 365 * 24 * 60 * 60 * 1000
    : now - 3 * 365 * 24 * 60 * 60 * 1000;
  const filtered = demoDatasets.filter((item) => {
    const searchable = `${item.title} ${item.description} ${item.organization} ${item.variable} ${item.sensorType} ${item.tags.join(" ")}`.toLocaleLowerCase("es");
    const variableSearchable = `${item.variable} ${item.schema.map((field) => field.name).join(" ")}`.toLocaleLowerCase("es");
    const locationSearchable = `${item.location?.name ?? ""} ${item.title} ${item.description} ${item.tags.join(" ")}`.toLocaleLowerCase("es");
    const temporalEnd = Date.parse(item.temporal.end);
    const temporalStart = Date.parse(item.temporal.start);
    const matchesPeriod = !filters.period
      || (filters.period === "historic"
        ? temporalStart <= periodCutoff
        : Number.isNaN(temporalEnd) || temporalEnd >= periodCutoff);
    return (
      (!query || searchable.includes(query)) &&
      (!filters.sensor || item.sensorType === filters.sensor) &&
      (!variable || variableSearchable.includes(variable)) &&
      (!filters.format || item.formats.includes(filters.format as Dataset["formats"][number])) &&
      (!filters.license || item.license === filters.license) &&
      (!location || (Boolean(item.location) && locationSearchable.includes(location))) &&
      matchesPeriod &&
      (!filters.mapOnly || Boolean(item.location))
    );
  });

  return filtered.sort((a, b) => {
    if (filters.sort === "downloads") return b.downloads - a.downloads;
    if (filters.sort === "title") return a.title.localeCompare(b.title, "es");
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function catalogParams(filters: CatalogFilters, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.sensor) params.set("sensor", filters.sensor);
  if (filters.variable?.trim()) params.set("variable", filters.variable.trim());
  if (filters.location?.trim()) params.set("location", filters.location.trim());
  if (filters.period) params.set("period", filters.period);
  if (filters.license) params.set("license", filters.license);
  if (filters.format) params.set("format", filters.format.toLowerCase());
  if (filters.mapOnly) params.set("has_location", "true");
  if (filters.sort) params.set("sort", filters.sort);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "50");
  return params.toString();
}

export async function getCatalog(filters: CatalogFilters = {}, cursor?: string): Promise<ApiEnvelope<CatalogResponse>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const payload = await request<BackendDatasetPage>(`/datasets?${catalogParams(filters, cursor)}`);
    const items = payload.items.map(adaptDataset);
    return { data: { items, nextCursor: payload.next_cursor }, meta: { source: "api" } };
  } catch (error) {
    // Never append demo rows to a catalog whose first page came from the real API.
    if (!allowDemoFallback || cursor) throw error;
    await wait();
    const items = filterDemo(filters);
    return { data: { items, nextCursor: null, matchedTotal: items.length }, meta: { source: "demo", notice: demoNotice } };
  }
}

export async function getDataset(slug: string): Promise<ApiEnvelope<Dataset | null>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const payload = await request<BackendDatasetDetail>(`/datasets/${encodeURIComponent(slug)}`);
    return { data: adaptDataset(payload), meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait(120);
    return { data: demoDatasets.find((item) => item.slug === slug) ?? null, meta: { source: "demo", notice: demoNotice } };
  }
}

interface ReadingSelection {
  timeField?: string;
  sensorField?: string;
  measurementField?: string;
  unit?: string;
}

export async function getReadings(slug: string, selection: ReadingSelection = {}): Promise<ApiEnvelope<SensorReading[]>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const selectedColumns = Array.from(new Set([
      selection.timeField,
      selection.sensorField,
      selection.measurementField,
    ].filter((field): field is string => Boolean(field))));
    const payload = selectedColumns.length
      ? await request<BackendQueryResult>(`/datasets/${encodeURIComponent(slug)}/query`, {
          method: "POST",
          body: JSON.stringify({
            columns: selectedColumns,
            limit: 100,
            order_by: selection.timeField,
            descending: false,
          }),
        })
      : await request<BackendQueryResult>(`/datasets/${encodeURIComponent(slug)}/preview?limit=100`);
    const readings = payload.rows.flatMap((row) => {
      const time = (selection.timeField ? row[selection.timeField] : undefined)
        ?? row.observed_at ?? row.timestamp ?? row.time ?? row.date;
      const selectedValue = selection.measurementField ? row[selection.measurementField] : undefined;
      const value = typeof selectedValue === "number"
        ? selectedValue
        : typeof row.value === "number"
          ? row.value
          : Object.entries(row).find(([field, item]) => (
              typeof item === "number" && !["latitude", "longitude", "lat", "lon", "lng"].includes(field.toLowerCase())
            ))?.[1];
      if (typeof time !== "string" || Number.isNaN(Date.parse(time)) || typeof value !== "number") return [];
      const selectedStation = selection.sensorField ? row[selection.sensorField] : undefined;
      return [{
        observedAt: time,
        value,
        unit: selection.unit ?? (typeof row.unit === "string" ? row.unit : ""),
        station: typeof selectedStation === "string"
          ? selectedStation
          : typeof row.sensor_id === "string" ? row.sensor_id : "Sin identificador",
      }];
    });
    readings.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    return { data: readings, meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait(120);
    return { data: demoReadings, meta: { source: "demo", notice: demoNotice } };
  }
}

export async function getDatasetPoints(slug: string): Promise<ApiEnvelope<DatasetPoint[]>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const payload = await request<{ type: "FeatureCollection"; features: Array<{ geometry: { type: "Point"; coordinates: [number, number] }; properties?: { resource_id?: string; sensor_id?: string; observed_at?: string } }> }>(`/datasets/${encodeURIComponent(slug)}/points?limit=1000`);
    return {
      data: payload.features.map((feature, index) => ({
        id: `${feature.properties?.resource_id ?? "point"}-${index}`,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        sensorId: feature.properties?.sensor_id,
        observedAt: feature.properties?.observed_at,
      })),
      meta: { source: "api" },
    };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    const dataset = demoDatasets.find((item) => item.slug === slug);
    if (!dataset?.location) return { data: [], meta: { source: "demo", notice: demoNotice } };
    const offsets = [[0, 0], [.018, -.015], [-.012, .021], [.027, .014], [-.023, -.011]];
    return {
      data: offsets.map(([latitude, longitude], index) => ({ id: `demo-point-${index}`, latitude: dataset.location!.latitude + latitude, longitude: dataset.location!.longitude + longitude, sensorId: `DEMO-${String(index + 1).padStart(2, "0")}` })),
      meta: { source: "demo", notice: "Puntos de captura ilustrativos; no representan estaciones reales." },
    };
  }
}

export interface RemoteDraft {
  id: string;
  slug: string;
  status: "draft" | "uploading";
  versionId: string;
  resourceId: string;
  jobId: string;
}

export interface JobStatusView {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  progress: number;
  error?: string;
}

export async function createDraft({ payload, file }: { payload: DraftPayload; file: File }): Promise<ApiEnvelope<RemoteDraft>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const createPayload = {
      title: payload.title,
      description: payload.description,
      topic: payload.topic || null,
      tags: payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      license: payload.license || null,
    };
    const result = await request<BackendDatasetDetail>("/datasets", { method: "POST", body: JSON.stringify(createPayload) });
    const version = result.versions.find((item) => item.number === result.current_version) ?? result.versions.at(-1);
    if (!version) throw new Error("La API creó el dataset sin una versión editable.");
    const form = new FormData();
    form.append("file", file, file.name);
    const uploaded = await requestForm<{ resource?: { id?: string }; job?: { id?: string } }>(`/datasets/${result.id}/versions/${version.id}/resources`, form);
    if (!uploaded.resource?.id || !uploaded.job?.id) throw new Error("La API no devolvió los identificadores del recurso y el trabajo.");
    return { data: { id: result.id, slug: result.slug, status: "uploading", versionId: version.id, resourceId: uploaded.resource.id, jobId: uploaded.job.id }, meta: { source: "api", notice: "Archivo recibido. El worker verifica seguridad, infiere el esquema y genera Parquet en segundo plano." } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait(650);
    return { data: { id: "draft-demo-001", slug: "borrador-demostrativo", status: "uploading", versionId: "version-demo-001", resourceId: "resource-demo-001", jobId: "job-demo-001" }, meta: { source: "demo", notice: `Carga ilustrativa de ${file.name}: no se envió ningún archivo a un servidor.` } };
  }
}

export async function getJob(jobId: string): Promise<ApiEnvelope<JobStatusView>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const job = await request<{ id: string; status: JobStatusView["status"]; progress: number; error_message?: string | null }>(`/jobs/${jobId}`);
    return { data: { id: job.id, status: job.status, progress: job.progress, error: job.error_message ?? undefined }, meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait(500);
    return { data: { id: jobId, status: "succeeded", progress: 100 }, meta: { source: "demo", notice: demoNotice } };
  }
}

export async function getManagedDraft(datasetId: string): Promise<ApiEnvelope<{ dataset: Dataset; versionId: string; resourceId: string }>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const result = await request<BackendDatasetDetail>(`/datasets/${datasetId}/manage`);
    const version = result.versions.find((item) => item.number === result.current_version) ?? result.versions.at(-1);
    const resource = version?.resources[0];
    if (!version || !resource) throw new Error("El borrador aún no expone un recurso procesado.");
    return { data: { dataset: adaptDataset(result), versionId: version.id, resourceId: resource.id }, meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    const dataset = demoDatasets[0];
    return { data: { dataset, versionId: "version-demo-001", resourceId: "resource-demo-001" }, meta: { source: "demo", notice: demoNotice } };
  }
}

export async function publishDraft({ remote, payload }: { remote: RemoteDraft; payload: DraftPayload }): Promise<ApiEnvelope<{ id: string; slug: string; status: string }>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    await request<void>(`/datasets/${remote.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: payload.title, description: payload.description, topic: payload.topic, license: payload.license, tags: payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }),
    });
    const hasCoordinates = Boolean(payload.latitudeField && payload.longitudeField);
    if (payload.timeField || hasCoordinates) {
      await request<void>(`/datasets/${remote.id}/versions/${remote.versionId}/mapping`, {
        method: "PUT",
        body: JSON.stringify({
          resource_id: remote.resourceId,
          observed_at_field: payload.timeField || null,
          latitude_field: hasCoordinates ? payload.latitudeField : null,
          longitude_field: hasCoordinates ? payload.longitudeField : null,
          sensor_id_field: null,
          variable_units: {},
          crs: "EPSG:4326",
        }),
      });
    }
    const published = await request<BackendDatasetDetail>(`/datasets/${remote.id}/versions/${remote.versionId}/publish`, { method: "POST" });
    return { data: { id: published.id, slug: published.slug, status: published.status }, meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait(650);
    return { data: { id: remote.id, slug: remote.slug, status: "published" }, meta: { source: "demo", notice: "Publicación ilustrativa: el dataset sólo existe en esta sesión de demostración." } };
  }
}

export async function getMyDatasets(): Promise<ApiEnvelope<Dataset[]>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const payload = await request<BackendDatasetDetail[]>("/me/datasets");
    return { data: payload.map(adaptDataset), meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait();
    return { data: demoDatasets.slice(0, 3), meta: { source: "demo", notice: demoNotice } };
  }
}

export async function getModerationQueue(): Promise<ApiEnvelope<ModerationItem[]>> {
  try {
    if (!configuredApiUrl && allowDemoFallback) throw new Error("demo");
    const payload = await request<Array<{ id: string; dataset_title: string; dataset_owner: string; reason: string; details: string; status: string; created_at: string }>>("/admin/reports");
    const statusLabel = (status: string): ModerationItem["status"] => status === "resolved" || status === "closed" ? "Revisado" : status === "quarantined" ? "En cuarentena" : "Pendiente";
    return { data: payload.map((item) => ({ id: item.id, dataset: item.dataset_title, owner: item.dataset_owner, reason: item.details ? `${item.reason}: ${item.details}` : item.reason, status: statusLabel(item.status), reportedAt: item.created_at })), meta: { source: "api" } };
  } catch (error) {
    if (!allowDemoFallback) throw error;
    await wait();
    return { data: demoModeration, meta: { source: "demo", notice: demoNotice } };
  }
}
