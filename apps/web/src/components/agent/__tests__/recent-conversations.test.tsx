import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, test, vi } from 'vitest';
import en from '../../../../messages/en.json';
import fr from '../../../../messages/fr.json';
import { RecentConversations, type RecentRow } from '../recent-conversations';

function renderRows(rows: RecentRow[], locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en} timeZone="Europe/Paris">
      <RecentConversations rows={rows} onRetry={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

const row = (when: string): RecentRow => ({ phone: '+33611111111', name: 'Marie', last: 'Marie', qualified: false, when });

// recette 10 nov. 2026 : la date s'affichait brute (« 2026-11-09 20:09:02 », UTC) au lieu de « 9 nov. 2026, 21:09 ».
test('date du moteur sans fuseau (UTC) : affichée en heure de Paris, comme les autres dates', () => {
  renderRows([row('2026-11-09 20:09:02')]);
  expect(screen.getByText('9 nov. 2026, 21:09')).toBeInTheDocument();
  expect(screen.queryByText(/2026-11-09/)).not.toBeInTheDocument();
});

test('date ISO avec Z : même affichage ; en été, UTC+2', () => {
  renderRows([row('2026-11-09T20:09:02.000Z'), row('2026-07-01 10:00:00')]);
  expect(screen.getByText('9 nov. 2026, 21:09')).toBeInTheDocument();
  expect(screen.getByText('1 juil. 2026, 12:00')).toBeInTheDocument();
});

test('en anglais : format anglais, toujours à Paris', () => {
  renderRows([row('2026-11-09 20:09:02')], 'en');
  expect(screen.getByText('Nov 9, 2026, 9:09 PM')).toBeInTheDocument();
});

test('date absente ou illisible : rien d\'affiché, jamais le texte brut', () => {
  renderRows([row(''), row('hier')]);
  expect(screen.queryByText('hier')).not.toBeInTheDocument();
});
