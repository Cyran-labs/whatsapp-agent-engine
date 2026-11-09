import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { StatusPill } from '../status-pill';

const wrap = (s: string) => render(<NextIntlClientProvider locale="fr" messages={messages}><StatusPill status={s} /></NextIntlClientProvider>);

test('active → libellé Actif + classe succès', () => {
  const { container } = wrap('active');
  expect(screen.getByText('Actif')).toBeInTheDocument();
  expect(container.querySelector('.bg-success-soft')).toBeTruthy();
});
test('draft → Brouillon', () => { wrap('draft'); expect(screen.getByText('Brouillon')).toBeInTheDocument(); });
test('paused → En pause', () => { wrap('paused'); expect(screen.getByText('En pause')).toBeInTheDocument(); });
test('limited → Accès limité + famille ambre (distincte de Actif)', () => {
  const { container } = wrap('limited');
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(container.querySelector('.bg-warning-soft')).toBeTruthy();
  expect(container.querySelector('.bg-success-soft')).toBeNull();
});
