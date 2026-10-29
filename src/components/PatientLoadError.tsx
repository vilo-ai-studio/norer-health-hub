import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function PatientLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        No se pudo actualizar la lista de pacientes. Si ves datos anteriores, pueden no estar al día.
        <Button variant="outline" className="ml-3" onClick={onRetry}>Volver a intentar</Button>
      </AlertDescription>
    </Alert>
  );
}
