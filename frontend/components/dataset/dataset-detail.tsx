"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Braces, CalendarDays, CheckCircle2, ChevronRight, Clipboard, Code2, Database, Download, ExternalLink, FileArchive, Files, Map, MapPin, ShieldCheck, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DataChart } from "@/components/dataset/data-chart";
import { SensorMap } from "@/components/map/sensor-map";
import { DemoNotice } from "@/components/shared/demo-notice";
import { ErrorState, LoadingState } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDataset, getDatasetPoints, getReadings } from "@/lib/api";
import type { Dataset } from "@/lib/types";
import { cn, formatDate, formatNumber } from "@/lib/utils";

const tabs = [
  { id: "summary", label: "Resumen", icon: Database },
  { id: "data", label: "Datos", icon: Table2 },
  { id: "map", label: "Mapa", icon: Map },
  { id: "files", label: "Archivos", icon: Files },
  { id: "api", label: "API", icon: Code2 },
  { id: "activity", label: "Actividad", icon: Activity },
] as const;

type TabId = (typeof tabs)[number]["id"];

function Summary({ dataset }: { dataset: Dataset }) {
  return (
    <div className="dataset-summary-grid">
      <div className="summary-main">
        <section className="detail-section">
          <h2>Acerca de este dataset</h2>
          <p className="lead-copy">{dataset.description}</p>
          <div className="tag-list" aria-label="Etiquetas">{dataset.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
        </section>

        <section className="detail-section">
          <div className="section-heading"><div><h2>Esquema inferido</h2><p>Tipos detectados en la versión {dataset.version}. El publicador puede corregir el mapeo semántico.</p></div><Badge>{dataset.schema.length} campos</Badge></div>
          <div className="schema-table-wrap">
            <table className="schema-table">
              <thead><tr><th scope="col">Campo</th><th scope="col">Tipo</th><th scope="col">Semántica</th><th scope="col">Unidad</th><th scope="col">Nulos</th></tr></thead>
              <tbody>{dataset.schema.map((field) => <tr key={field.name}><td><code>{field.name}</code></td><td>{field.type}</td><td>{field.semantic ?? "Sin mapear"}</td><td>{field.unit ?? "—"}</td><td className="tabular">{(field.nullRate * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}%</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="summary-facts" aria-label="Ficha técnica">
        <h2>Ficha técnica</h2>
        <dl>
          <div><dt><CalendarDays aria-hidden="true" size={17} /> Cobertura</dt><dd>{formatDate(dataset.temporal.start)} — {formatDate(dataset.temporal.end)}<span>{dataset.temporal.frequency}</span></dd></div>
          <div><dt><MapPin aria-hidden="true" size={17} /> Ubicación</dt><dd>{dataset.location?.name ?? "No declarada"}<span>{dataset.location ? `${dataset.location.latitude.toFixed(4)}, ${dataset.location.longitude.toFixed(4)}` : "Sin coordenadas"}</span></dd></div>
          <div><dt><Braces aria-hidden="true" size={17} /> Volumen</dt><dd>{formatNumber(dataset.rows)} filas<span>{dataset.size}</span></dd></div>
          <div><dt><ShieldCheck aria-hidden="true" size={17} /> Calidad técnica</dt><dd>{dataset.quality.technical}<span>{dataset.quality.completeness.toLocaleString("es-CO")}% de completitud</span></dd></div>
        </dl>
        <p className="quality-note"><CheckCircle2 aria-hidden="true" size={18} /> Integridad del archivo verificada por checksum. La plataforma no certifica validez científica.</p>
      </aside>
    </div>
  );
}

function DataPreview({ dataset }: { dataset: Dataset }) {
  const timeField = dataset.schema.find((field) => field.semantic === "time")?.name;
  const sensorField = dataset.schema.find((field) => field.semantic === "sensor")?.name;
  const measure = dataset.schema.find((field) => field.semantic === "measure");
  const readings = useQuery({
    queryKey: ["readings", dataset.slug, timeField, sensorField, measure?.name],
    queryFn: () => getReadings(dataset.slug, {
      timeField,
      sensorField,
      measurementField: measure?.name,
      unit: measure?.unit,
    }),
  });
  if (readings.isLoading) return <LoadingState label="Leyendo la vista previa" />;
  if (readings.isError) return <ErrorState retry={() => readings.refetch()} />;
  return <><DemoNotice notice={readings.data?.meta.notice} compact /><DataChart readings={readings.data?.data ?? []} title={`${dataset.variable} a lo largo del tiempo`} /></>;
}

function DatasetMap({ dataset }: { dataset: Dataset }) {
  const points = useQuery({ queryKey: ["dataset-points", dataset.slug], queryFn: () => getDatasetPoints(dataset.slug) });
  if (points.isLoading) return <LoadingState label="Localizando puntos de captura" />;
  const mapped = (points.data?.data ?? []).map((point) => ({
    ...dataset,
    id: point.id,
    title: point.sensorId ? `${dataset.title} · ${point.sensorId}` : dataset.title,
    location: { name: point.sensorId || "Punto de captura", latitude: point.latitude, longitude: point.longitude, precision: "exacta" as const },
  }));
  const visible = mapped.length ? mapped : dataset.location ? [dataset] : [];
  return (
    <>
      <div className="map-tab-heading"><div><h2>{mapped.length ? "Puntos de captura" : "Cobertura espacial declarada"}</h2><p>{mapped.length ? `${mapped.length.toLocaleString("es-CO")} puntos devueltos por la versión actual` : "No hay coordenadas por registro; se muestra el centroide del dataset."}</p></div><p>EPSG:4326 · precisión {dataset.location?.precision ?? "no especificada"}</p></div>
      {points.isError ? <div className="inline-warning" role="status">No fue posible consultar puntos por registro; se usa la cobertura general.</div> : null}
      <DemoNotice notice={points.data?.meta.notice} compact />
      <SensorMap datasets={visible} tall />
    </>
  );
}

function FilesTab({ dataset }: { dataset: Dataset }) {
  return (
    <section className="detail-section">
      <div className="section-heading"><div><h2>Recursos de la versión {dataset.version}</h2><p>Los originales se preservan y cada checksum permite comprobar su integridad.</p></div></div>
      <div className="resource-list">
        {dataset.resources.map((resource) => (
          <article key={resource.id}>
            <FileArchive aria-hidden="true" size={24} />
            <div><h3>{resource.name}</h3><p>{resource.format} · {resource.size} · {formatNumber(resource.rows)} filas</p><code>{resource.checksum}</code></div>
            <Badge>{resource.status === "ready" ? "Listo" : resource.status}</Badge>
            {resource.downloadUrl ? <a href={resource.downloadUrl} download={resource.name} className="button button--secondary button--small"><Download aria-hidden="true" size={16} /> Descargar</a> : <span className="button button--secondary button--small" aria-disabled="true">No disponible</span>}
          </article>
        ))}
      </div>
    </section>
  );
}

function ApiTab({ dataset }: { dataset: Dataset }) {
  const [copied, setCopied] = useState(false);
  const previewExample = `curl -sS "${typeof window === "undefined" ? "https://openiotdata.example" : window.location.origin}/api/v1/datasets/${dataset.slug}/preview?limit=100" -H "Accept: application/json"`;
  const copy = async () => {
    await navigator.clipboard.writeText(previewExample);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <section className="detail-section api-reference">
      <h2>Consultar esta versión por API</h2>
      <p>La lectura pública no requiere token. Las cargas sí usan un token limitado al dataset y una clave de idempotencia.</p>
      <div className="endpoint-line"><span>GET</span><code>/api/v1/datasets/{dataset.slug}/preview</code></div>
      <div className="code-sample"><Button variant="quiet" size="small" onClick={copy}><Clipboard aria-hidden="true" size={16} /> {copied ? "Copiado" : "Copiar"}</Button><pre><code>{previewExample}</code></pre></div>
      <Link href="/docs/api" className="text-link">Abrir documentación completa <ExternalLink aria-hidden="true" size={15} /></Link>
    </section>
  );
}

export function DatasetDetail({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = tabs.some((tab) => tab.id === requestedTab) ? requestedTab! : "summary";
  const query = useQuery({ queryKey: ["dataset", slug], queryFn: () => getDataset(slug) });

  if (query.isLoading) return <main className="page-shell"><LoadingState label="Abriendo la versión publicada" /></main>;
  if (query.isError) return <main className="page-shell"><ErrorState retry={() => query.refetch()} /></main>;
  if (!query.data?.data) return <main className="page-shell not-found-state"><Database aria-hidden="true" size={42} /><h1>Dataset no encontrado</h1><p>La dirección puede haber cambiado o la publicación fue archivada.</p><Link className="button button--primary" href="/datasets">Volver al catálogo</Link></main>;

  const dataset = query.data.data;
  const firstResource = dataset.resources[0];
  const selectTab = (tab: TabId) => {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "summary") next.delete("tab"); else next.set("tab", tab);
    router.replace(`/datasets/${slug}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <main className="dataset-detail" id="main-content">
      <div className="detail-breadcrumb"><Link href="/datasets">Datasets</Link><ChevronRight aria-hidden="true" size={14} /><span>{dataset.topic}</span><ChevronRight aria-hidden="true" size={14} /><span aria-current="page">{dataset.title}</span></div>
      <header className="dataset-header">
        <div className="dataset-header__copy">
          <div className="detail-badges"><Badge>{dataset.sensorType}</Badge><Badge>{dataset.license}</Badge><span>v{dataset.version}</span></div>
          <h1>{dataset.title}</h1>
          <p>Publicado por <strong>{dataset.organization}</strong> · Actualizado {formatDate(dataset.updatedAt)}</p>
        </div>
        <div className="dataset-header__actions">
          <span><Download aria-hidden="true" size={15} /> {formatNumber(dataset.downloads)} descargas</span>
          {firstResource?.downloadUrl ? <a href={firstResource.downloadUrl} download={firstResource.name} className="button button--primary"><Download aria-hidden="true" size={18} /> Descargar</a> : <span className="button button--primary" aria-disabled="true"><Download aria-hidden="true" size={18} /> Sin archivo listo</span>}
        </div>
      </header>
      <DemoNotice notice={query.data.meta.notice} compact />

      <nav className="detail-tabs" aria-label="Secciones del dataset">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} type="button" aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => selectTab(tab.id)}><Icon aria-hidden="true" size={17} /> {tab.label}</button>;
        })}
      </nav>

      <div className={cn("detail-content", activeTab === "map" && "detail-content--map")}>
        {activeTab === "summary" ? <Summary dataset={dataset} /> : null}
        {activeTab === "data" ? <DataPreview dataset={dataset} /> : null}
        {activeTab === "map" ? <DatasetMap dataset={dataset} /> : null}
        {activeTab === "files" ? <FilesTab dataset={dataset} /> : null}
        {activeTab === "api" ? <ApiTab dataset={dataset} /> : null}
        {activeTab === "activity" ? <section className="detail-section"><h2>Actividad y procedencia</h2><ol className="activity-list">{dataset.activity.map((item) => <li key={item.id}><time dateTime={item.date}>{formatDate(item.date)}</time><div><h3>{item.title}</h3><p>{item.detail}</p></div></li>)}</ol></section> : null}
      </div>
    </main>
  );
}
