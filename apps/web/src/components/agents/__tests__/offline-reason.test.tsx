import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { OfflineReason } from '../offline-reason';

const wrap = (raw: string | null) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}><OfflineReason raw={raw} /></NextIntlClientProvider>);

// spec 6.1 : Offline toujours suivi de son motif
test.each([
  [null, 'Arrêté par un administrateur'],
  ['number_removed', 'Numéro retiré'],
  ['number_unassigned', 'Numéro débranché'],
  ['archived_by_script', 'Arrêté'],
])('motif %s → « %s »', (raw, text) => {
  const { container } = wrap(raw);
  expect(container.textContent).toBe(text);
});

test('motif inconnu : jamais le code brut', () => {
  const { container } = wrap('archived_by_script');
  expect(container.textContent).not.toContain('archived_by_script');
  expect(screen.getByText('Arrêté')).toBeInTheDocument();
});
