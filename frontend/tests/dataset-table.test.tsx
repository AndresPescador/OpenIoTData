import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatasetTable } from "@/components/catalog/dataset-table";
import { demoDatasets } from "@/lib/demo-data";

describe("DatasetTable", () => {
  it("expone metadatos, enlaces y ordenación accesible", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DatasetTable datasets={[demoDatasets[1], demoDatasets[0]]} onSelect={onSelect} />);

    const table = screen.getByRole("table", { name: /datasets encontrados/i });
    expect(within(table).getByRole("link", { name: /ruido ambiental/i })).toHaveAttribute("href", "/datasets/ruido-ambiental-puntos-estrategicos");
    const sortButton = within(table).getByRole("button", { name: /dataset/i });
    await user.click(sortButton);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Calidad del aire");
  });

  it("sincroniza la selección al recorrer filas", async () => {
    const onSelect = vi.fn();
    render(<DatasetTable datasets={[demoDatasets[0]]} onSelect={onSelect} />);
    const table = screen.getByRole("table", { name: /datasets encontrados/i });
    const row = within(table).getAllByRole("row")[1];
    await userEvent.hover(row);
    expect(onSelect).toHaveBeenCalledWith(demoDatasets[0].slug);
  });
});
