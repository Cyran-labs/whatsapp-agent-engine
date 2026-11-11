import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Stepper, StepCounter, STEP_COUNT, type StepIndex } from '../stepper';
import { describedBy } from '@/components/connections/__tests__/helpers';

function renderStepper(current: StepIndex | 'success', furthest: StepIndex, onGo = vi.fn()) {
  render(<NextIntlClientProvider locale="fr" messages={messages}><Stepper current={current} furthest={furthest} onGo={onGo} /></NextIntlClientProvider>);
  return onGo;
}

test('cinq étapes verticales, chacune avec sa ligne de description (spec 12.1)', () => {
  renderStepper(1, 1);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(5);
  const expected = [
    ['Identité', 'Nom, entité, langues'],
    ['Personnalité', 'Rôle, ton, accueil, informations'],
    ['Tester', 'Simulation'],
    ['Numéro', 'Numéro WhatsApp'],
    ['Activer', 'Contrôles et Whitelist'],
  ];
  expected.forEach(([label, hint], i) => {
    expect(items[i]).toHaveTextContent(label!);
    expect(items[i]).toHaveTextContent(hint!);
  });
  expect(screen.getByRole('list', { name: "Étapes de l'assistant" })).toBeInTheDocument();
});

test('l\'étape courante est marquée et n\'est pas un bouton', () => {
  renderStepper(4, 4);
  const items = screen.getAllByRole('listitem');
  expect(items[3]).toHaveAttribute('aria-current', 'step');
  expect(items[3]).toHaveTextContent('Numéro (en cours)');
  items.forEach((item, i) => { if (i !== 3) expect(item).not.toHaveAttribute('aria-current'); });
  expect(screen.queryByRole('button', { name: /Numéro/ })).not.toBeInTheDocument();
});

// prototype 6 : une étape atteinte est cliquable
test('étape déjà atteinte : bouton qui y mène, cochée si elle précède l\'étape la plus avancée', async () => {
  const onGo = renderStepper(2, 4);
  const identity = screen.getByRole('button', { name: /Identité \(terminée\)/ });
  expect(identity).toHaveTextContent('✓');
  await userEvent.click(identity);
  expect(onGo).toHaveBeenCalledWith(1);
  // L'étape la plus avancée, quittée pour revenir en arrière, est « à reprendre ».
  await userEvent.click(screen.getByRole('button', { name: /Numéro \(à reprendre\)/ }));
  expect(onGo).toHaveBeenCalledWith(4);
});

// prototype 6 : une étape à venir n'est pas cliquable et dit pourquoi au survol et au focus
test('étape à venir : grisée, non cliquable, sa raison au focus', async () => {
  const onGo = renderStepper(2, 2);
  const later = screen.getByRole('link', { name: /Tester \(à venir\)/ });
  expect(later).toHaveAttribute('aria-disabled', 'true');
  expect(later).not.toHaveAttribute('href');
  act(() => later.focus());
  expect(describedBy(later)).toHaveTextContent("Disponible après « Créer et tester » à l'étape Personnalité : c'est là que l'agent IA est créé.");
  expect(describedBy(later)).toBeVisible();
  await userEvent.click(later);
  expect(onGo).not.toHaveBeenCalled();
  expect(describedBy(screen.getByRole('link', { name: /Activer \(à venir\)/ }))).toHaveTextContent("Disponible après le choix d'un numéro à l'étape Numéro.");
});

test('raisons des étapes à venir depuis l\'étape 1', () => {
  renderStepper(1, 1);
  expect(describedBy(screen.getByRole('link', { name: /Personnalité/ }))).toHaveTextContent("Disponible après l'étape Identité : nommez l'agent IA puis « Continuer ».");
  expect(describedBy(screen.getByRole('link', { name: /Numéro/ }))).toHaveTextContent("Disponible après l'étape Tester.");
});

test('assistant terminé : plus aucune étape cliquable, la raison le dit', async () => {
  const onGo = renderStepper('success', 5);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  const identity = screen.getByRole('link', { name: /Identité/ });
  expect(identity).toHaveAttribute('aria-disabled', 'true');
  expect(describedBy(identity)).toHaveTextContent("L'assistant est terminé : la suite se règle sur la page de l'agent IA.");
  await userEvent.click(identity);
  expect(onGo).not.toHaveBeenCalled();
  expect(screen.getAllByRole('listitem').every((item) => !item.hasAttribute('aria-current'))).toBe(true);
});

test('les coches sont masquées aux lecteurs d\'écran', () => {
  renderStepper(3, 3);
  const check = screen.getAllByText('✓')[0]!;
  expect(check).toHaveAttribute('aria-hidden', 'true');
});

test('le compteur d\'étape dérive son total du stepper', () => {
  expect(STEP_COUNT).toBe(5);
  render(<StepCounter step={4} />);
  expect(screen.getByText(`4 / ${STEP_COUNT}`)).toBeInTheDocument();
});
