import { screen, within } from '@testing-library/react';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { ConnectGuideMeta } from '../connect-guide-meta';
import { renderIntl } from './helpers';

const g = fr.connections.connectFlow.guideMeta;

function renderGuide(locale: 'fr' | 'en' = 'fr') {
  return renderIntl(<ConnectGuideMeta><p>Champs du formulaire</p></ConnectGuideMeta>, locale);
}

// spec R1 §6.1 : WABAGENT inscrit lui-même les webhooks, le guide n'en parle plus.
test('le guide Meta ne parle plus de webhook', () => {
  const { container, unmount } = renderGuide();
  expect(container.textContent).not.toMatch(/webhook/i);
  expect(container.textContent).not.toMatch(/jeton de vérification/i);
  unmount();
  const english = renderGuide('en');
  expect(english.container.textContent).not.toMatch(/webhook/i);
  expect(english.container.textContent).not.toMatch(/verify token|verification token/i);
});

test('cinq étapes obligatoires dans l\'ordre de la spec, la saisie dans la dernière', () => {
  renderGuide();
  const steps = within(screen.getByRole('list', { name: g.label })).getAllByRole('listitem');
  expect(steps.map((s) => s.querySelector('.font-semibold')?.textContent)).toEqual([
    g.app.title, g.number.title, g.token.title, g.waba.title, g.secret.title,
  ]);
  expect(steps[1]).toHaveTextContent(g.dedicatedTitle);
  expect(steps[2]).toHaveTextContent('whatsapp_business_management');
  expect(steps[2]).toHaveTextContent('whatsapp_business_messaging');
  expect(steps[3]).toHaveTextContent(g.waba.warning);
  expect(steps[4]).toHaveTextContent('Paramètres de l\'app, Général, Clé secrète, Afficher');
  expect(within(steps[4]!).getByText('Champs du formulaire')).toBeInTheDocument();
});

test('bloc « Recommandé » signalé comme tel : publier, paiement, vérification d\'entreprise, « Clé requise »', () => {
  renderGuide();
  const block = screen.getByRole('list', { name: g.recommended.title });
  const items = within(block).getAllByRole('listitem').map((li) => li.textContent);
  expect(items).toEqual([g.recommended.publish, g.recommended.payment, g.recommended.verification, g.recommended.appSecretProof]);
  expect(g.recommended.payment).toContain('pas celui des publicités');
  expect(g.recommended.appSecretProof).toContain('Paramètres de l\'app, Avancé');
});

test('liens externes du guide : nouvel onglet, sans référent', () => {
  renderGuide();
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(screen.getByRole('link', { name: g.token.link })).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
});

test('interface anglaise : mêmes étapes, textes anglais', () => {
  renderGuide('en');
  const e = en.connections.connectFlow.guideMeta;
  expect(screen.getByRole('list', { name: e.label })).toBeInTheDocument();
  expect(screen.getByText(e.secret.title)).toBeInTheDocument();
  expect(screen.getByRole('list', { name: e.recommended.title })).toBeInTheDocument();
});
