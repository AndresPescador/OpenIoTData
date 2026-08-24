import type { Metadata } from "next";
import { AdminView } from "@/components/admin/admin-view";

export const metadata: Metadata = { title: "Moderación" };

export default function AdminPage() { return <AdminView />; }
