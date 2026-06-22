/**
 * SimulateService — squelette minimal (Task 3).
 * Task 6 étoffettera la logique de simulation complète.
 */

export interface SimulateServiceDeps {
  chatFn?: unknown;
}

export class SimulateService {
  constructor(_deps: SimulateServiceDeps = {}) {
    void _deps;
  }

  async simulate(): Promise<{ session_id: string; reply: string; model: string }> {
    return { session_id: '', reply: '', model: 'claude-haiku-4-5-20251001' };
  }
}
