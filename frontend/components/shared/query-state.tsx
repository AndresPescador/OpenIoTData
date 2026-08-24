import { AlertTriangle, Database, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingState({ label = "Preparando datos" }: { label?: string }) {
  return (
    <div className="query-state query-state--loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>Estamos organizando la vista sin bloquear la navegación.</span>
      </div>
    </div>
  );
}

export function ErrorState({ retry, message = "No pudimos cargar esta información." }: { retry?: () => void; message?: string }) {
  return (
    <div className="query-state query-state--error" role="alert">
      <AlertTriangle aria-hidden="true" size={23} />
      <div>
        <strong>{message}</strong>
        <span>Comprueba la conexión o vuelve a intentarlo. Los datos existentes no se han modificado.</span>
      </div>
      {retry ? (
        <Button variant="secondary" size="small" onClick={retry}>
          <RotateCw aria-hidden="true" size={16} /> Volver a intentar
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ clear }: { clear?: () => void }) {
  return (
    <div className="query-state query-state--empty">
      <Database aria-hidden="true" size={28} />
      <div>
        <strong>No hay datasets para esta combinación.</strong>
        <span>Prueba una región más amplia o elimina uno de los filtros.</span>
      </div>
      {clear ? <Button variant="secondary" size="small" onClick={clear}>Limpiar filtros</Button> : null}
    </div>
  );
}
