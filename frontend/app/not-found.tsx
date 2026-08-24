import { Database } from "lucide-react";
import Link from "next/link";
export default function NotFound() { return <main className="page-shell not-found-state" id="main-content"><Database aria-hidden="true" size={42} /><h1>Página no encontrada</h1><p>La ruta no existe o el recurso fue archivado.</p><Link href="/datasets" className="button button--primary">Explorar datasets</Link></main>; }
