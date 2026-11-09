/** Masque un numéro E.164 : `+` et cinq premiers chiffres, puis les deux derniers (`+33612 •• •• 78`). */
export function maskNumber(n: string): string {
  if (!n) return '';
  return n.length > 7 ? `${n.slice(0, 6)} •• •• ${n.slice(-2)}` : n;
}
