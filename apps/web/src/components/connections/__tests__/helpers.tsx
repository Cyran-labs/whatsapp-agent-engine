import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';

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
): Response => json({ error: { code, message, ...(details ? { details } : {}) } }, status);

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

export function renderIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
