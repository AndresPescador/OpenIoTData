"use client";
import { ErrorState } from "@/components/shared/query-state";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="page-shell"><ErrorState retry={reset} /></main>; }
