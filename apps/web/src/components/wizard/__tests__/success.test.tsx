import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { Success } from '../success';
import type { WizardState } from '@/lib/bot-draft';

const state: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: { fr: 'Bonjour' }, leadFields: [], entityId: null,
};

test.each([
  ['fr', fr, 'À venir'],
  ['en', en, 'Coming soon'],
] as const)('%s : la connexion WhatsApp est « à venir » sans mention de plan', (locale, messages, label) => {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Success state={state} onHome={() => {}} onEdit={() => {}} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Plan \d/);
});
