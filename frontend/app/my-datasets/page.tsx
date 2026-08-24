import type { Metadata } from "next";
import { MyDatasetsView } from "@/components/account/my-datasets-view";

export const metadata: Metadata = { title: "Mis datasets" };

export default function MyDatasetsPage() { return <MyDatasetsView />; }
