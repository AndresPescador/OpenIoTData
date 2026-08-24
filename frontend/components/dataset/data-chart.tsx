"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SensorReading } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function DataChart({ readings, title = "Tendencia de mediciones" }: { readings: SensorReading[]; title?: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const sortedReadings = useMemo(
    () => [...readings].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)),
    [readings],
  );
  const stationSeries = useMemo(() => {
    const stations = new Map<string, SensorReading[]>();
    sortedReadings.forEach((reading) => {
      const station = reading.station || "Sin identificador";
      stations.set(station, [...(stations.get(station) ?? []), reading]);
    });
    return Array.from(stations.entries());
  }, [sortedReadings]);
  const unit = sortedReadings[0]?.unit ?? "";

  useEffect(() => {
    if (!chartRef.current || sortedReadings.length === 0) return;
    let disposed = false;
    let cleanup = () => undefined;

    import("echarts").then((echarts) => {
      if (!chartRef.current || disposed) return;
      const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chart.setOption({
        animation: !reducedMotion,
        animationDuration: 380,
        color: ["#0f7b50", "#1b68c8", "#b44c38", "#7356a8", "#986400", "#237985"],
        textStyle: { fontFamily: "Manrope Variable, sans-serif", color: "#10233f" },
        aria: { enabled: true, decal: { show: stationSeries.length > 1 } },
        legend: stationSeries.length > 1 ? { type: "scroll", top: 0, data: stationSeries.map(([station]) => station) } : undefined,
        grid: { top: stationSeries.length > 1 ? 48 : 20, right: 20, bottom: 64, left: 62 },
        tooltip: {
          trigger: "axis",
          renderMode: "richText",
          formatter: (value: unknown) => {
            const items = Array.isArray(value) ? value as Array<{ axisValue?: string | number; axisValueLabel?: string; seriesName?: string; value?: number | [string, number] }> : [];
            const first = items[0];
            const rawDate = first?.axisValue ?? (Array.isArray(first?.value) ? first.value[0] : undefined);
            const date = rawDate === undefined
              ? first?.axisValueLabel ?? ""
              : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(rawDate));
            const values = items.map((item) => {
              const itemValue = Array.isArray(item.value) ? item.value[1] : item.value;
              return `${item.seriesName ? `${item.seriesName}: ` : ""}${itemValue ?? "—"} ${unit}`;
            });
            return [date, ...values].join("\n");
          },
        },
        xAxis: {
          type: "time",
          name: "Fecha y hora (UTC)",
          nameLocation: "middle",
          nameGap: 42,
          axisLabel: {
            color: "#4b5a6b",
            hideOverlap: true,
            formatter: (value: number) => new Intl.DateTimeFormat("es-CO", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)),
          },
          axisLine: { lineStyle: { color: "#748287" } },
        },
        yAxis: {
          type: "value",
          scale: true,
          name: unit || "Valor",
          nameTextStyle: { color: "#4b5a6b" },
          splitLine: { lineStyle: { color: "#d9ddd9", type: "dashed" } },
          axisLabel: { color: "#4b5a6b" },
        },
        series: stationSeries.map(([station, stationReadings]) => ({
          name: station,
          type: "line",
          data: stationReadings.map((reading) => [reading.observedAt, reading.value]),
          smooth: false,
          connectNulls: false,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 2.5 },
          emphasis: { focus: "series" },
        })),
      });
      const resize = () => chart.resize();
      window.addEventListener("resize", resize);
      cleanup = () => {
        window.removeEventListener("resize", resize);
        chart.dispose();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [sortedReadings, stationSeries, unit]);

  if (!sortedReadings.length) return <p className="chart-empty">No hay suficientes mediciones para dibujar una tendencia.</p>;
  const values = sortedReadings.map((reading) => reading.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return (
    <section className="data-chart" aria-labelledby="chart-title">
      <div className="chart-heading">
        <div><h3 id="chart-title">{title}</h3><p>Vista previa de {sortedReadings.length} observaciones en {stationSeries.length} {stationSeries.length === 1 ? "estación" : "estaciones"}; no representa validación científica.</p></div>
        <p className="chart-summary"><strong>{min.toLocaleString("es-CO")}–{max.toLocaleString("es-CO")}</strong><span>{unit}</span></p>
      </div>
      <div ref={chartRef} className="chart-canvas" role="img" aria-label={`Gráfica de líneas por estación. Los valores van de ${min} a ${max} ${unit}. La tabla siguiente contiene los valores exactos.`} />
      <details className="chart-table-alternative" open>
        <summary>Tabla accesible de la gráfica</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Valores exactos de la gráfica, ordenados cronológicamente</caption>
            <thead><tr><th scope="col">Fecha y hora</th><th scope="col">Estación</th><th scope="col">Valor</th></tr></thead>
            <tbody>{sortedReadings.map((reading, index) => <tr key={`${reading.station}-${reading.observedAt}-${index}`}><td>{formatDateTime(reading.observedAt)}</td><td>{reading.station}</td><td className="tabular">{reading.value} {reading.unit}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
