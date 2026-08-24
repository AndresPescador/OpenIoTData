"use client";

import type { FeatureCollection, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { Dataset } from "@/lib/types";

interface MapLibreCanvasProps {
  datasets: Dataset[];
  selectedSlug?: string;
  onSelect?: (slug: string) => void;
  className?: string;
}

function toGeoJSON(datasets: Dataset[]): FeatureCollection<Point, { slug: string; title: string; sensor: string; selected: boolean }> {
  return {
    type: "FeatureCollection",
    features: datasets.flatMap((dataset) =>
      dataset.location
        ? [{
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [dataset.location.longitude, dataset.location.latitude] },
            properties: { slug: dataset.slug, title: dataset.title, sensor: dataset.sensorType, selected: false },
          }]
        : [],
    ),
  };
}

function fitToPoints(map: MapLibreMap, points: FeatureCollection<Point>, animated = true) {
  if (points.features.length === 0) return;
  const coordinates = points.features.map((feature) => feature.geometry.coordinates as [number, number]);
  const duration = animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 450 : 0;
  if (coordinates.length === 1) {
    map.easeTo({ center: coordinates[0], zoom: 11, duration });
    return;
  }
  const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
  map.fitBounds(bounds, { padding: 56, maxZoom: 11, duration });
}

function centerOf(points: FeatureCollection<Point>): [number, number] {
  if (points.features.length === 0) return [0, 0];
  const [longitude, latitude] = points.features.reduce(
    ([longitudeTotal, latitudeTotal], feature) => [
      longitudeTotal + feature.geometry.coordinates[0],
      latitudeTotal + feature.geometry.coordinates[1],
    ],
    [0, 0],
  );
  return [longitude / points.features.length, latitude / points.features.length];
}

export function MapLibreCanvas({ datasets, selectedSlug, onSelect, className }: MapLibreCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const points = useMemo(() => {
    const collection = toGeoJSON(datasets);
    collection.features.forEach((feature) => {
      feature.properties.selected = feature.properties.slug === selectedSlug;
    });
    return collection;
  }, [datasets, selectedSlug]);
  const pointsRef = useRef(points);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: centerOf(pointsRef.current),
      zoom: 8.2,
      minZoom: 3,
      maxZoom: 16,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "paper", type: "background", paint: { "background-color": "#f4f0e8" } },
          { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.58, "raster-saturation": -0.78, "raster-contrast": 0.06 } },
        ],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Ubicaciones publicadas por usuarios" }), "bottom-left");

    map.on("load", () => {
      map.addSource("datasets", { type: "geojson", data: pointsRef.current, cluster: true, clusterMaxZoom: 12, clusterRadius: 42 });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "datasets",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0f7b50",
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 23, 30, 28],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffdf7",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "datasets",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "dataset-points",
        type: "circle",
        source: "datasets",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["get", "selected"], "#ba4a35", "#10233f"],
          "circle-radius": ["case", ["get", "selected"], 9, 7],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#fffdf7",
        },
      });

      map.on("click", "clusters", async (event) => {
        const features = map.queryRenderedFeatures(event.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id as number | undefined;
        const source = map.getSource("datasets") as GeoJSONSource;
        if (clusterId === undefined) return;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const coordinates = (features[0].geometry as Point).coordinates as [number, number];
        map.easeTo({ center: coordinates, zoom });
      });

      map.on("click", "dataset-points", (event) => {
        const slug = event.features?.[0]?.properties?.slug as string | undefined;
        const title = event.features?.[0]?.properties?.title as string | undefined;
        const coordinates = (event.features?.[0]?.geometry as Point | undefined)?.coordinates as [number, number] | undefined;
        if (slug) onSelectRef.current?.(slug);
        if (slug && coordinates) {
          const content = document.createElement("div");
          content.className = "map-popup-content";
          const heading = document.createElement("strong");
          heading.textContent = title || "Dataset IoT";
          const link = document.createElement("a");
          link.href = `/datasets/${encodeURIComponent(slug)}`;
          link.textContent = "Abrir dataset";
          content.append(heading, link);
          new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(coordinates).setDOMContent(content).addTo(map);
        }
      });
      map.on("mouseenter", "dataset-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "dataset-points", () => { map.getCanvas().style.cursor = ""; });
      fitToPoints(map, pointsRef.current, false);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource("datasets") as GeoJSONSource | undefined;
    source?.setData(points);
    const map = mapRef.current;
    if (!map || points.features.length === 0) return;
    fitToPoints(map, points);
  }, [points]);

  return <div ref={containerRef} className={className} role="region" aria-label="Mapa interactivo de ubicaciones de datasets" />;
}
