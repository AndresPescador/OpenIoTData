import type { Dataset, ModerationItem, SensorReading } from "@/lib/types";

const downloadCsv = (title: string) =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(`observed_at,sensor_id,value,unit\n2026-08-20T10:00:00Z,DEMO-01,42.7,illustrative\n# ${title}`)}`;

const commonSchema = (unit: string): Dataset["schema"] => [
  {
    name: "observed_at",
    type: "timestamp",
    nullable: false,
    nullRate: 0,
    semantic: "time",
    examples: ["2026-08-20T10:00:00Z"],
  },
  {
    name: "sensor_id",
    type: "string",
    nullable: false,
    nullRate: 0,
    semantic: "sensor",
    examples: ["SEN-BOG-014"],
  },
  {
    name: "value",
    type: "number",
    nullable: true,
    nullRate: 0.012,
    semantic: "measure",
    unit,
    examples: [42.7, 39.1],
  },
  {
    name: "latitude",
    type: "number",
    nullable: false,
    nullRate: 0,
    semantic: "latitude",
    examples: [4.711],
  },
  {
    name: "longitude",
    type: "number",
    nullable: false,
    nullRate: 0,
    semantic: "longitude",
    examples: [-74.0721],
  },
];

function dataset(
  values: Pick<
    Dataset,
    | "id"
    | "slug"
    | "title"
    | "description"
    | "organization"
    | "sensorType"
    | "variable"
    | "topic"
    | "license"
    | "formats"
    | "rows"
    | "size"
    | "downloads"
    | "updatedAt"
    | "publishedAt"
    | "location"
  > & { unit: string },
): Dataset {
  return {
    ...values,
    author: "Equipo de datos abiertos",
    tags: [values.sensorType.toLowerCase(), values.variable.toLowerCase(), "Colombia"],
    version: "1.2.0",
    apiAvailable: true,
    temporal: { start: "2024-05-01", end: "2026-08-20", frequency: "Cada 15 minutos" },
    schema: commonSchema(values.unit),
    resources: values.formats.map((format, index) => ({
      id: `${values.id}-r${index + 1}`,
      name: `${values.slug}.${format.toLowerCase()}`,
      format,
      size: values.size,
      rows: values.rows,
      checksum: `sha256:${values.id.repeat(12).slice(0, 48)}`,
      status: "ready",
      downloadUrl: downloadCsv(values.title),
    })),
    activity: [
      { id: `${values.id}-a1`, date: values.updatedAt, title: "Versión 1.2.0 publicada", detail: "Se incorporó el último lote normalizado y se recalculó el perfil de esquema." },
      { id: `${values.id}-a2`, date: values.publishedAt, title: "Dataset publicado", detail: "La licencia y la procedencia fueron declaradas por la organización publicadora." },
    ],
    quality: { technical: "Aprobada", completeness: 98.8, provenance: "Verificada por checksum" },
    illustrative: true,
    status: "published",
  };
}

export const demoDatasets: Dataset[] = [
  dataset({
    id: "01",
    slug: "calidad-aire-red-monica-bogota",
    title: "Calidad del aire — Red Mónica Bogotá",
    description: "Mediciones ilustrativas de material particulado y gases en estaciones urbanas de Bogotá. La publicación demuestra esquema inferido, cobertura temporal y consulta geográfica.",
    organization: "Laboratorio urbano demostrativo",
    sensorType: "Calidad del aire",
    variable: "PM2.5",
    topic: "Ambiente",
    license: "CC BY 4.0",
    formats: ["CSV", "Parquet"],
    rows: 1248532,
    size: "184 MB",
    downloads: 2812,
    updatedAt: "2026-08-20",
    publishedAt: "2025-01-14",
    unit: "µg/m³",
    location: { name: "Bogotá D.C.", latitude: 4.711, longitude: -74.0721, precision: "aproximada" },
  }),
  dataset({
    id: "02",
    slug: "ruido-ambiental-puntos-estrategicos",
    title: "Ruido ambiental — Puntos estratégicos",
    description: "Niveles equivalentes de presión sonora para explorar patrones horarios en corredores viales y zonas mixtas.",
    organization: "Red acústica de referencia",
    sensorType: "Ruido",
    variable: "LAeq",
    topic: "Sonido ambiental",
    license: "CC BY 4.0",
    formats: ["Parquet", "CSV"],
    rows: 856014,
    size: "96 MB",
    downloads: 1978,
    updatedAt: "2026-08-19",
    publishedAt: "2025-03-22",
    unit: "dB(A)",
    location: { name: "Bogotá D.C.", latitude: 4.6486, longitude: -74.107, precision: "exacta" },
  }),
  dataset({
    id: "03",
    slug: "clima-meteorologia-red-andina",
    title: "Clima y meteorología — Red andina",
    description: "Temperatura, precipitación, presión y viento de estaciones ilustrativas en la cordillera oriental.",
    organization: "Observatorio climático abierto",
    sensorType: "Meteorología",
    variable: "Temperatura",
    topic: "Clima",
    license: "CC0 1.0",
    formats: ["CSV"],
    rows: 2104773,
    size: "302 MB",
    downloads: 3340,
    updatedAt: "2026-08-18",
    publishedAt: "2024-11-05",
    unit: "°C",
    location: { name: "Tunja, Boyacá", latitude: 5.5353, longitude: -73.3678, precision: "aproximada" },
  }),
  dataset({
    id: "04",
    slug: "consumo-energetico-edificios-publicos",
    title: "Consumo energético — Edificios públicos",
    description: "Lecturas agregadas de energía activa para estudiar demanda, estacionalidad y eficiencia operacional.",
    organization: "Secretaría demostrativa de energía",
    sensorType: "Energía",
    variable: "Consumo activo",
    topic: "Infraestructura",
    license: "ODC BY 1.0",
    formats: ["Parquet"],
    rows: 964311,
    size: "88 MB",
    downloads: 1175,
    updatedAt: "2026-08-17",
    publishedAt: "2025-06-10",
    unit: "kWh",
    location: { name: "Medellín, Antioquia", latitude: 6.2442, longitude: -75.5812, precision: "aproximada" },
  }),
  dataset({
    id: "05",
    slug: "niveles-agua-quebrada-el-virrey",
    title: "Niveles de agua — Quebrada El Virrey",
    description: "Registros de nivel y lluvia para ejercicios de observación comunitaria de cauces urbanos.",
    organization: "Colectivo hidrológico abierto",
    sensorType: "Nivel de agua",
    variable: "Altura",
    topic: "Agua",
    license: "ODbL 1.0",
    formats: ["CSV", "GeoJSON"],
    rows: 312908,
    size: "41 MB",
    downloads: 864,
    updatedAt: "2026-08-16",
    publishedAt: "2025-08-02",
    unit: "cm",
    location: { name: "Bogotá D.C.", latitude: 4.6685, longitude: -74.0558, precision: "exacta" },
  }),
  dataset({
    id: "06",
    slug: "humedad-suelo-cultivos-sabana",
    title: "Humedad de suelo — Cultivos de la Sabana",
    description: "Serie ilustrativa de humedad volumétrica en parcelas experimentales, con ubicación generalizada por privacidad.",
    organization: "Red agroclimática comunitaria",
    sensorType: "Humedad",
    variable: "Humedad del suelo",
    topic: "Agricultura",
    license: "CC BY 4.0",
    formats: ["NDJSON", "Parquet"],
    rows: 538210,
    size: "71 MB",
    downloads: 1432,
    updatedAt: "2026-08-15",
    publishedAt: "2025-04-18",
    unit: "% VWC",
    location: { name: "Sabana de Bogotá", latitude: 4.931, longitude: -74.03, precision: "aproximada" },
  }),
  dataset({
    id: "07",
    slug: "ocupacion-bicicleteros-universitarios",
    title: "Ocupación de bicicleteros universitarios",
    description: "Conteos agregados de disponibilidad para analizar movilidad activa sin identificar personas.",
    organization: "Campus abierto de referencia",
    sensorType: "Conteo",
    variable: "Cupos ocupados",
    topic: "Movilidad",
    license: "CC0 1.0",
    formats: ["JSON"],
    rows: 188540,
    size: "28 MB",
    downloads: 655,
    updatedAt: "2026-08-14",
    publishedAt: "2025-09-30",
    unit: "cupos",
    location: { name: "Cali, Valle del Cauca", latitude: 3.4516, longitude: -76.532, precision: "aproximada" },
  }),
  dataset({
    id: "08",
    slug: "calidad-agua-acueductos-comunitarios",
    title: "Calidad de agua — Acueductos comunitarios",
    description: "Lecturas multiparámetro de pH, conductividad y turbidez declaradas por redes comunitarias.",
    organization: "Mesa abierta del agua",
    sensorType: "Calidad de agua",
    variable: "Turbidez",
    topic: "Agua",
    license: "CC BY 4.0",
    formats: ["CSV", "GeoJSON"],
    rows: 92450,
    size: "18 MB",
    downloads: 918,
    updatedAt: "2026-08-12",
    publishedAt: "2026-01-16",
    unit: "NTU",
    location: { name: "Pereira, Risaralda", latitude: 4.8143, longitude: -75.6946, precision: "aproximada" },
  }),
];

export const demoReadings: SensorReading[] = [
  { observedAt: "2026-08-20T06:00:00Z", value: 31.4, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T07:00:00Z", value: 38.9, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T08:00:00Z", value: 45.2, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T09:00:00Z", value: 42.7, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T10:00:00Z", value: 36.1, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T11:00:00Z", value: 33.8, unit: "µg/m³", station: "SEN-BOG-014" },
  { observedAt: "2026-08-20T12:00:00Z", value: 29.6, unit: "µg/m³", station: "SEN-BOG-014" },
];

export const demoModeration: ModerationItem[] = [
  { id: "M-104", datasetId: "demo-aforo", dataset: "Sensores de aforo peatonal", owner: "Laboratorio ciudadano", reason: "Privacidad", details: "Revisar posible identificador personal", state: "open", status: "Pendiente", reportedAt: "2026-08-23 14:10" },
  { id: "M-103", datasetId: "demo-clima", dataset: "Estaciones meteorológicas escolares", owner: "Aula abierta", reason: "Formato", details: "Archivo no coincide con el formato declarado", state: "quarantined", status: "En cuarentena", reportedAt: "2026-08-22 09:42" },
  { id: "M-102", datasetId: "demo-ruido", dataset: "Ruido de corredores viales", owner: "Nodo acústico", reason: "Ubicación sensible", details: "Coordenada sensible reportada", state: "resolved", status: "Revisado", reportedAt: "2026-08-21 18:07" },
];
