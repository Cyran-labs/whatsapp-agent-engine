/**
 * Refus d'un champ, affiché sous le champ (audit §5.1). Le champ porte `aria-invalid` et `aria-describedby={id}` :
 * le message est lu avec le champ, sans annonce séparée. Rien n'est rendu sans message.
 */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-[12.5px] text-danger">
      {message}
    </p>
  );
}
