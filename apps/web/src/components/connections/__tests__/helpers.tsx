import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Refus du moteur tel que le BFF le relaie : `{ error: { code, message, details? } }`. */
export const engineError = (
  status: number,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
  reason?: string,
): Response => json({ error: { code, message, ...(details ? { details } : {}), ...(reason ? { reason } : {}) } }, status);

/** Remplace `fetch` : chaque appel est enregistré, la réponse vient de `handler`. */
export function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

export function renderIntl(ui: React.ReactNode, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Élément désigné par `aria-describedby` d'un contrôle (sa raison ou son indice). */
export function describedBy(control: HTMLElement): HTMLElement {
  const id = control.getAttribute('aria-describedby');
  const target = id === null ? null : document.getElementById(id);
  if (target === null) throw new Error(`[Test] aria-describedby absent ou sans cible sur « ${control.textContent} »`);
  return target;
}

/**
 * Contraste (revue finale 2b-3) : la raison d'un bouton désactivé et les indices utiles sont en `text-muted`, pas en
 * `text-muted-2` (trop pâle pour un texte qui explique). Le jeton lui-même n'est pas modifié.
 */
export function isReadableMuted(el: Element): boolean {
  return el.classList.contains('text-muted') && !el.classList.contains('text-muted-2');
}
