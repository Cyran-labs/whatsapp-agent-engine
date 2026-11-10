import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { StatusPill } from '../status-pill';

const wrap = (s: string) => render(<NextIntlClientProvider locale="fr" messages={messages}><StatusPill status={s} /></NextIntlClientProvider>);

test('active → libellé Ouvert à tous + classe succès', () => {
  const { container } = wrap('active');
  expect(screen.getByText('Ouvert à tous')).toBeInTheDocument();
  expect(container.querySelector('.bg-success-soft')).toBeTruthy();
});
test('draft → Brouillon', () => { wrap('draft'); expect(screen.getByText('Brouillon')).toBeInTheDocument(); });
// recette Q-1
test('paused → Désactivé', () => { wrap('paused'); expect(screen.getByText('Désactivé')).toBeInTheDocument(); });
// audit R-23
test('unknown → Statut inconnu, jamais Brouillon', () => {
  wrap('unknown');
  expect(screen.getByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
});
test('limited → Accès limité + famille ambre (distincte de Ouvert à tous)', () => {
  const { container } = wrap('limited');
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(container.querySelector('.bg-warning-soft')).toBeTruthy();
  expect(container.querySelector('.bg-success-soft')).toBeNull();
});
