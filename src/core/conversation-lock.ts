/**
 * Verrou en mémoire par conversation (audit 5.7).
 *
 * Les traitements d'une même clé, (numéro destinataire, contact), s'exécutent l'un après l'autre,
 * dans l'ordre d'arrivée ; deux clés différentes tournent en parallèle. Mono-instance : un déploiement
 * à plusieurs instances demandera un verrou partagé (voir les points différés du plan 1 moteur).
 */

// Dernier maillon de la file de chaque clé. Ne rejette jamais : une erreur ne bloque pas les suivants.
const tails = new Map<string, Promise<void>>();

/**
 * Exécute `fn` après tous les traitements déjà en file pour `key`.
 * La promesse renvoyée suit le résultat de `fn` (l'erreur est propagée à l'appelant).
 * La clé est oubliée quand la file se vide.
 */
export function withConversationLock(key: string, fn: () => Promise<void>): Promise<void> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Nombre de clés ayant une file en cours (supervision et tests). */
export function lockedConversationCount(): number {
  return tails.size;
}
