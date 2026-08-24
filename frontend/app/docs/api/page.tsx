import type { Metadata } from "next";
import { ArrowRight, Braces, CheckCircle2, KeyRound, RadioTower } from "lucide-react";
import Link from "next/link";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = { title: "Documentación API" };

const readExample = `curl -sS "http://localhost:8000/api/v1/datasets?q=ruido&format=parquet" -H "Accept: application/json"`;
const ingestExample = `curl -X POST "http://localhost:8000/api/v1/datasets/{dataset_id}/records:batch" \\
  -H "Authorization: Bearer $OPENIOTDATA_TOKEN" \\
  -H "Idempotency-Key: batch-2026-08-23-001" \\
  -H "Content-Type: application/json" \\
  -d '{"records":[{"observed_at":"2026-08-23T15:00:00Z",\
       "sensor_id":"SEN-014","data":{"leq":64.2},\
       "location":{"type":"Point","coordinates":[-74.07,4.71]}}]}'`;

export default function ApiDocsPage() {
  return (
    <main className="docs-layout" id="main-content">
      <aside className="docs-sidebar">
        <strong>API v1</strong>
        <nav aria-label="En esta página"><a href="#inicio">Inicio rápido</a><a href="#catalogo">Catálogo</a><a href="#ingesta">Ingesta</a><a href="#errores">Errores</a><a href="#licencias">Licencias</a><a href="#soporte">Soporte</a></nav>
      </aside>
      <article className="docs-content">
        <header id="inicio"><h1>API de OpenIoTData</h1><p>Consulta metadatos públicos y añade observaciones a tus datasets mediante contratos explícitos, paginación por cursor e idempotencia.</p><div className="docs-status"><CheckCircle2 aria-hidden="true" size={18} /> Contrato de referencia para desarrollo local · <code>v1</code></div></header>
        <section><h2>Inicio rápido</h2><p>La lectura pública no requiere credenciales. La URL base local es <code>http://localhost:8000/api/v1</code>.</p><CodeBlock code={readExample} /></section>
        <section id="catalogo"><h2>Explorar el catálogo</h2><Endpoint method="GET" path="/datasets" description="Busca publicaciones y filtra por tema, licencia, formato o presencia de ubicación." /><div className="parameter-table-wrap"><table><thead><tr><th scope="col">Parámetro</th><th scope="col">Tipo</th><th scope="col">Uso</th></tr></thead><tbody><tr><td><code>q</code></td><td>string</td><td>Texto en título y descripción.</td></tr><tr><td><code>format</code></td><td>string</td><td>CSV, Parquet, GeoJSON u otro formato soportado.</td></tr><tr><td><code>has_location</code></td><td>boolean</td><td>Limita resultados con cobertura espacial declarada.</td></tr><tr><td><code>cursor</code></td><td>string</td><td>Cursor opaco recibido en <code>next_cursor</code>.</td></tr></tbody></table></div><p>Para recorte geográfico usa <code>GET /map/datasets?bbox=west,south,east,north</code>.</p></section>
        <section id="ingesta"><h2>Ingesta por lotes</h2><div className="docs-callout"><KeyRound aria-hidden="true" size={20} /><p>Los tokens son revocables y se limitan a un dataset. No los incluyas en frontend ni repositorios.</p></div><Endpoint method="POST" path="/datasets/{dataset_id}/records:batch" description="Añade hasta 10.000 observaciones o 10 MiB por solicitud." /><CodeBlock code={ingestExample} /><h3>Contrato mínimo por observación</h3><ul className="docs-contract"><li><Braces aria-hidden="true" /><span><code>observed_at</code><small>Timestamp ISO 8601 obligatorio.</small></span></li><li><RadioTower aria-hidden="true" /><span><code>data</code><small>Objeto JSON de propiedades libres.</small></span></li><li><KeyRound aria-hidden="true" /><span><code>Idempotency-Key</code><small>Evita duplicados al reintentar el lote.</small></span></li></ul></section>
        <section id="errores"><h2>Errores y recuperación</h2><p>Los errores FastAPI incluyen una propiedad <code>detail</code>; la validación puede devolver una lista de campos. Un lote aceptado responde <code>202</code> y expone el estado del trabajo.</p><div className="status-list"><span><strong>400</strong> Contrato inválido</span><span><strong>401</strong> Token ausente o vencido</span><span><strong>413</strong> Lote demasiado grande</span><span><strong>422</strong> Observaciones incompatibles</span><span><strong>429</strong> Límite temporal alcanzado</span></div></section>
        <section id="licencias"><h2>Licencias</h2><p>Las respuestas de catálogo incluyen la licencia declarada por versión. La API no cambia las obligaciones de atribución o compartir-igual.</p></section>
        <section id="soporte"><h2>¿Necesitas ayuda?</h2><p>Incluye el identificador del trabajo y la hora UTC; nunca compartas un token completo.</p><Link href="/datasets" className="text-link">Ver datasets de ejemplo <ArrowRight aria-hidden="true" size={16} /></Link></section>
      </article>
    </main>
  );
}

function Endpoint({ method, path, description }: { method: "GET" | "POST"; path: string; description: string }) { return <div className="endpoint-doc"><div><span>{method}</span><code>{path}</code></div><p>{description}</p></div>; }
