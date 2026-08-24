"use client";

import dynamic from "next/dynamic";
import { LocateFixed, MapPinned } from "lucide-react";
import type { Dataset } from "@/lib/types";

const MapLibreCanvas = dynamic(() => import("@/components/map/maplibre-canvas").then((module) => module.MapLibreCanvas), {
  ssr: false,
  loading: () => <MapFallback message="Cargando motor cartográfico" />,
});

function MapFallback({ message = "Mapa no disponible; usa la lista de ubicaciones." }: { message?: string }) {
  return (
    <div className="map-fallback" role="img" aria-label={message}>
      <MapPinned aria-hidden="true" size={32} />
      <span>{message}</span>
    </div>
  );
}

export function SensorMap({ datasets, selectedSlug, onSelect, tall = false }: { datasets: Dataset[]; selectedSlug?: string; onSelect?: (slug: string) => void; tall?: boolean }) {
  const located = datasets.filter((dataset) => dataset.location);
  return (
    <section className={tall ? "sensor-map sensor-map--tall" : "sensor-map"} aria-label="Cobertura geográfica">
      {located.length ? (
        <MapLibreCanvas datasets={located} selectedSlug={selectedSlug} onSelect={onSelect} className="maplibre-canvas" />
      ) : (
        <MapFallback message="Ningún resultado tiene coordenadas publicadas." />
      )}
      <div className="map-legend" aria-hidden="true"><span /><strong>{located.length}</strong> ubicaciones en esta vista</div>
      <details className="map-accessible-list">
        <summary><LocateFixed aria-hidden="true" size={16} /> Lista accesible de ubicaciones ({located.length})</summary>
        <ul>
          {located.map((dataset) => (
            <li key={dataset.id}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(dataset.slug)} aria-pressed={dataset.slug === selectedSlug}>
                  <strong>{dataset.title}</strong>
                  <span>{dataset.location?.name}: {dataset.location?.latitude.toFixed(3)}, {dataset.location?.longitude.toFixed(3)}</span>
                </button>
              ) : (
                <div className="map-location-entry">
                  <strong>{dataset.title}</strong>
                  <span>{dataset.location?.name}: {dataset.location?.latitude.toFixed(3)}, {dataset.location?.longitude.toFixed(3)}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
