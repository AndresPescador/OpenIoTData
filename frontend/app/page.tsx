import { Suspense } from "react";
import { ExploreWorkspace } from "@/components/catalog/explore-workspace";
import { LoadingState } from "@/components/shared/query-state";

export default function HomePage() {
  return <main id="main-content"><Suspense fallback={<div className="page-shell"><LoadingState /></div>}><ExploreWorkspace /></Suspense></main>;
}
