/**
 * Équité LLM par client en mode platform.
 *
 * Un limiter de concurrence (p-limit) par clientId : au-delà de N appels en vol
 * pour un client, les suivants attendent leur tour — JAMAIS rejetés. C'est un
 * ordonnanceur d'équité, pas un interrupteur (exigence UX : on ne coupe pas une
 * conversation, on la fait patienter).
 *
 * Compteurs en mémoire. L'interface FairQueue est extraite pour permettre un
 * backend partagé (multi-instance) plus tard sans toucher aux appelants.
 */

import pLimit, { type LimitFunction } from 'p-limit';
import { config } from '../core/config.js';

export interface FairQueue {
  run<T>(clientId: string, fn: () => Promise<T>): Promise<T>;
}

export function makeClientFairQueue(concurrency?: number): FairQueue {
  const limiters = new Map<string, LimitFunction>();

  function limiterFor(clientId: string): LimitFunction {
    let lim = limiters.get(clientId);
    if (!lim) {
      const n = concurrency ?? config.llm.clientConcurrency;
      lim = pLimit(n);
      limiters.set(clientId, lim);
    }
    return lim;
  }

  return {
    run<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
      return limiterFor(clientId)(fn);
    },
  };
}

export const clientFairQueue: FairQueue = makeClientFairQueue();
