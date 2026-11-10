import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import messages from '../../../messages/fr.json';
import { StatusPanel } from '@/components/agent/status-panel';
import { botView } from '@/components/agent/__tests__/fixtures';

// getRequestConfig renvoie sa fonction telle quelle : la configuration réelle de request.ts est lisible en test.
vi.mock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }));

type RequestConfig = (params: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; timeZone?: string }>;

async function loadConfig() {
  const mod = (await import('../request')) as unknown as { default: RequestConfig };
  return mod.default({ requestLocale: Promise.resolve('fr') });
}

// Le poste de test n'est pas à Paris : le fuseau doit venir de la configuration, pas de la machine.
const initialTz = process.env.TZ;
beforeEach(() => { process.env.TZ = 'America/New_York'; });
afterEach(() => { if (initialTz === undefined) delete process.env.TZ; else process.env.TZ = initialTz; });

// revue finale 2b-3, fuseau
test('la configuration de next-intl fixe le fuseau Europe/Paris', async () => {
  expect((await loadConfig()).timeZone).toBe('Europe/Paris');
});

// revue finale 2b-3, fuseau
test('une date ISO à 23 h 30 UTC s\'affiche à 00 h 30 le lendemain, heure de Paris', async () => {
  const config = await loadConfig();
  render(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone={config.timeZone}>
      <StatusPanel bot={botView({ unserved: { count: 2, last_at: '2026-11-09T23:30:00.000Z' } })} canEdit onChanged={vi.fn()} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/2 messages non servis, le dernier le 10 nov\. 2026.*00:30/)).toBeInTheDocument();
});
