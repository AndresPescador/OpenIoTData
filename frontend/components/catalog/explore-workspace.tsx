"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, List, Map, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { DatasetTable } from "@/components/catalog/dataset-table";
import { FiltersPanel } from "@/components/catalog/filters-panel";
import { SensorMap } from "@/components/map/sensor-map";
import { DemoNotice } from "@/components/shared/demo-notice";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/query-state";
import { getCatalog } from "@/lib/api";
import type { CatalogFilters } from "@/lib/types";
import { cn } from "@/lib/utils";

function readFilters(params: URLSearchParams): CatalogFilters {
  return {
    q: params.get("q") ?? "",
    sensor: params.get("sensor") ?? "",
    variable: params.get("variable") ?? "",
    format: params.get("format") ?? "",
    license: params.get("license") ?? "",
    location: params.get("location") ?? "",
    period: params.get("period") ?? "",
    mapOnly: params.get("mapOnly") === "true",
    sort: (params.get("sort") as CatalogFilters["sort"]) ?? "recent",
  };
}

export function ExploreWorkspace({ variant = "home" }: { variant?: "home" | "catalog" | "map" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlSnapshot = searchParams.toString();
  const filters = useMemo(() => readFilters(new URLSearchParams(urlSnapshot)), [urlSnapshot]);
  const [query, setQuery] = useState(filters.q ?? "");
  const [selectedSlug, setSelectedSlug] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [, startTransition] = useTransition();
  const view = searchParams.get("view") === "map" ? "map" : "list";

  const updateUrl = useCallback((updates: Record<string, string | boolean | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === "" || value === false) next.delete(key);
      else next.set(key, String(value));
    });
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }, [pathname, router, searchParams, startTransition]);

  useEffect(() => {
    const syncFromHistory = () => setQuery(new URL(window.location.href).searchParams.get("q") ?? "");
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query !== (filters.q ?? "")) updateUrl({ q: query });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, filters.q, updateUrl]);

  const catalog = useInfiniteQuery({
    queryKey: ["catalog", filters],
    queryFn: ({ pageParam }) => getCatalog(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
  });
  const datasets = useMemo(() => catalog.data?.pages.flatMap((page) => page.data.items) ?? [], [catalog.data]);
  const catalogMeta = catalog.data?.pages[0]?.meta;
  const activeSelectedSlug = selectedSlug && datasets.some((dataset) => dataset.slug === selectedSlug) ? selectedSlug : datasets[0]?.slug;

  const changeFilters = (updates: Partial<CatalogFilters>) => updateUrl(updates as Record<string, string | boolean | undefined>);
  const clearFilters = () => {
    setQuery("");
    router.replace(pathname, { scroll: false });
  };

  const queryContent = catalog.isLoading ? (
    <LoadingState label="Levantando el catálogo" />
  ) : catalog.isError && datasets.length === 0 ? (
    <ErrorState retry={() => catalog.refetch()} message={catalog.error instanceof Error ? catalog.error.message : undefined} />
  ) : datasets.length === 0 ? (
    <EmptyState clear={clearFilters} />
  ) : null;
  const pagination = catalog.hasNextPage ? (
    <div className="catalog-pagination">
      <button type="button" disabled={catalog.isFetchingNextPage} onClick={() => void catalog.fetchNextPage()}>
        {catalog.isFetchingNextPage ? "Cargando más datasets…" : "Cargar más datasets"}
      </button>
    </div>
  ) : null;

  if (variant === "map") {
    return (
      <div className="map-page-layout">
        <div className="map-page-tools">
          <div>
            <h1>Mapa de datos IoT</h1>
            <p>Explora cobertura declarada. Las coordenadas pueden estar generalizadas por privacidad.</p>
          </div>
          <label className="search-field search-field--compact" htmlFor="map-search"><Search aria-hidden="true" size={19} /><span className="sr-only">Buscar en el mapa</span><input id="map-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sensor, variable o lugar" /></label>
          <button className="mobile-filter-trigger" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal aria-hidden="true" size={18} /> Filtros</button>
        </div>
        <div className="map-page-workspace">
          <div className={cn("map-page-filters", filtersOpen && "is-open")}><FiltersPanel filters={filters} onChange={changeFilters} onClear={clearFilters} /></div>
          <div className="map-page-canvas">
            {catalogMeta?.source === "demo" ? <DemoNotice notice={catalogMeta.notice} compact /> : null}
            {queryContent ?? <><SensorMap datasets={datasets} selectedSlug={activeSelectedSlug} onSelect={setSelectedSlug} tall />{pagination}</>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("explore", variant === "catalog" && "explore--catalog")}>
      {variant === "catalog" ? (
        <div className="catalog-heading">
          <div><h1>Explorar datasets</h1><p>Busca por el dato que necesitas y verifica su estructura antes de descargarlo.</p></div>
          <div className="view-switch" aria-label="Cambiar vista">
            <button type="button" aria-pressed={view === "list"} onClick={() => updateUrl({ view: "list" })}><List aria-hidden="true" size={17} /> Lista</button>
            <button type="button" aria-pressed={view === "map"} onClick={() => updateUrl({ view: "map" })}><Map aria-hidden="true" size={17} /> Mapa</button>
          </div>
        </div>
      ) : null}

      <div className="discovery-workspace">
        <section className="discovery-sidebar" aria-labelledby={variant === "home" ? "discovery-title" : "catalog-search-title"}>
          {variant === "home" ? (
            <div className="discovery-intro">
              <h1 id="discovery-title">Datos IoT abiertos,<br />listos para reutilizar</h1>
              <p>Encuentra datasets de sensores, entiende su estructura y descarga versiones reproducibles.</p>
            </div>
          ) : <h2 id="catalog-search-title" className="sr-only">Buscar y filtrar datasets</h2>}

          <label className="search-field" htmlFor={`${variant}-search`}>
            <Search aria-hidden="true" size={20} />
            <span className="sr-only">Busca por sensor, lugar o variable</span>
            <input id={`${variant}-search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sensor, lugar o variable" />
            <kbd aria-hidden="true">/</kbd>
          </label>
          {variant === "home" ? (
            <Link href={`/datasets${urlSnapshot ? `?${urlSnapshot}` : ""}`} className="explore-action">Explorar datasets <ArrowRight aria-hidden="true" size={19} /></Link>
          ) : null}

          <button className="mobile-filter-trigger" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal aria-hidden="true" size={18} /> {filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}</button>
          <div className={cn("filter-wrapper", filtersOpen && "is-open")}><FiltersPanel filters={filters} onChange={changeFilters} onClear={clearFilters} /></div>
          {catalogMeta?.source === "demo" ? <DemoNotice notice={catalogMeta.notice} /> : null}
        </section>

        <div className={cn("discovery-map", variant === "catalog" && view === "list" && "catalog-list-map")}>
          {queryContent ?? <><SensorMap datasets={datasets} selectedSlug={activeSelectedSlug} onSelect={setSelectedSlug} />{variant === "catalog" && view === "map" ? pagination : null}</>}
        </div>
      </div>

      {variant === "catalog" && view === "map" ? null : (
        <section className="catalog-results" aria-labelledby="catalog-results-title">
          <div className="results-heading">
            <p id="catalog-results-title"><strong>{datasets.length}</strong> datasets cargados <span>· {catalog.hasNextPage ? "hay más resultados" : "fin de los resultados del filtro"}</span></p>
            <label>Ordenar por:
              <select value={filters.sort ?? "recent"} onChange={(event) => changeFilters({ sort: event.target.value as CatalogFilters["sort"] })}>
                <option value="recent">Más recientes</option>
                <option value="downloads">Más descargados</option>
                <option value="title">Título</option>
              </select>
            </label>
          </div>
          {queryContent ?? <><DatasetTable datasets={datasets} selectedSlug={activeSelectedSlug} onSelect={setSelectedSlug} />{pagination}</>}
        </section>
      )}
    </div>
  );
}
