import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreWorkspace } from "@/components/catalog/explore-workspace";
import { LoadingState } from "@/components/shared/query-state";

export const metadata: Metadata = { title: "Explorar datasets" };

export default function DatasetsPage() {
  return <main id="main-content"><Suspense fallback={<div className="page-shell"><LoadingState /></div>}><ExploreWorkspace variant="catalog" /></Suspense></main>;
}
