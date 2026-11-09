/**
 * Verrous en mémoire par clé (audit 5.7).
 *
 * Les traitements d'une même clé s'exécutent l'un après l'autre, dans l'ordre d'arrivée ; deux clés
 * différentes tournent en parallèle. Mono-instance : un déploiement à plusieurs instances demandera un
 * verrou partagé (voir les points différés du plan 1 moteur).
 *
 * Usages : conversation (numéro destinataire, contact) dans le pipeline des messages ; agent IA
 * (organisation, agent IA) pour l'écriture et la relecture de sa configuration en cache.
 */

export interface KeyedLock {
  /**
   * Exécute `fn` après tous les traitements déjà en file pour `key`.
   * La promesse renvoyée suit le résultat de `fn` (l'erreur est propagée à l'appelant).
   * La clé est oubliée quand la file se vide.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Nombre de clés ayant une file en cours (supervision et tests). */
  size(): number;
}

export function createKeyedLock(): KeyedLock {
  // Dernier maillon de la file de chaque clé. Ne rejette jamais : une erreur ne bloque pas les suivants.
  const tails = new Map<string, Promise<void>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous.then(fn);
      const tail = run.then(() => undefined, () => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return run;
    },
    size(): number {
      return tails.size;
    },
  };
}

const conversations = createKeyedLock();

/** Verrou d'une conversation, clé `<numéro destinataire>|<contact>`. */
export function withConversationLock(key: string, fn: () => Promise<void>): Promise<void> {
  return conversations.run(key, fn);
}

/** Nombre de conversations ayant une file en cours (supervision et tests). */
export function lockedConversationCount(): number {
  return conversations.size();
}
