"use client";

import Link from "next/link";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowDownUp, Braces, CalendarRange, MapPin, RadioTower } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Dataset } from "@/lib/types";
import { cn, formatDate, formatNumber } from "@/lib/utils";

const helper = createColumnHelper<Dataset>();

export function DatasetTable({ datasets, selectedSlug, onSelect }: { datasets: Dataset[]; selectedSlug?: string; onSelect?: (slug: string) => void }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = [
    helper.accessor("title", {
      header: "Dataset",
      cell: ({ row }) => (
        <div className="dataset-name-cell">
          <Link href={`/datasets/${row.original.slug}`}>{row.original.title}</Link>
          <span>{row.original.location?.name ?? "Sin ubicación"} · {row.original.organization}</span>
        </div>
      ),
    }),
    helper.accessor("sensorType", { header: "Tipo de sensor", cell: ({ getValue }) => <span className="cell-with-icon"><RadioTower aria-hidden="true" size={16} /> {getValue()}</span> }),
    helper.accessor("temporal.start", {
      id: "coverage",
      header: "Cobertura temporal",
      cell: ({ row }) => <span className="date-range"><CalendarRange aria-hidden="true" size={15} /> {formatDate(row.original.temporal.start)}<br />— {formatDate(row.original.temporal.end)}</span>,
    }),
    helper.accessor("license", { header: "Licencia", cell: ({ getValue }) => <Badge>{getValue()}</Badge> }),
    helper.accessor("rows", { header: "Filas", cell: ({ getValue }) => <span className="tabular">{formatNumber(getValue())}</span> }),
    helper.accessor("formats", { header: "Formato", cell: ({ getValue }) => <span className="cell-with-icon"><Braces aria-hidden="true" size={16} /> {getValue().join(" · ")}</span> }),
    helper.accessor("updatedAt", { header: "Actualización", cell: ({ getValue }) => <span className="tabular">{formatDate(getValue())}</span> }),
  ];

  const table = useReactTable({ data: datasets, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  return (
    <div className="dataset-table-shell">
      <table className="dataset-table">
        <caption className="sr-only">Datasets encontrados y sus metadatos principales</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"}>
                  {header.isPlaceholder ? null : (
                    <button type="button" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp aria-hidden="true" size={12} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={cn(row.original.slug === selectedSlug && "is-selected")} onMouseEnter={() => onSelect?.(row.original.slug)}>
              {row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dataset-mobile-list">
        {datasets.map((dataset) => (
          <article key={dataset.id} className={cn("dataset-mobile-row", dataset.slug === selectedSlug && "is-selected")}>
            <div>
              <Badge>{dataset.sensorType}</Badge><span className="tabular">{formatNumber(dataset.rows)} filas</span>
            </div>
            <h3><Link href={`/datasets/${dataset.slug}`}>{dataset.title}</Link></h3>
            <p><MapPin aria-hidden="true" size={15} /> {dataset.location?.name ?? "Sin ubicación"}</p>
            <dl>
              <div><dt>Licencia</dt><dd>{dataset.license}</dd></div>
              <div><dt>Actualizado</dt><dd>{formatDate(dataset.updatedAt)}</dd></div>
              <div><dt>Formato</dt><dd>{dataset.formats.join(" · ")}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
