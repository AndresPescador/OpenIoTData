import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatNumber = (value: number) => new Intl.NumberFormat("es-CO").format(value);

export const formatDate = (value: string, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-CO", options ?? { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`));

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
