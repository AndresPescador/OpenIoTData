import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataChart } from "@/components/dataset/data-chart";

const setOption = vi.fn();
vi.mock("echarts", () => ({
  init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }),
}));

describe("DataChart seguridad", () => {
  beforeEach(() => setOption.mockClear());

  it("renderiza tooltips como texto enriquecido, no HTML de datos publicados", async () => {
    const maliciousUnit = '<img src=x onerror="window.__xss=true">';
    render(<DataChart readings={[{ observedAt: "2026-08-20T10:00:00Z", value: 31.5, unit: maliciousUnit, station: "S-1" }]} />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());
    const option = setOption.mock.calls[0][0] as { tooltip: { renderMode: string; formatter: (value: unknown) => string } };
    expect(option.tooltip.renderMode).toBe("richText");
    expect(option.tooltip.formatter([{ axisValueLabel: "10:00", value: 31.5 }])).toContain(maliciousUnit);
    expect(document.body.innerHTML).not.toContain(maliciousUnit);
    expect(document.querySelector("img")).toBeNull();
  });

  it("ordena el tiempo y separa una serie no suavizada por estación", async () => {
    render(<DataChart readings={[
      { observedAt: "2026-08-21T10:00:00Z", value: 22, unit: "°C", station: "Norte" },
      { observedAt: "2026-08-20T10:00:00Z", value: 18, unit: "°C", station: "Norte" },
      { observedAt: "2026-08-20T11:00:00Z", value: 19, unit: "°C", station: "Sur" },
    ]} />);
    await waitFor(() => expect(setOption).toHaveBeenCalled());
    const option = setOption.mock.calls[0][0] as {
      xAxis: { type: string };
      series: Array<{ name: string; smooth: boolean; data: Array<[string, number]> }>;
    };
    expect(option.xAxis.type).toBe("time");
    expect(option.series).toHaveLength(2);
    expect(option.series.every((series) => series.smooth === false)).toBe(true);
    expect(option.series.find((series) => series.name === "Norte")?.data).toEqual([
      ["2026-08-20T10:00:00Z", 18],
      ["2026-08-21T10:00:00Z", 22],
    ]);
  });
});
