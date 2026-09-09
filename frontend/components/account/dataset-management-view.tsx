"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Check, Clipboard, CloudUpload, FileClock, KeyRound, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { DemoNotice } from "@/components/shared/demo-notice";
import { ErrorState, LoadingState } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  archiveDataset,
  createDatasetVersion,
  getApiTokens,
  getDatasetManagement,
  getJob,
  issueApiToken,
  publishDatasetVersion,
  revokeApiToken,
  uploadVersionResource,
  type IssuedApiToken,
} from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/utils";

const terminalVersionStates = new Set(["published", "archived"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "No pudimos completar la operación.";
}

export function DatasetManagementView({ datasetId }: { datasetId: string }) {
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [changelog, setChangelog] = useState("");
  const [resourceFile, setResourceFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string>();
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState("");
  const [issuedToken, setIssuedToken] = useState<IssuedApiToken>();
  const [copied, setCopied] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archiveConfirmRef = useRef<HTMLButtonElement>(null);
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const managementQuery = useQuery({
    queryKey: ["manage-dataset", datasetId],
    queryFn: () => getDatasetManagement(datasetId),
    enabled: auth.authenticated || demoEnabled,
  });
  const tokensQuery = useQuery({
    queryKey: ["dataset-tokens", datasetId],
    queryFn: () => getApiTokens(datasetId),
    enabled: auth.authenticated || demoEnabled,
  });
  const jobQuery = useQuery({
    queryKey: ["management-job", jobId],
    queryFn: () => getJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.data.status;
      return status === "succeeded" || status === "failed" ? false : 1200;
    },
  });

  useEffect(() => {
    if (jobQuery.data?.data.status !== "succeeded") return;
    void queryClient.invalidateQueries({ queryKey: ["manage-dataset", datasetId] });
  }, [datasetId, jobQuery.data?.data.status, queryClient]);

  useEffect(() => {
    if (!confirmArchive) return;
    const frame = window.requestAnimationFrame(() => archiveConfirmRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmArchive]);

  const versions = useMemo(() => managementQuery.data?.data.versions ?? [], [managementQuery.data]);
  const editableVersion = useMemo(
    () => versions.slice().reverse().find((version) => !terminalVersionStates.has(version.status)),
    [versions],
  );

  const createVersionMutation = useMutation({
    mutationFn: () => createDatasetVersion(datasetId, changelog.trim()),
    onSuccess: (result) => {
      queryClient.setQueryData(["manage-dataset", datasetId], result);
      setChangelog("");
    },
  });
  const uploadMutation = useMutation({
    mutationFn: () => uploadVersionResource({ datasetId, versionId: editableVersion!.id, file: resourceFile! }),
    onSuccess: (result) => {
      setJobId(result.data.jobId);
      setResourceFile(null);
    },
  });
  const publishMutation = useMutation({
    mutationFn: () => publishDatasetVersion(datasetId, editableVersion!.id),
    onSuccess: (result) => {
      queryClient.setQueryData(["manage-dataset", datasetId], result);
      void queryClient.invalidateQueries({ queryKey: ["my-datasets"] });
    },
  });
  const issueTokenMutation = useMutation({
    mutationFn: () => issueApiToken({
      datasetId,
      name: tokenName.trim(),
      expiresAt: tokenExpiry ? new Date(tokenExpiry).toISOString() : undefined,
    }),
    onSuccess: (result) => {
      setIssuedToken(result.data);
      setTokenName("");
      setTokenExpiry("");
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ["dataset-tokens", datasetId] });
    },
  });
  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => revokeApiToken(datasetId, tokenId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dataset-tokens", datasetId] }),
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveDataset(datasetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-datasets"] });
      router.push("/my-datasets");
    },
  });

  if (auth.ready && !auth.authenticated && !demoEnabled) {
    return (
      <main className="page-shell auth-required" id="main-content">
        <ShieldCheck aria-hidden="true" size={42} />
        <h1>Inicia sesión para administrar</h1>
        <p>Las versiones, credenciales y acciones de archivo están disponibles únicamente para la persona propietaria.</p>
        <Button onClick={() => auth.login()}>Ingresar con OpenIoTData</Button>
      </main>
    );
  }

  if (managementQuery.isLoading) return <main className="page-shell" id="main-content"><LoadingState label="Abriendo la gestión del dataset" /></main>;
  if (managementQuery.isError || !managementQuery.data) return <main className="page-shell" id="main-content"><ErrorState retry={() => managementQuery.refetch()} /></main>;

  const managed = managementQuery.data.data;
  const readyToPublish = Boolean(editableVersion?.resources.length) && editableVersion!.resources.every((resource) => resource.status === "ready");
  const operationError = createVersionMutation.error ?? uploadMutation.error ?? publishMutation.error ?? issueTokenMutation.error ?? revokeTokenMutation.error ?? archiveMutation.error;

  return (
    <main className="page-shell management-page" id="main-content">
      <Link className="management-back" href="/my-datasets"><ArrowLeft aria-hidden="true" size={17} /> Volver a mis datasets</Link>
      <header className="page-heading page-heading--actions">
        <div><p className="eyebrow">Espacio de publicación</p><h1>{managed.dataset.title}</h1><p>Versiones inmutables, recursos procesados y credenciales limitadas a este dataset.</p></div>
        {managed.dataset.status === "published" ? <Link className="button button--secondary" href={`/datasets/${managed.dataset.slug}`}>Abrir ficha pública</Link> : <Badge>{managed.dataset.status}</Badge>}
      </header>
      <DemoNotice notice={managementQuery.data.meta.notice} compact />
      {operationError ? <div className="submission-error" role="alert"><strong>No pudimos completar la operación.</strong><span>{errorMessage(operationError)}</span></div> : null}

      <section className="management-section" aria-labelledby="versions-title">
        <div className="section-heading"><div><h2 id="versions-title">Historial de versiones</h2><p>Una versión publicada no cambia; las correcciones se incorporan en un nuevo snapshot.</p></div><Badge>{versions.length}</Badge></div>
        <ol className="version-list">
          {versions.slice().reverse().map((version) => (
            <li key={version.id}>
              <div className="version-marker" aria-hidden="true">v{version.number}</div>
              <div><strong>Versión {version.number}</strong><p>{version.changelog || "Sin notas de cambio"}</p><span>{version.publishedAt ? `Publicada ${formatDateTime(version.publishedAt)}` : "Snapshot de trabajo"}</span></div>
              <div className="version-state"><Badge>{version.status}</Badge><span>{version.resources.length} recursos · {formatNumber(version.resources.reduce((sum, resource) => sum + resource.rows, 0))} filas</span></div>
            </li>
          ))}
        </ol>

        {!editableVersion ? (
          <form className="management-form" onSubmit={(event) => { event.preventDefault(); if (changelog.trim().length >= 5) createVersionMutation.mutate(); }}>
            <div className="form-field"><label htmlFor="changelog">Notas de la nueva versión <span aria-hidden="true">*</span></label><textarea id="changelog" rows={3} required minLength={5} value={changelog} onChange={(event) => setChangelog(event.target.value)} aria-describedby="changelog-help" /><small id="changelog-help">Resume qué datos cambian y por qué se crea este snapshot.</small></div>
            <Button type="submit" disabled={createVersionMutation.isPending || changelog.trim().length < 5}><Plus aria-hidden="true" size={18} /> {createVersionMutation.isPending ? "Creando versión" : "Crear versión"}</Button>
          </form>
        ) : (
          <div className="working-version" aria-labelledby="working-version-title">
            <div><FileClock aria-hidden="true" size={23} /><div><h3 id="working-version-title">Versión {editableVersion.number} en preparación</h3><p>{editableVersion.changelog || "Sin notas de cambio"}</p></div></div>
            <ul className="working-resources">{editableVersion.resources.map((resource) => <li key={resource.id}><span><strong>{resource.name}</strong><small>{resource.format} · {formatNumber(resource.rows)} filas</small></span><Badge>{resource.status}</Badge></li>)}</ul>
            <form className="upload-inline" onSubmit={(event) => { event.preventDefault(); if (resourceFile) uploadMutation.mutate(); }}>
              <div className="form-field"><label htmlFor="version-resource">Añadir recurso</label><input id="version-resource" type="file" accept=".csv,.tsv,.json,.ndjson,.parquet,.geojson" onChange={(event) => setResourceFile(event.target.files?.[0] ?? null)} /></div>
              <Button type="submit" variant="secondary" disabled={!resourceFile || uploadMutation.isPending}><CloudUpload aria-hidden="true" size={18} /> {uploadMutation.isPending ? "Cargando" : "Cargar y procesar"}</Button>
            </form>
            {jobId ? <div className="job-status" role="status" aria-live="polite"><span>{jobQuery.data?.data.status === "failed" ? "El procesamiento falló" : jobQuery.data?.data.status === "succeeded" ? "Recurso procesado" : `Procesando recurso · ${jobQuery.data?.data.progress ?? 0}%`}</span>{jobQuery.data?.data.error ? <small>{jobQuery.data.data.error}</small> : null}</div> : null}
            <Button disabled={!readyToPublish || publishMutation.isPending} onClick={() => publishMutation.mutate()}><Check aria-hidden="true" size={18} /> {publishMutation.isPending ? "Publicando" : `Publicar versión ${editableVersion.number}`}</Button>
            {!readyToPublish ? <p className="management-help">La publicación se habilita cuando todos los recursos terminan en estado listo.</p> : null}
          </div>
        )}
      </section>

      <section className="management-section" aria-labelledby="tokens-title">
        <div className="section-heading"><div><h2 id="tokens-title">Tokens de ingesta</h2><p>Cada credencial permite únicamente añadir observaciones a este dataset.</p></div><KeyRound aria-hidden="true" size={24} /></div>
        {issuedToken ? <div className="token-secret" role="status" aria-live="polite"><div><strong>Copia este secreto ahora</strong><p>No volverá a mostrarse después de cerrar este aviso.</p></div><code>{issuedToken.token}</code><div><Button size="small" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(issuedToken.token); setCopied(true); }}><Clipboard aria-hidden="true" size={16} /> {copied ? "Copiado" : "Copiar"}</Button><Button size="small" variant="quiet" onClick={() => setIssuedToken(undefined)}>Cerrar</Button></div></div> : null}
        <form className="token-form" onSubmit={(event) => { event.preventDefault(); if (tokenName.trim()) issueTokenMutation.mutate(); }}>
          <div className="form-field"><label htmlFor="token-name">Nombre de la credencial <span aria-hidden="true">*</span></label><input id="token-name" required maxLength={100} value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="Gateway laboratorio" /></div>
          <div className="form-field"><label htmlFor="token-expiry">Expiración opcional</label><input id="token-expiry" type="datetime-local" value={tokenExpiry} onChange={(event) => setTokenExpiry(event.target.value)} /></div>
          <Button type="submit" disabled={!tokenName.trim() || issueTokenMutation.isPending}><KeyRound aria-hidden="true" size={18} /> {issueTokenMutation.isPending ? "Creando token" : "Crear token"}</Button>
        </form>
        {tokensQuery.isLoading ? <LoadingState label="Leyendo credenciales" /> : null}
        {tokensQuery.isError ? <ErrorState retry={() => tokensQuery.refetch()} /> : null}
        {tokensQuery.data ? <div className="token-list">{tokensQuery.data.data.length ? tokensQuery.data.data.map((token) => <article key={token.id}><div><strong>{token.name}</strong><code>oidt_{token.prefix}_…</code></div><dl><div><dt>Creado</dt><dd>{formatDateTime(token.createdAt)}</dd></div><div><dt>Último uso</dt><dd>{token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Nunca"}</dd></div><div><dt>Expira</dt><dd>{token.expiresAt ? formatDateTime(token.expiresAt) : "Sin fecha"}</dd></div></dl><div>{token.revokedAt ? <Badge>Revocado</Badge> : <Button size="small" variant="danger" disabled={revokeTokenMutation.isPending} onClick={() => revokeTokenMutation.mutate(token.id)}>Revocar</Button>}</div></article>) : <p className="management-empty">Aún no hay credenciales de ingesta para este dataset.</p>}</div> : null}
      </section>

      <section className="danger-zone" aria-labelledby="archive-title">
        <Archive aria-hidden="true" size={24} />
        <div><h2 id="archive-title">Archivar dataset</h2><p>Lo retirará del catálogo público sin borrar versiones, objetos ni auditoría.</p></div>
        {!confirmArchive ? <Button variant="danger" onClick={() => setConfirmArchive(true)}>Archivar</Button> : <div className="archive-confirm" role="group" aria-label="Confirmar archivo"><strong>¿Confirmas el archivo?</strong><Button ref={archiveConfirmRef} variant="danger" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>{archiveMutation.isPending ? "Archivando" : "Sí, archivar"}</Button><Button variant="secondary" onClick={() => setConfirmArchive(false)}>Cancelar</Button></div>}
      </section>
    </main>
  );
}
