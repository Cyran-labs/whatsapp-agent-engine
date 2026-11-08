import { createHash, timingSafeEqual } from 'crypto';

/**
 * Égalité de deux chaînes en temps constant, quelle que soit leur longueur : les deux valeurs sont
 * d'abord ramenées à une empreinte de même taille, puis comparées sans court-circuit.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB) && a.length === b.length;
}
