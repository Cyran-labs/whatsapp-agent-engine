import { screen, within } from '@testing-library/react';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { ConnectGuideMeta } from '../connect-guide-meta';
import type { GuidePath } from '../guide-paths';
import { renderIntl } from './helpers';

const g = fr.connections.connectFlow.guideMeta;
const FIELDS = { waba: <p>Champ WABA</p>, token: <p>Champ jeton</p>, secret: <p>Champ secret</p>, name: <p>Champ nom</p> };

function renderGuide(locale: 'fr' | 'en' = 'fr', path: GuidePath = 'existing') {
  return renderIntl(
    <ConnectGuideMeta
      businessStep={<p>Étape du portefeuille</p>}
      locked={false}
      path={path}
      onPathChange={() => undefined}
      choiceId="choix"
      pathError={null}
      businessId="1270659448489249"
      wabaId="1122051030798254"
      fields={FIELDS}
    />,
    locale,
  );
}

// spec R1 §6.1 : WABAGENT inscrit lui-même les webhooks, le guide n'en parle plus.
test.each(['existing', 'scratch'] as const)('le guide Meta ne parle plus de webhook (chemin %s)', (path) => {
  const { container, unmount } = renderGuide('fr', path);
  expect(container.textContent).not.toMatch(/webhook/i);
  expect(container.textContent).not.toMatch(/jeton de vérification/i);
  unmount();
  const english = renderGuide('en', path);
  expect(english.container.textContent).not.toMatch(/webhook/i);
  expect(english.container.textContent).not.toMatch(/verify token|verification token/i);
});

// Spec R2a §5.1 : l'étape du portefeuille d'abord, puis le choix du chemin et ses étapes.
test('étape du portefeuille avant le choix du chemin et les étapes', () => {
  renderGuide();
  const business = screen.getByText('Étape du portefeuille');
  const choice = screen.getByRole('radiogroup', { name: g.paths.label });
  const steps = screen.getByRole('list', { name: g.label });
  expect(business.compareDocumentPosition(choice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(choice.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(steps).toHaveTextContent('whatsapp_business_management');
  expect(steps).toHaveTextContent('whatsapp_business_messaging');
  expect(steps).toHaveTextContent("Paramètres de l'app, Général, Clé secrète, Afficher");
});

// Spec R2a §5.1, point 3 : le bloc « Recommandé » de R1 reste en bas, commun aux deux chemins.
test.each(['existing', 'scratch'] as const)('bloc « Recommandé » en bas, commun aux deux chemins (%s)', (path) => {
  renderGuide('fr', path);
  const block = screen.getByRole('list', { name: g.recommended.title });
  const items = within(block).getAllByRole('listitem').map((li) => li.textContent);
  expect(items).toEqual([g.recommended.publish, g.recommended.payment, g.recommended.verification, g.recommended.appSecretProof]);
  expect(g.recommended.payment).toContain('pas celui des publicités');
  expect(g.recommended.appSecretProof).toContain('Paramètres de l\'app, Avancé');
  const steps = screen.getByRole('list', { name: g.label });
  expect(steps.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('liens externes du guide : nouvel onglet, sans référent', () => {
  renderGuide();
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    // Audit P-4 : la seule exception est l'adresse de contact, un lien `mailto:` qui n'ouvre pas de page.
    if (link.getAttribute('href') === 'mailto:tech@wabagent.com') continue;
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

test('interface anglaise : mêmes blocs, textes anglais', () => {
  renderGuide('en');
  const e = en.connections.connectFlow.guideMeta;
  expect(screen.getByRole('list', { name: e.label })).toBeInTheDocument();
  expect(screen.getByText(e.secret.title)).toBeInTheDocument();
  expect(screen.getByRole('list', { name: e.recommended.title })).toBeInTheDocument();
});
