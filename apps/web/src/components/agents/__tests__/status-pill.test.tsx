import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { StatusPill } from '../status-pill';
import { STATUS_STYLE } from '../status-style';

const wrap = (s: string, locale: 'fr' | 'en' = 'fr') =>
  render(<NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : en}><StatusPill status={s} /></NextIntlClientProvider>);

// spec 6.1 : les quatre mots, identiques en français et en anglais
test.each([
  ['draft', 'Draft'],
  ['limited', 'Preview'],
  ['active', 'Online'],
  ['paused', 'Offline'],
])('%s → %s, dans les deux langues', (status, word) => {
  const fr = wrap(status);
  expect(screen.getByText(word)).toBeInTheDocument();
  fr.unmount();
  wrap(status, 'en');
  expect(screen.getByText(word)).toBeInTheDocument();
});

test('active → classes de STATUS_STYLE (Online, menthe)', () => {
  const { container } = wrap('active');
  expect(container.firstElementChild?.className).toContain(STATUS_STYLE.active.pill);
  expect(container.querySelector('.bg-success-soft')).toBeTruthy();
});

test('limited → famille ambre, distincte de Online', () => {
  const { container } = wrap('limited');
  expect(container.querySelector('.bg-warning-soft')).toBeTruthy();
  expect(container.querySelector('.bg-success-soft')).toBeNull();
});

// spec 6.2, choix P-5 : Draft et Offline sont deux gris distinguables
test('Draft et Offline : classes distinctes, Draft n\'est plus menthe', () => {
  const draft = wrap('draft');
  const draftClass = draft.container.firstElementChild?.className ?? '';
  draft.unmount();
  const paused = wrap('paused');
  const pausedClass = paused.container.firstElementChild?.className ?? '';
  expect(draftClass).toContain(STATUS_STYLE.draft.pill);
  expect(pausedClass).toContain(STATUS_STYLE.paused.pill);
  expect(draftClass).not.toBe(pausedClass);
  expect(draftClass).not.toContain('bg-accent-soft');
});

// audit R-23
test('unknown → Statut inconnu, jamais Draft', () => {
  wrap('unknown');
  expect(screen.getByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
});

// point d'attention 4 : statut brut inconnu en base, affiché tel quel, jamais traduit en Draft
test('statut brut inconnu (archived) : affiché tel quel', () => {
  wrap('archived');
  expect(screen.getByText('archived')).toBeInTheDocument();
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
});
