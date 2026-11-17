import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { GuidePaths, type GuidePath } from '../guide-paths';
import { renderIntl } from './helpers';

const g = fr.connections.connectFlow.guideMeta;
const BUSINESS = '1270659448489249';
const WABA = '1122051030798254';

const FIELDS = {
  waba: <input aria-label="champ WABA" />,
  token: <input aria-label="champ jeton" />,
  secret: <input aria-label="champ secret" />,
  name: <input aria-label="champ nom" />,
};

function Harness({ locked, businessId, wabaId, initial }: { locked: boolean; businessId: string | null; wabaId: string | null; initial: GuidePath }) {
  const [path, setPath] = useState<GuidePath>(initial);
  return <GuidePaths locked={locked} path={path} onPathChange={setPath} businessId={businessId} wabaId={wabaId} fields={FIELDS} />;
}

function renderPaths(
  { locked = false, businessId = BUSINESS, wabaId = WABA, initial = 'existing', locale = 'fr' }:
  { locked?: boolean; businessId?: string | null; wabaId?: string | null; initial?: GuidePath; locale?: 'fr' | 'en' } = {},
) {
  return renderIntl(<Harness locked={locked} businessId={businessId} wabaId={wabaId} initial={initial} />, locale);
}

const steps = () => within(screen.getByRole('list', { name: g.label })).getAllByRole('listitem');
const titles = () => steps().map((s) => s.querySelector('.font-semibold')?.textContent);

// Maquette 03 : chemin 1, la WABA d'abord, l'app ensuite ; chaque saisie dans son étape ; le nom en dernier.
test('chemin 1 « J\'ai déjà un compte WhatsApp Business » : étapes 2 à 7 dans l\'ordre de la maquette 03', () => {
  renderPaths();
  expect(screen.getByRole('radio', { name: new RegExp(g.paths.existing.title) })).toBeChecked();
  expect(titles()).toEqual([g.waba.title, `${g.number.title} ${g.optional}`, g.app.linkedTitle, g.token.title, g.secret.title, g.account.title]);
  const list = steps();
  expect(within(list[0]!).getByLabelText('champ WABA')).toBeInTheDocument();
  expect(list[0]).toHaveTextContent(g.waba.warning);
  expect(list[1]).toHaveTextContent(g.dedicatedTitle);
  expect(list[2]).toHaveTextContent('Sans app, créez-la et choisissez ce compte.');
  expect(within(list[3]!).getByLabelText('champ jeton')).toBeInTheDocument();
  expect(within(list[4]!).getByLabelText('champ secret')).toBeInTheDocument();
  expect(within(list[5]!).getByLabelText('champ nom')).toBeInTheDocument();
  expect(list.map((li) => li.querySelector('[aria-hidden="true"]')?.textContent)).toEqual(['2', '3', '4', '5', '6', '7']);
});

// Maquette 03 : chemin 2, l'app d'abord (c'est elle qui fait naître la WABA), puis la WABA créée par Meta.
test('chemin 2 « Je pars de zéro » : l\'app d\'abord, puis la WABA créée par Meta, le numéro de test suffit', async () => {
  renderPaths();
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(g.paths.scratch.title) }));
  expect(titles()).toEqual([g.app.title, g.waba.createdTitle, `${g.number.title} ${g.optional}`, g.token.title, g.secret.title, g.account.title]);
  const list = steps();
  expect(list[0]).toHaveTextContent('Meta crée alors un compte WhatsApp et un numéro de test.');
  expect(within(list[1]!).getByLabelText('champ WABA')).toBeInTheDocument();
  expect(list[2]).toHaveTextContent('Le numéro de test suffit pour essayer.');
});

