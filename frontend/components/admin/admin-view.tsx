"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, CheckCircle2, Clock3, Eye, ShieldAlert } from "lucide-react";
import { DemoNotice } from "@/components/shared/demo-notice";
import { ErrorState, LoadingState } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModerationQueue } from "@/lib/api";

export function AdminView() {
  const query = useQuery({ queryKey: ["moderation"], queryFn: getModerationQueue });
  return (
    <main className="page-shell admin-page" id="main-content">
      <header className="page-heading"><h1>Moderación y seguridad</h1><p>Cola operacional para reportes, recursos en cuarentena y decisiones auditables.</p></header>
      {query.isLoading ? <LoadingState label="Leyendo la cola de moderación" /> : null}
      {query.isError ? <ErrorState retry={() => query.refetch()} /> : null}
      {query.data ? <DemoNotice notice={query.data.meta.notice} compact /> : null}
      {query.data ? (
        <>
          <section className="admin-summary" aria-label="Estado de moderación">
            <div><Clock3 aria-hidden="true" /><span><strong>{query.data.data.filter((item) => item.status === "Pendiente").length}</strong> pendientes</span></div>
            <div><ShieldAlert aria-hidden="true" /><span><strong>{query.data.data.filter((item) => item.status === "En cuarentena").length}</strong> en cuarentena</span></div>
            <div><CheckCircle2 aria-hidden="true" /><span><strong>{query.data.data.filter((item) => item.status === "Revisado").length}</strong> revisados</span></div>
          </section>
          <section className="moderation-section">
            <div className="section-heading"><div><h2>Reportes recientes</h2><p>Prioriza exposición de datos personales, archivos maliciosos y coordenadas sensibles.</p></div></div>
            <div className="moderation-table-wrap"><table className="moderation-table"><thead><tr><th scope="col">Reporte</th><th scope="col">Dataset</th><th scope="col">Motivo</th><th scope="col">Estado</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead><tbody>{query.data.data.map((item) => <tr key={item.id}><td><strong>{item.id}</strong><span>{item.reportedAt}</span></td><td><strong>{item.dataset}</strong><span>{item.owner}</span></td><td>{item.reason}</td><td><Badge>{item.status}</Badge></td><td><Button variant="secondary" size="small"><Eye aria-hidden="true" size={16} /> Revisar</Button></td></tr>)}</tbody></table></div>
          </section>
          <section className="admin-policy"><AlertOctagon aria-hidden="true" size={25} /><div><h2>La cuarentena no elimina archivos</h2><p>Los objetos quedan aislados y conservan checksum y auditoría hasta que una decisión explícita autorice su eliminación.</p></div></section>
        </>
      ) : null}
    </main>
  );
}
