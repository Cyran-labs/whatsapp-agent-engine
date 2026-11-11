import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, test } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Shortcuts } from '../shortcuts';

const wrap = () =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Shortcuts />
    </NextIntlClientProvider>,
  );

// prototype 9 : « ▶ Simuler » est l'action principale de la barre du haut, le raccourci en double est retiré
test('aucun raccourci « Tester dans le simulateur »', () => {
  wrap();
  expect(screen.queryByText(/simulateur/)).not.toBeInTheDocument();
});

// spec 5.4 : « Modifier la personnalité » à venir, grisé, « Soon », non lien, bulle au focus
test('« Modifier la personnalité » en Soon avec sa bulle, jamais « À venir »', async () => {
  wrap();
  const item = screen.getByText('Modifier la personnalité').closest('[aria-disabled="true"]') as HTMLElement;
  expect(item).toHaveTextContent('Soon');
  expect(item).not.toHaveAttribute('href');
  expect(screen.queryByText(/À venir/)).not.toBeInTheDocument();
  item.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Disponible prochainement : modifier la personnalité de cet agent IA.');
});
