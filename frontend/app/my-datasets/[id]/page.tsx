import type { Metadata } from "next";
import { DatasetManagementView } from "@/components/account/dataset-management-view";

export const metadata: Metadata = { title: "Administrar dataset" };

export default async function DatasetManagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DatasetManagementView datasetId={id} />;
}
