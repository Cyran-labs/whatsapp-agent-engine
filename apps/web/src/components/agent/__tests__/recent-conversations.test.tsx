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

const person = (over: Partial<RecentRow>): RecentRow => ({ phone: '+33611111111', name: null, last: '+33611111111', qualified: false, when: '', ...over });
const avatars = (container: HTMLElement) => [...container.querySelectorAll('[data-avatar]')];

// prototype 7 : initiales des deux premiers mots du nom, jamais deux caractères du nom ni des chiffres du numéro
test('initiales : premières lettres des deux premiers mots du nom (« Marie Curie » donne « MC »)', () => {
  const { container } = renderRows([
    person({ name: 'Marie Curie', last: 'Marie Curie' }),
    person({ name: 'jean-paul de la Tour', last: 'jean-paul de la Tour' }),
    person({ name: 'Zoé', last: 'Zoé' }),
  ]);
  expect(avatars(container).map((a) => a.textContent)).toEqual(['MC', 'JD', 'Z']);
});

// prototype 7 : sans nom, une icône de contact, jamais des chiffres tirés du numéro (entier ou masqué par le moteur)
test('sans nom : icône de contact au lieu d\'initiales, jamais des chiffres ; la ligne montre le numéro reçu', () => {
  const { container } = renderRows([person({ phone: '+336 •• •• •• 11', last: '+336 •• •• •• 11' }), person({ phone: '+33622222222', last: '+33622222222' })]);
  expect(avatars(container)).toHaveLength(2);
  for (const avatar of avatars(container)) {
    expect(avatar.textContent).toBe('');
    expect(avatar.querySelector('svg')).not.toBeNull();
  }
  expect(screen.getByText('+336 •• •• •• 11')).toBeInTheDocument();
  expect(screen.getByText('+33622222222')).toBeInTheDocument();
});

// spec 10.3 : « voir tout » était un texte inerte, retiré tant que la page Conversations et leads n'existe pas
test('aucun « voir tout »', () => {
  renderRows([person({ name: 'Marie Curie', last: 'Marie Curie' })]);
  expect(screen.queryByText(/voir tout/i)).not.toBeInTheDocument();
});

// A-14, non-régression : deux numéros masqués peuvent être égaux, la clé de ligne ne suppose pas un numéro unique
test('non-régression : deux lignes au même numéro masqué sont toutes deux affichées, sans avertissement de clé', () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderRows([person({ phone: '+336 •• •• •• 11', last: '+336 •• •• •• 11' }), person({ phone: '+336 •• •• •• 11', last: '+336 •• •• •• 11' })]);
  expect(screen.getAllByText('+336 •• •• •• 11')).toHaveLength(2);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

// recette 3.3 : initiales en vert de marque (text-brand) sur --surface-subtle, illisibles en sombre
test('initiales en --fg sur --surface-subtle, jamais en couleur de marque', () => {
  const { container } = renderRows([row('2026-11-09 20:09:02')]);
  const avatar = avatars(container)[0]!.className.split(' ');
  expect(avatar).toContain('bg-surface-subtle');
  expect(avatar).toContain('text-fg');
  expect(avatar.some((c) => /^text-brand/.test(c))).toBe(false);
});
