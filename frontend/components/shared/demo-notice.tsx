import { FlaskConical, Info } from "lucide-react";

export function DemoNotice({ notice, compact = false }: { notice?: string; compact?: boolean }) {
  if (!notice) return null;
  const Icon = compact ? FlaskConical : Info;
  return (
    <div className={compact ? "demo-chip" : "demo-notice"} role="status">
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
      <span>{compact ? "Vista con datos ilustrativos" : notice}</span>
    </div>
  );
}
