"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Database, FileClock, KeyRound, Plus, UploadCloud } from "lucide-react";
import Link from "next/link";
import { DatasetTable } from "@/components/catalog/dataset-table";
import { DemoNotice } from "@/components/shared/demo-notice";
import { ErrorState, LoadingState } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { getMyDatasets } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

export function MyDatasetsView() {
  const query = useQuery({ queryKey: ["my-datasets"], queryFn: getMyDatasets });
  return (
    <main className="page-shell account-page" id="main-content">
      <header className="page-heading page-heading--actions">
        <div><h1>Mis datasets</h1><p>Gestiona borradores, versiones publicadas y credenciales de ingesta.</p></div>
        <Link href="/publish" className="button button--primary"><Plus aria-hidden="true" size={18} /> Publicar dataset</Link>
      </header>
      {query.isLoading ? <LoadingState label="Consultando tu espacio" /> : null}
      {query.isError ? <ErrorState retry={() => query.refetch()} /> : null}
      {query.data ? <DemoNotice notice={query.data.meta.notice} compact /> : null}
      {query.data ? (
        <>
          <section className="account-summary" aria-label="Resumen de mi espacio">
            <div><Database aria-hidden="true" size={22} /><strong>{query.data.data.filter((item) => item.status === "published").length}</strong><span>publicados</span></div>
            <div><FileClock aria-hidden="true" size={22} /><strong>{query.data.data.filter((item) => item.status !== "published").length}</strong><span>en preparación</span></div>
            <div><UploadCloud aria-hidden="true" size={22} /><strong>{formatNumber(query.data.data.reduce((sum, item) => sum + item.rows, 0))}</strong><span>filas catalogadas</span></div>
          </section>
          <section className="account-section">
            <div className="section-heading"><div><h2>Publicaciones</h2><p>Las versiones publicadas son inmutables; crea una nueva para actualizar datos.</p></div><Badge>{query.data.data.length}</Badge></div>
            <DatasetTable datasets={query.data.data} />
          </section>
          <section className="token-band">
            <KeyRound aria-hidden="true" size={25} />
            <div><h2>Tokens de ingesta</h2><p>Crea credenciales revocables y limitadas a un dataset para sensores o scripts.</p></div>
            <Link href="/docs/api#ingesta" className="button button--secondary">Ver guía <ArrowRight aria-hidden="true" size={17} /></Link>
          </section>
        </>
      ) : null}
    </main>
  );
}
