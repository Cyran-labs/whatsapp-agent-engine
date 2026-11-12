import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import { PeriodChoice } from '../period-choice';

function wrap(value: 7 | 30 | 90, onChange = vi.fn(), locale: 'fr' | 'en' = 'fr') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      <PeriodChoice value={value} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

test('groupe « Période » de trois boutons, seul celui de la période choisie est enfoncé', () => {
  wrap(30);
  const group = screen.getByRole('group', { name: 'Période' });
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['7 j', '30 j', '90 j']);
  expect(within(group).getByRole('button', { name: '30 j' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(group).getByRole('button', { name: '7 j' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(group).getByRole('button', { name: '90 j' })).toHaveAttribute('aria-pressed', 'false');
});

test('un clic sur une période la transmet', async () => {
  const onChange = wrap(30);
  await userEvent.click(screen.getByRole('button', { name: '7 j' }));
  expect(onChange).toHaveBeenCalledWith(7);
  await userEvent.click(screen.getByRole('button', { name: '90 j' }));
  expect(onChange).toHaveBeenLastCalledWith(90);
});

test('anglais : groupe « Period »', () => {
  wrap(7, vi.fn(), 'en');
  expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
});

test('couleurs des jetons du thème seulement, aucune couleur codée en dur', () => {
  wrap(30);
  for (const button of screen.getAllByRole('button')) expect(button.className).not.toMatch(/#[0-9a-f]{3,8}/i);
});
