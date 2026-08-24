"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleDot, CloudUpload, FileCheck2, FlaskConical, MapPin, Save, ShieldCheck, TableProperties } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DemoNotice } from "@/components/shared/demo-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createDraft, getJob, getManagedDraft, publishDraft, type RemoteDraft } from "@/lib/api";
import type { DraftPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";

const schema = z.object({
  title: z.string().min(5, "Escribe un título de al menos 5 caracteres."),
  description: z.string().min(30, "Describe el origen y propósito en al menos 30 caracteres."),
  topic: z.string().min(1, "Selecciona un tema."),
  tags: z.string(),
  license: z.string().min(1, "Selecciona una licencia abierta."),
  resourceName: z.string().min(1, "Selecciona un archivo compatible."),
  resourceFormat: z.string().min(1, "Indica el formato del recurso."),
  timeField: z.string(),
  latitudeField: z.string(),
  longitudeField: z.string(),
}).superRefine((value, context) => {
  if (Boolean(value.latitudeField) === Boolean(value.longitudeField)) return;
  const missing = value.latitudeField ? "longitudeField" : "latitudeField";
  context.addIssue({
    code: "custom",
    path: [missing],
    message: "Latitud y longitud deben mapearse juntas.",
  });
});

const defaults: DraftPayload = {
  title: "",
  description: "",
  topic: "",
  tags: "",
  license: "",
  resourceName: "",
  resourceFormat: "",
  timeField: "observed_at",
  latitudeField: "latitude",
  longitudeField: "longitude",
};

const steps = [
  { title: "Metadatos", description: "Qué contiene", icon: CircleDot },
  { title: "Recurso", description: "Archivo original", icon: CloudUpload },
  { title: "Preparar esquema", description: "Revisión sugerida", icon: TableProperties },
  { title: "Preparar mapeo", description: "Tiempo y lugar", icon: MapPin },
  { title: "Publicar", description: "Licencia y revisión", icon: ShieldCheck },
];

const fieldsByStep: Array<Array<keyof DraftPayload>> = [
  ["title", "description", "topic"],
  ["resourceName", "resourceFormat"],
  [],
  ["timeField", "latitudeField", "longitudeField"],
  ["license"],
];

export function PublishWizard() {
  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [resourceFile, setResourceFile] = useState<File | null>(null);
  const [remoteDraft, setRemoteDraft] = useState<RemoteDraft | null>(null);
  const [published, setPublished] = useState<{ id: string; slug: string; status: string; notice?: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const wizardPanelRef = useRef<HTMLFieldSetElement>(null);
  const previousStepRef = useRef(step);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
  const form = useForm<DraftPayload>({ resolver: zodResolver(schema), defaultValues: defaults, mode: "onBlur" });
  const values = form.watch();
  const uploadMutation = useMutation({ mutationFn: createDraft });
  const publishMutation = useMutation({ mutationFn: publishDraft });
  const jobQuery = useQuery({
    queryKey: ["publish-job", remoteDraft?.jobId],
    queryFn: () => getJob(remoteDraft!.jobId),
    enabled: Boolean(remoteDraft?.jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.data.status;
      return status === "succeeded" || status === "failed" ? false : 1200;
    },
  });
  const managedQuery = useQuery({
    queryKey: ["managed-draft", remoteDraft?.id, jobQuery.data?.data.status],
    queryFn: () => getManagedDraft(remoteDraft!.id),
    enabled: Boolean(remoteDraft && jobQuery.data?.data.status === "succeeded"),
  });

  useEffect(() => {
    const saved = window.localStorage.getItem("openiotdata:publish-draft");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<DraftPayload> & { locationName?: unknown };
        delete parsed.locationName;
        form.reset({ ...defaults, ...parsed });
      } catch {
        window.localStorage.removeItem("openiotdata:publish-draft");
      }
    }
    setHydrated(true);
  }, [form]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem("openiotdata:publish-draft", JSON.stringify(values));
      setSavedAt(new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [values, hydrated]);

  useEffect(() => {
    const fields = managedQuery.data?.data.dataset.schema;
    if (!fields?.length) return;
    form.setValue("timeField", fields.find((field) => field.semantic === "time")?.name ?? "");
    form.setValue("latitudeField", fields.find((field) => field.semantic === "latitude")?.name ?? "");
    form.setValue("longitudeField", fields.find((field) => field.semantic === "longitude")?.name ?? "");
  }, [form, managedQuery.data]);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() => wizardPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const discardRemoteUpload = () => {
    if (remoteDraft) {
      void queryClient.cancelQueries({ queryKey: ["publish-job", remoteDraft.jobId] });
      queryClient.removeQueries({ queryKey: ["publish-job", remoteDraft.jobId] });
      queryClient.removeQueries({ queryKey: ["managed-draft", remoteDraft.id] });
    }
    setRemoteDraft(null);
    setConfirmed(false);
    uploadMutation.reset();
    publishMutation.reset();
  };

  const selectResourceFile = (file: File) => {
    discardRemoteUpload();
    setResourceFile(file);
    form.clearErrors("resourceName");
    const extension = file.name.split(".").pop()?.toUpperCase() ?? "";
    form.setValue("resourceName", file.name, { shouldValidate: true, shouldDirty: true });
    form.setValue("resourceFormat", extension === "GEOJSON" ? "GeoJSON" : extension === "PARQUET" ? "Parquet" : extension, { shouldValidate: true, shouldDirty: true });
  };

  const next = async () => {
    if (step === 1 && !resourceFile) {
      form.setError("resourceName", { type: "manual", message: "Selecciona de nuevo el archivo; por seguridad no se conserva al recargar la página." }, { shouldFocus: true });
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    const valid = await form.trigger(fieldsByStep[step], { shouldFocus: true });
    if (!valid) {
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    if (step === 1 && resourceFile && !remoteDraft) {
      try {
        const uploaded = await uploadMutation.mutateAsync({ payload: form.getValues(), file: resourceFile });
        setRemoteDraft(uploaded.data);
        setStep(2);
      } catch {
        return;
      }
      return;
    }
    if (step === 2 && (jobQuery.data?.data.status !== "succeeded" || !managedQuery.data)) return;
    setStep((current) => Math.min(steps.length - 1, current + 1));
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const submit = form.handleSubmit(
    async (payload) => {
      if (!resourceFile) {
        form.setError("resourceName", { type: "manual", message: "Selecciona el archivo antes de crear el borrador." });
        setStep(1);
        return;
      }
      if (!remoteDraft) {
        form.setError("resourceName", { type: "manual", message: "Vuelve al paso Recurso para crear y procesar el borrador." });
        setStep(1);
        return;
      }
      const result = await publishMutation.mutateAsync({ remote: remoteDraft, payload });
      setPublished({ ...result.data, notice: result.meta.notice });
    },
    () => errorSummaryRef.current?.focus(),
  );

  const errors = Object.entries(form.formState.errors);
  const operationError = uploadMutation.error ?? publishMutation.error;
  const inferredFields = managedQuery.data?.data.dataset.schema ?? [];
  const remoteResource = managedQuery.data?.data.dataset.resources.find((resource) => resource.id === remoteDraft?.resourceId)
    ?? managedQuery.data?.data.dataset.resources[0];
  const reviewedResourceName = remoteResource?.name ?? (remoteDraft ? `Recurso ${remoteDraft.resourceId}` : values.resourceName);
  const reviewedResourceChecksum = remoteResource?.checksum;
  const processingReady = jobQuery.data?.data.status === "succeeded" && Boolean(managedQuery.data);
  const retryUpload = () => {
    discardRemoteUpload();
    setStep(1);
  };

  if (published) {
    return (
      <main className="publish-success" id="main-content">
        <div className="success-registration" aria-hidden="true"><Check size={36} /></div>
        <h1>Dataset publicado</h1>
        <p>La versión procesada, su mapeo semántico y la licencia quedaron publicados. Puedes abrir la ficha reproducible o iniciar otra publicación.</p>
        <DemoNotice notice={published.notice} />
        <dl><div><dt>Identificador</dt><dd><code>{published.id}</code></dd></div><div><dt>Estado</dt><dd>{published.status}</dd></div>{remoteDraft?.jobId ? <div><dt>Trabajo procesado</dt><dd><code>{remoteDraft.jobId}</code></dd></div> : null}</dl>
        <div className="success-actions"><Link href={published.slug ? `/datasets/${published.slug}` : "/my-datasets"} className="button button--primary">Abrir dataset</Link><button className="button button--secondary" type="button" onClick={() => { uploadMutation.reset(); publishMutation.reset(); form.reset(defaults); setResourceFile(null); setRemoteDraft(null); setPublished(null); setConfirmed(false); window.localStorage.removeItem("openiotdata:publish-draft"); setStep(0); }}>Publicar otro</button></div>
      </main>
    );
  }

  if (auth.ready && !auth.authenticated && !demoEnabled) {
    return (
      <main className="page-shell auth-required" id="main-content">
        <ShieldCheck aria-hidden="true" size={42} />
        <h1>Inicia sesión para publicar</h1>
        <p>La consulta es pública. Para preservar procedencia, cuotas y auditoría, cada publicación necesita una identidad verificada por OIDC.</p>
        <Button onClick={() => auth.login()}>Ingresar con OpenIoTData</Button>
      </main>
    );
  }

  return (
    <main className="publish-page" id="main-content">
      <header className="publish-heading">
        <div><h1>Publicar un dataset</h1><p>El original se preserva; revisa la inferencia antes de publicar una versión reproducible.</p></div>
        <p className="autosave-status" role="status"><Save aria-hidden="true" size={16} /> {savedAt ? `Borrador local guardado a las ${savedAt}` : "Preparando guardado automático"}</p>
      </header>
      {!auth.authenticated && demoEnabled ? <DemoNotice notice="Modo demostración: puedes recorrer el flujo sin una cuenta; el archivo no saldrá de este navegador." /> : null}

      <ol className="wizard-steps" aria-label="Progreso de publicación">
        {steps.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className={cn(index === step && "is-current", index < step && "is-complete")}>
              <button type="button" disabled={index > step} onClick={() => index <= step && setStep(index)} aria-current={index === step ? "step" : undefined}>
                <span>{index < step ? <Check aria-hidden="true" size={16} /> : <Icon aria-hidden="true" size={17} />}</span>
                <strong>{item.title}</strong><small>{item.description}</small>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite" aria-atomic="true">Paso {step + 1} de {steps.length}: {steps[step].title}. {steps[step].description}.</p>

      <form className="wizard-form" onSubmit={submit} noValidate>
        {errors.length ? (
          <div className="form-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
            <strong>Revisa {errors.length === 1 ? "este campo" : `estos ${errors.length} campos`} antes de continuar:</strong>
            <ul>{errors.map(([name, error]) => <li key={name}><a href={`#${name === "resourceName" || name === "resourceFormat" ? "resource-file" : name}`}>{error.message}</a></li>)}</ul>
          </div>
        ) : null}

        {step === 0 ? (
          <fieldset className="wizard-panel" ref={wizardPanelRef} tabIndex={-1}><legend>Describe el dataset</legend><p className="panel-intro">Usa lenguaje que permita a otra persona decidir si estos datos sirven para su investigación.</p>
            <div className="form-field"><label htmlFor="title">Título <span aria-hidden="true">*</span></label><input id="title" required aria-required="true" {...form.register("title")} aria-invalid={Boolean(form.formState.errors.title)} aria-describedby={form.formState.errors.title ? "title-help title-error" : "title-help"} /><small id="title-help">Incluye variable, cobertura o red cuando aporte contexto.</small>{form.formState.errors.title ? <p id="title-error" role="alert">{form.formState.errors.title.message}</p> : null}</div>
            <div className="form-field"><label htmlFor="description">Descripción <span aria-hidden="true">*</span></label><textarea id="description" rows={6} required aria-required="true" {...form.register("description")} aria-invalid={Boolean(form.formState.errors.description)} aria-describedby={form.formState.errors.description ? "description-help description-error" : "description-help"} /><small id="description-help">Explica procedencia, método de captura, frecuencia y limitaciones conocidas.</small>{form.formState.errors.description ? <p id="description-error" role="alert">{form.formState.errors.description.message}</p> : null}</div>
            <div className="form-row"><div className="form-field"><label htmlFor="topic">Tema <span aria-hidden="true">*</span></label><select id="topic" required aria-required="true" {...form.register("topic")} aria-invalid={Boolean(form.formState.errors.topic)} aria-describedby={form.formState.errors.topic ? "topic-error" : undefined}><option value="">Seleccionar</option><option>Ambiente</option><option>Clima</option><option>Agua</option><option>Movilidad</option><option>Infraestructura</option><option>Agricultura</option><option>Otro</option></select>{form.formState.errors.topic ? <p id="topic-error" role="alert">{form.formState.errors.topic.message}</p> : null}</div><div className="form-field"><label htmlFor="tags">Etiquetas</label><input id="tags" {...form.register("tags")} placeholder="ruido, bogotá, serie temporal" aria-describedby="tags-help" /><small id="tags-help">Separadas por comas.</small></div></div>
          </fieldset>
        ) : null}

        {step === 1 ? (
          <fieldset className="wizard-panel" ref={wizardPanelRef} tabIndex={-1}><legend>Añade el recurso original</legend><p className="panel-intro" id="resource-file-help">Formatos v1: CSV, TSV, JSON, NDJSON, Parquet y GeoJSON. Máximo inicial: 1 GiB.</p>
            <input className="sr-only" id="resource-file" type="file" required aria-required="true" aria-invalid={Boolean(form.formState.errors.resourceName)} aria-describedby={form.formState.errors.resourceName ? "resource-file-help resource-file-error" : "resource-file-help"} accept=".csv,.tsv,.json,.ndjson,.parquet,.geojson" onChange={(event) => { const file = event.target.files?.[0]; if (file) selectResourceFile(file); }} />
            <label className="upload-zone" htmlFor="resource-file"><CloudUpload aria-hidden="true" size={32} /><strong>{values.resourceName || "Selecciona un archivo"}</strong><span>El archivo no se enviará hasta que continúes al procesamiento.</span><span className="button button--secondary button--small">Elegir archivo</span></label>
            {form.formState.errors.resourceName ? <p className="field-error" id="resource-file-error" role="alert">{form.formState.errors.resourceName.message}</p> : null}
            <div className="upload-safety"><ShieldCheck aria-hidden="true" size={20} /><div><strong>La carga se tratará como contenido no confiable.</strong><p>Se comprobarán firma, tamaño y malware antes de inferir el esquema. El nombre visible no se usa como ruta interna.</p></div></div>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <fieldset className="wizard-panel" ref={wizardPanelRef} tabIndex={-1}><legend>Revisa el esquema inferido</legend><p className="panel-intro">El worker analiza <strong>{reviewedResourceName || "el recurso"}</strong> antes de permitir mapeo o publicación.</p>
            <DemoNotice notice={uploadMutation.data?.meta.notice || managedQuery.data?.meta.notice} />
            {!processingReady ? <div className="processing-panel" role="status"><span className="loading-mark" aria-hidden="true" /><div><strong>{jobQuery.data?.data.status === "failed" ? "El procesamiento falló" : "Procesando archivo"}</strong><span>{jobQuery.data?.data.error || `${jobQuery.data?.data.progress ?? 0}% · seguridad, normalización e inferencia`}</span>{jobQuery.data?.data.status === "failed" ? <Button size="small" variant="secondary" onClick={retryUpload}>Cambiar archivo o reintentar</Button> : null}</div><progress max="100" value={jobQuery.data?.data.progress ?? 0}>{jobQuery.data?.data.progress ?? 0}%</progress></div> : null}
            {processingReady ? <><div className="inference-summary"><div><FileCheck2 aria-hidden="true" size={22} /><strong>{inferredFields.length} campos detectados</strong><span>{managedQuery.data?.data.dataset.rows.toLocaleString("es-CO")} filas · SHA-256 {reviewedResourceChecksum?.slice(0, 12) ?? "no disponible"}</span></div><Badge>{managedQuery.data?.data.dataset.quality.technical}</Badge></div>
            <div className="schema-table-wrap"><table className="schema-table"><caption className="sr-only">Esquema inferido del recurso {reviewedResourceName}</caption><thead><tr><th scope="col">Campo</th><th scope="col">Tipo inferido</th><th scope="col">Nulos</th><th scope="col">Ejemplo</th></tr></thead><tbody>{inferredFields.map((field) => <tr key={field.name}><td><code>{field.name}</code></td><td>{field.type}</td><td>{(field.nullRate * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}%</td><td>{String(field.examples[0] ?? "—")}</td></tr>)}</tbody></table></div></> : null}
          </fieldset>
        ) : null}

        {step === 3 ? (
          <fieldset className="wizard-panel" ref={wizardPanelRef} tabIndex={-1}><legend>Prepara tiempo y ubicación</legend><p className="panel-intro">Estos valores se aplicarán al recurso procesado. Confirma que las columnas elegidas contienen los datos esperados.</p>
            <div className="mapping-grid">
              <div className="mapping-group"><h2>Tiempo</h2><div className="form-field"><label htmlFor="timeField">Campo de observación</label><select id="timeField" {...form.register("timeField")}><option value="">No mapear</option>{inferredFields.map((field) => <option key={field.name} value={field.name}>{field.name} · {field.type}</option>)}</select></div></div>
              <div className="mapping-group"><h2>Geografía · EPSG:4326</h2><div className="form-row"><div className="form-field"><label htmlFor="latitudeField">Latitud</label><select id="latitudeField" {...form.register("latitudeField")} aria-invalid={Boolean(form.formState.errors.latitudeField)} aria-describedby={form.formState.errors.latitudeField ? "geography-privacy-note latitude-error" : "geography-privacy-note"}><option value="">No mapear</option>{inferredFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select>{form.formState.errors.latitudeField ? <p id="latitude-error" role="alert">{form.formState.errors.latitudeField.message}</p> : null}</div><div className="form-field"><label htmlFor="longitudeField">Longitud</label><select id="longitudeField" {...form.register("longitudeField")} aria-invalid={Boolean(form.formState.errors.longitudeField)} aria-describedby={form.formState.errors.longitudeField ? "geography-privacy-note longitude-error" : "geography-privacy-note"}><option value="">No mapear</option>{inferredFields.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select>{form.formState.errors.longitudeField ? <p id="longitude-error" role="alert">{form.formState.errors.longitudeField.message}</p> : null}</div></div><div className="inline-warning" id="geography-privacy-note" role="note"><strong>Privacidad geográfica</strong><p>En esta versión, las coordenadas mapeadas se publican con la precisión que contiene el archivo. Omite el mapeo o reduce la precisión en el archivo antes de cargarlo si la ubicación es sensible.</p></div></div>
            </div>
          </fieldset>
        ) : null}

        {step === 4 ? (
          <fieldset className="wizard-panel" ref={wizardPanelRef} tabIndex={-1}><legend>Licencia y revisión</legend><p className="panel-intro">Sólo publica datos que puedas compartir. La licencia quedará declarada en la ficha del dataset.</p>
            <div className="license-options" role="radiogroup" aria-required="true" aria-describedby={form.formState.errors.license ? "license-error" : undefined}>
              {[{ id: "CC BY 4.0", copy: "Reutilización con atribución" }, { id: "CC0 1.0", copy: "Dedicación al dominio público" }, { id: "ODC BY 1.0", copy: "Base de datos con atribución" }, { id: "ODbL 1.0", copy: "Base de datos con compartir igual" }].map((license) => <label key={license.id} className={cn(values.license === license.id && "is-selected")}><input type="radio" required value={license.id} {...form.register("license")} /><span><strong>{license.id}</strong><small>{license.copy}</small></span></label>)}
            </div>
            {form.formState.errors.license ? <p className="field-error" id="license-error" role="alert">{form.formState.errors.license.message}</p> : null}
            <div className="review-sheet"><h2>Resumen del borrador</h2><dl><div><dt>Título</dt><dd>{values.title || "Pendiente"}</dd></div><div><dt>Recurso procesado</dt><dd>{reviewedResourceName || "Pendiente"}</dd></div><div><dt>SHA-256</dt><dd><code>{reviewedResourceChecksum || "Pendiente"}</code></dd></div><div><dt>Tema</dt><dd>{values.topic || "Pendiente"}</dd></div><div><dt>Tiempo</dt><dd>{values.timeField || "Sin mapear"}</dd></div><div><dt>Ubicación</dt><dd>{values.latitudeField && values.longitudeField ? `${values.latitudeField} / ${values.longitudeField} · precisión original` : "Sin mapear"}</dd></div><div><dt>Licencia</dt><dd>{values.license || "Pendiente"}</dd></div></dl></div>
            <label className="publication-confirm"><input type="checkbox" required aria-required="true" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Confirmo que tengo autorización para publicar estos datos, revisé posibles datos personales y entiendo que las coordenadas mapeadas conservarán la precisión del archivo.</span></label>
          </fieldset>
        ) : null}

        {operationError ? <div className="submission-error" role="alert"><strong>No pudimos completar la operación.</strong><span>{operationError instanceof Error ? operationError.message : "Inténtalo de nuevo."}</span></div> : null}

        <div className="wizard-actions">
          <Button variant="quiet" disabled={step === 0 || uploadMutation.isPending || publishMutation.isPending} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft aria-hidden="true" size={18} /> Atrás</Button>
          <span>Paso {step + 1} de {steps.length}</span>
          {step < steps.length - 1 ? <Button onClick={next} disabled={uploadMutation.isPending || (step === 2 && !processingReady)}>{uploadMutation.isPending ? <><span className="button-spinner" aria-hidden="true" /> Cargando recurso</> : <>Continuar <ArrowRight aria-hidden="true" size={18} /></>}</Button> : <Button type="submit" disabled={publishMutation.isPending || !confirmed}>{publishMutation.isPending ? <><span className="button-spinner" aria-hidden="true" /> Publicando versión</> : <><FlaskConical aria-hidden="true" size={18} /> Publicar versión</>}</Button>}
        </div>
      </form>
    </main>
  );
}
