import type { Metadata } from "next";
import { PublishWizard } from "@/components/publish/publish-wizard";

export const metadata: Metadata = { title: "Publicar dataset" };

export default function PublishPage() { return <PublishWizard />; }
