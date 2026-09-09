export type DataSource = "api" | "demo";

export interface ApiMeta {
  source: DataSource;
  notice?: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface Coordinates {
  name: string;
  latitude: number;
  longitude: number;
  precision?: "exacta" | "aproximada";
}

export interface TemporalCoverage {
  start: string;
  end: string;
  frequency: string;
}

export interface SchemaField {
  name: string;
  type: "timestamp" | "string" | "integer" | "number" | "boolean" | "geometry" | "object";
  nullable: boolean;
  nullRate: number;
  semantic?: "time" | "latitude" | "longitude" | "sensor" | "measure";
  unit?: string;
  examples: Array<string | number | boolean>;
}

export interface DatasetResource {
  id: string;
  name: string;
  format: "CSV" | "TSV" | "JSON" | "NDJSON" | "Parquet" | "GeoJSON";
  size: string;
  rows: number;
  checksum: string;
  status: "ready" | "processing" | "quarantined";
  downloadUrl?: string;
}

export interface DatasetActivity {
  id: string;
  date: string;
  title: string;
  detail: string;
}

export interface Dataset {
  id: string;
  slug: string;
  title: string;
  description: string;
  organization: string;
  author: string;
  sensorType: string;
  variable: string;
  topic: string;
  tags: string[];
  license: string;
  formats: DatasetResource["format"][];
  rows: number;
  size: string;
  downloads: number;
  updatedAt: string;
  publishedAt: string;
  version: string;
  apiAvailable: boolean;
  location?: Coordinates;
  temporal: TemporalCoverage;
  schema: SchemaField[];
  resources: DatasetResource[];
  activity: DatasetActivity[];
  quality: {
    technical: "Aprobada" | "Con observaciones";
    completeness: number;
    provenance: "Declarada" | "Verificada por checksum";
  };
  illustrative?: boolean;
  status: "draft" | "uploading" | "processing" | "needs_mapping" | "ready" | "published" | "quarantined" | "failed" | "archived" | string;
}

export interface CatalogResponse {
  items: Dataset[];
  nextCursor: string | null;
  matchedTotal?: number;
}

export interface SensorReading {
  observedAt: string;
  value: number;
  unit: string;
  station: string;
}

export interface DatasetPoint {
  id: string;
  latitude: number;
  longitude: number;
  sensorId?: string;
  observedAt?: string;
}

export interface CatalogFilters {
  q?: string;
  sensor?: string;
  variable?: string;
  format?: string;
  license?: string;
  location?: string;
  period?: string;
  mapOnly?: boolean;
  sort?: "recent" | "downloads" | "title";
}

export interface DraftPayload {
  title: string;
  description: string;
  topic: string;
  tags: string;
  license: string;
  resourceName: string;
  resourceFormat: string;
  timeField: string;
  sensorField: string;
  measureField: string;
  latitudeField: string;
  longitudeField: string;
}

export interface ModerationItem {
  id: string;
  datasetId: string;
  dataset: string;
  owner: string;
  reporter?: string;
  reason: string;
  details?: string;
  state: "open" | "reviewing" | "resolved" | "dismissed" | "quarantined";
  status: "Pendiente" | "En cuarentena" | "Revisado";
  reportedAt: string;
}
