import type { Metadata } from "next";
import { Suspense } from "react";
import { DatasetDetail } from "@/components/dataset/dataset-detail";
import { LoadingState } from "@/components/shared/query-state";
import { demoDatasets } from "@/lib/demo-data";

export function generateStaticParams() {
  return demoDatasets.map((dataset) => ({ slug: dataset.slug }));
}

function titleFromSlug(slug: string): string {
  const title = slug.replace(/[-_]+/g, " ").trim();
  return title ? title.charAt(0).toLocaleUpperCase("es") + title.slice(1) : "Dataset";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const dataset = demoDatasets.find((item) => item.slug === slug);
  if (dataset) return { title: dataset.title, description: dataset.description };

  const internalApi = process.env.INTERNAL_API_URL?.replace(/\/$/, "");
  if (internalApi) {
    try {
      const response = await fetch(`${internalApi}/datasets/${encodeURIComponent(slug)}`, {
        next: { revalidate: 300 },
      });
      if (response.ok) {
        const published = await response.json() as { title?: string; description?: string };
        if (published.title) return { title: published.title, description: published.description };
      }
    } catch {
      // The page remains usable if catalog metadata is temporarily unavailable.
    }
  }

  return { title: titleFromSlug(slug) };
}

export default async function DatasetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Suspense fallback={<main className="page-shell"><LoadingState /></main>}><DatasetDetail slug={slug} /></Suspense>;
}
