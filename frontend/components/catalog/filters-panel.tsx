"use client";

import { CalendarRange, FileType2, LocateFixed, MapPin, RadioTower, SlidersHorizontal, Waves } from "lucide-react";
import type { CatalogFilters } from "@/lib/types";

interface FiltersPanelProps {
  filters: CatalogFilters;
  onChange: (next: Partial<CatalogFilters>) => void;
  onClear: () => void;
}

const sensors = ["Calidad del aire", "Ruido", "Meteorología", "Energía", "Nivel de agua", "Humedad", "Conteo", "Calidad de agua"];

export function FiltersPanel({ filters, onChange, onClear }: FiltersPanelProps) {
  return (
    <aside className="filter-panel" aria-label="Filtros del catálogo">
      <div className="filter-panel__heading">
        <h2><SlidersHorizontal aria-hidden="true" size={18} /> Filtros</h2>
        <button type="button" onClick={onClear}>Limpiar filtros</button>
      </div>

      <div className="filter-control">
        <label htmlFor="filter-location"><MapPin aria-hidden="true" size={17} /> Lugar mencionado</label>
        <input id="filter-location" value={filters.location ?? ""} onChange={(event) => onChange({ location: event.target.value })} placeholder="En título, descripción o etiquetas" />
        <small>Sólo devuelve datasets con cobertura geográfica declarada.</small>
      </div>

      <label className="switch-row" htmlFor="filter-map-only">
        <span><LocateFixed aria-hidden="true" size={17} /> Sólo datos con ubicación</span>
        <input id="filter-map-only" type="checkbox" checked={Boolean(filters.mapOnly)} onChange={(event) => onChange({ mapOnly: event.target.checked })} />
        <span className="switch" aria-hidden="true" />
      </label>

      <div className="filter-control">
        <label htmlFor="filter-sensor"><RadioTower aria-hidden="true" size={17} /> Tipo de sensor</label>
        <select id="filter-sensor" value={filters.sensor ?? ""} onChange={(event) => onChange({ sensor: event.target.value })}>
          <option value="">Todos los sensores</option>
          {sensors.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>

      <div className="filter-control">
        <label htmlFor="filter-variable"><Waves aria-hidden="true" size={17} /> Variable</label>
        <input id="filter-variable" value={filters.variable ?? ""} onChange={(event) => onChange({ variable: event.target.value })} placeholder="Nombre de columna: pm25, leq_db…" />
        <small>Busca dentro del esquema inferido de la versión publicada.</small>
      </div>

      <div className="filter-control">
        <label htmlFor="filter-period"><CalendarRange aria-hidden="true" size={17} /> Rango temporal</label>
        <select id="filter-period" value={filters.period ?? ""} onChange={(event) => onChange({ period: event.target.value })}>
          <option value="">Cualquier fecha</option>
          <option value="12m">Últimos 12 meses</option>
          <option value="3y">Últimos 3 años</option>
          <option value="historic">Comenzó hace más de 3 años</option>
        </select>
      </div>

      <div className="filter-control">
        <label htmlFor="filter-license"><span className="license-glyph" aria-hidden="true">CC</span> Licencia</label>
        <select id="filter-license" value={filters.license ?? ""} onChange={(event) => onChange({ license: event.target.value })}>
          <option value="">Todas las licencias</option>
          <option>CC BY 4.0</option>
          <option>CC0 1.0</option>
          <option>ODC BY 1.0</option>
          <option>ODbL 1.0</option>
        </select>
      </div>

      <div className="filter-control">
        <label htmlFor="filter-format"><FileType2 aria-hidden="true" size={17} /> Formato</label>
        <select id="filter-format" value={filters.format ?? ""} onChange={(event) => onChange({ format: event.target.value })}>
          <option value="">Todos los formatos</option>
          {['CSV', 'TSV', 'JSON', 'NDJSON', 'Parquet', 'GeoJSON'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
    </aside>
  );
}