// Spec R2a §5.1, point 4 : les liens viennent de metaLinks ; un lien `precise: false` garde son texte générique. Ruling
// R-9bis et du contrôleur : le lien des utilisateurs système n'est jamais présenté comme la page exacte.
test('guide : liens précis avec le portefeuille, génériques sans', () => {
  const { unmount } = renderPaths();
  expect(screen.getByRole('link', { name: g.waba.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/settings/whatsapp_business_presence/?business_id=${BUSINESS}`,
  );
  expect(screen.getByRole('link', { name: g.number.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${BUSINESS}&asset_id=${WABA}`,
  );
  const token = steps()[3]!;
  expect(within(token).getByRole('link', { name: g.token.link })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`,
  );
  expect(token).toHaveTextContent("Paramètres de l'entreprise, Utilisateurs, Utilisateurs système");
  expect(g.token.link).toBe('Ouvrir les paramètres du portefeuille ↗');
  for (const link of screen.getAllByRole('link', { name: g.app.link })) {
    expect(link).toHaveAttribute('href', 'https://developers.facebook.com/apps/');
  }
  expect(screen.queryByRole('link', { name: g.waba.link })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: g.number.link })).not.toBeInTheDocument();
  unmount();

  renderPaths({ businessId: null, wabaId: null });
  expect(screen.getByRole('link', { name: g.waba.link })).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
  expect(screen.getByRole('link', { name: g.number.link })).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/phone-numbers/');
  expect(screen.getByRole('link', { name: g.token.link })).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
  expect(screen.queryByRole('link', { name: g.waba.linkPrecise })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: g.number.linkPrecise })).not.toBeInTheDocument();
});

test('portefeuille sans WABA encore saisie : la page des numéros reste générique', () => {
  renderPaths({ wabaId: null });
  expect(screen.getByRole('link', { name: g.waba.linkPrecise })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: g.number.link })).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/phone-numbers/');
});

test('liens externes : nouvel onglet, sans référent', () => {
  renderPaths();
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

// Maquette 01 : la suite du guide est grisée tant que le portefeuille n'est pas reconnu ; la raison est dite en clair,
// hors de la zone grisée (un élément sans effet dit pourquoi).
test('guide : suite grisée sans portefeuille, saisies et choix du chemin inactifs, raison dite', () => {
  const { container } = renderPaths({ locked: true, businessId: null, wabaId: null });
  const zone = container.querySelector('fieldset') as HTMLFieldSetElement;
  expect(zone).toBeDisabled();
  expect(zone).toHaveAttribute('inert');
  expect(zone.className).toMatch(/opacity/);
  for (const radio of within(zone).getAllByRole('radio')) expect(radio).toBeDisabled();
  expect(screen.getByLabelText('champ WABA')).toBeDisabled();
  expect(screen.getByLabelText('champ nom')).toBeDisabled();
  const note = screen.getByText(g.locked);
  expect(zone.contains(note)).toBe(false);
  expect(note.className).not.toMatch(/opacity/);
  expect(zone).toHaveAccessibleDescription(g.locked);
});

test('portefeuille reconnu : la suite est active, sans la mention', () => {
  const { container } = renderPaths();
  const zone = container.querySelector('fieldset') as HTMLFieldSetElement;
  expect(zone).toBeEnabled();
  expect(zone).not.toHaveAttribute('inert');
  expect(screen.queryByText(g.locked)).not.toBeInTheDocument();
  expect(screen.getByLabelText('champ WABA')).toBeEnabled();
});

// Spec R2a §5.1, point 3 : pas de parcours dans ce lot, aucune page de contact : la ligne est du texte, sans faux lien.
test.each(['existing', 'scratch'] as const)('chemin %s : ligne « autre prestataire », texte simple sans lien', (initial) => {
  renderPaths({ initial });
  const line = screen.getByText(g.otherProvider);
  expect(g.otherProvider).toBe('Votre compte WhatsApp est géré par un autre prestataire (360dialog, Twilio…) ? Contactez-nous.');
  expect(line.closest('a')).toBeNull();
  expect(line.querySelector('a')).toBeNull();
});

test('interface anglaise : choix et étapes en anglais', () => {
  renderPaths({ locale: 'en' });
  const e = en.connections.connectFlow.guideMeta;
  expect(screen.getByRole('radiogroup', { name: e.paths.label })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: e.label })).toHaveTextContent(e.waba.title);
  expect(screen.getByText(e.otherProvider)).toBeInTheDocument();
});
