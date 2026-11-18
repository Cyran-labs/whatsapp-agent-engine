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

function Harness({ locked, businessId, wabaId, initial }: { locked: boolean; businessId: string | null; wabaId: string | null; initial: GuidePath | null }) {
  const [path, setPath] = useState<GuidePath | null>(initial);
  return (
    <GuidePaths locked={locked} path={path} onPathChange={setPath} choiceId="choix" pathError={null} businessId={businessId} wabaId={wabaId} fields={FIELDS} />
  );
}

function renderPaths(
  { locked = false, businessId = BUSINESS, wabaId = WABA, initial = null, locale = 'fr' }:
  { locked?: boolean; businessId?: string | null; wabaId?: string | null; initial?: GuidePath | null; locale?: 'fr' | 'en' } = {},
) {
  return renderIntl(<Harness locked={locked} businessId={businessId} wabaId={wabaId} initial={initial} />, locale);
}

const steps = () => within(screen.getByRole('list', { name: g.label })).getAllByRole('listitem');
const titles = () => steps().map((s) => s.querySelector('.font-semibold')?.textContent);

// Maquette 03 : chemin 1, la WABA d'abord, l'app ensuite ; chaque saisie dans son étape ; le nom en dernier.
test('chemin 1 « J\'ai déjà un compte WhatsApp Business » : étapes 2 à 7 dans l\'ordre de la maquette 03', () => {
  renderPaths({ initial: 'existing' });
  expect(screen.getByRole('radio', { name: new RegExp(g.paths.existing.title) })).toBeChecked();
  expect(titles()).toEqual([g.waba.title, `${g.number.title} ${g.optional}`, g.app.linkedTitle, g.token.title, g.secret.title, g.account.title]);
  const list = steps();
  expect(within(list[0]!).getByLabelText('champ WABA')).toBeInTheDocument();
  expect(list[0]).toHaveTextContent(g.waba.warning);
  // Recette R1 du 13 nov. 2026 (relecture du guide par François), ruling R-24 : l'avertissement ne dit plus qu'aucun
  // identifiant d'une adresse Meta ne convient (asset_id de WhatsApp Manager est le WABA ID) et nomme l'ID du
  // portefeuille, l'autre valeur à ne pas saisir.
  expect(g.waba.warning).not.toMatch(/adresse/);
  expect(g.waba.warning).toContain('portefeuille');
  expect(list[1]).toHaveTextContent(g.dedicatedTitle);
  expect(list[2]).toHaveTextContent('Sans app, créez-la et choisissez ce compte.');
  expect(within(list[3]!).getByLabelText('champ jeton')).toBeInTheDocument();
  expect(within(list[4]!).getByLabelText('champ secret')).toBeInTheDocument();
  expect(within(list[5]!).getByLabelText('champ nom')).toBeInTheDocument();
  expect(list.map((li) => li.querySelector('[aria-hidden="true"]')?.textContent)).toEqual(['2', '3', '4', '5', '6', '7']);
});

// Maquette 03 : chemin 2, l'app d'abord (c'est elle qui fait naître la WABA), puis la WABA créée par Meta.
test('chemin 2 « Je pars de zéro » : l\'app d\'abord, puis la WABA créée par Meta, le numéro de test suffit', async () => {
  renderPaths({ initial: 'existing' });
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(g.paths.scratch.title) }));
  expect(titles()).toEqual([g.app.title, g.waba.createdTitle, `${g.number.title} ${g.optional}`, g.token.title, g.secret.title, g.account.title]);
  const list = steps();
  expect(list[0]).toHaveTextContent('Meta crée alors un compte WhatsApp et un numéro de test.');
  expect(within(list[1]!).getByLabelText('champ WABA')).toBeInTheDocument();
  expect(list[2]).toHaveTextContent('Le numéro de test suffit pour essayer.');
});

// Spec R2a §5.1, point 4 : les liens viennent de metaLinks ; un lien `precise: false` garde son texte générique. Recette
// R2a du 18 nov. 2026 (RF-1) : le lien des utilisateurs système ouvre la page du portefeuille, sous son nom.
test('guide : liens précis avec le portefeuille, génériques sans', () => {
  const { unmount } = renderPaths({ initial: 'existing' });
  // Recette R2a du 18 nov. 2026 (RF-2) : WhatsApp Manager du portefeuille, où l'adresse de la page du compte donne le WABA ID.
  expect(screen.getByRole('link', { name: g.waba.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${BUSINESS}`,
  );
  expect(screen.getByRole('link', { name: g.number.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${BUSINESS}&asset_id=${WABA}`,
  );
  const token = steps()[3]!;
  expect(within(token).getByRole('link', { name: g.token.link })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/settings/system_users?business_id=${BUSINESS}`,
  );
  expect(token).toHaveTextContent("Paramètres de l'entreprise, Utilisateurs, Utilisateurs système");
  expect(g.token.link).toBe('Ouvrir les utilisateurs système ↗');
  for (const link of screen.getAllByRole('link', { name: g.app.link })) {
    expect(link).toHaveAttribute('href', 'https://developers.facebook.com/apps/');
  }
  expect(screen.queryByRole('link', { name: g.waba.link })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: g.number.link })).not.toBeInTheDocument();
  unmount();

  renderPaths({ initial: 'existing', businessId: null, wabaId: null });
  expect(within(steps()[0]!).getByRole('link', { name: g.waba.link })).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/home/');
  expect(within(steps()[1]!).getByRole('link', { name: g.number.link })).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/phone-numbers/');
  expect(screen.getByRole('link', { name: g.token.link })).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
  expect(screen.queryByRole('link', { name: g.waba.linkPrecise })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: g.number.linkPrecise })).not.toBeInTheDocument();
});

test('portefeuille sans WABA encore saisie : la page des numéros reste générique', () => {
  renderPaths({ initial: 'existing', wabaId: null });
  expect(screen.getByRole('link', { name: g.waba.linkPrecise })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: g.number.link })).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/phone-numbers/');
});

// Recette R2a du 18 nov. 2026 (RF-2) : texte de l'étape validé mot pour mot par François ; le chemin 2 dit la même chose
// pour le compte que Meta vient de créer.
test('étape du WABA ID : adresse de WhatsApp Manager à coller, « ID du compte de messagerie » en seconde source (RF-2)', () => {
  expect(g.waba.hint).toBe(
    "Ouvrez WhatsApp Manager, choisissez le compte WhatsApp et collez ici l'adresse de la page : WABAGENT y lit l'identifiant du compte. Vous le trouvez aussi dans votre app Meta : Cas d'utilisation, Personnaliser, Configuration de base, sous « ID du compte de messagerie ».",
  );
  for (const hint of [g.waba.hint, g.waba.createdHint]) {
    expect(hint).toContain('WhatsApp Manager');
    expect(hint).toContain('« ID du compte de messagerie »');
    // La page des Paramètres « Comptes WhatsApp » n'affiche jamais le WABA ID : elle n'est plus citée.
    expect(hint).not.toContain('Comptes WhatsApp');
  }
  renderPaths({ initial: 'existing' });
  expect(steps()[0]).toHaveTextContent(g.waba.hint);
});

test('liens externes : nouvel onglet, sans référent', () => {
  renderPaths({ initial: 'existing' });
  for (const link of screen.getAllByRole('link')) {
    // Audit P-4 : la seule exception est l'adresse de contact, un lien `mailto:` qui n'ouvre pas de page.
    if (link.getAttribute('href') === 'mailto:tech@wabagent.com') continue;
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

// Maquette 01 : la suite du guide est grisée tant que le portefeuille n'est pas reconnu ; la raison est dite en clair,
// hors de la zone grisée (un élément sans effet dit pourquoi).
test('guide : suite grisée sans portefeuille, saisies et choix du chemin inactifs, raison dite', () => {
  const { container } = renderPaths({ initial: 'existing', locked: true, businessId: null, wabaId: null });
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
  const { container } = renderPaths({ initial: 'existing' });
  const zone = container.querySelector('fieldset') as HTMLFieldSetElement;
  expect(zone).toBeEnabled();
  expect(zone).not.toHaveAttribute('inert');
  expect(screen.queryByText(g.locked)).not.toBeInTheDocument();
  expect(screen.getByLabelText('champ WABA')).toBeEnabled();
});

const OTHER_PROVIDER_FR = 'Votre compte WhatsApp est géré par un autre prestataire (360dialog, Twilio…) ? Écrivez-nous à tech@wabagent.com.';
const OTHER_PROVIDER_EN = 'Is your WhatsApp account managed by another provider (360dialog, Twilio…)? Write to us at tech@wabagent.com.';
const otherProviderLine = (text: string) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);

// Spec R2a §5.1, point 3 : pas de parcours dans ce lot. Audit des décisions R2a, P-4 (décision de François du 18 nov.
// 2026) : la ligne donne un moyen de contact réel, l'adresse tech@wabagent.com en lien `mailto:`, seul lien de la ligne.
test.each(['existing', 'scratch'] as const)('chemin %s : ligne « autre prestataire » avec l\'adresse de contact en lien mailto (audit P-4)', (initial) => {
  renderPaths({ initial });
  const line = otherProviderLine(OTHER_PROVIDER_FR);
  expect(line.closest('a')).toBeNull();
  const links = within(line).getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveTextContent('tech@wabagent.com');
  expect(links[0]).toHaveAttribute('href', 'mailto:tech@wabagent.com');
});

test('interface anglaise : choix et étapes en anglais', () => {
  renderPaths({ initial: 'existing', locale: 'en' });
  const e = en.connections.connectFlow.guideMeta;
  expect(screen.getByRole('radiogroup', { name: e.paths.label })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: e.label })).toHaveTextContent(e.waba.title);
  expect(within(otherProviderLine(OTHER_PROVIDER_EN)).getByRole('link', { name: 'tech@wabagent.com' })).toHaveAttribute('href', 'mailto:tech@wabagent.com');
});

// Rulings R-22 et R-23 : sans chemin choisi, seules les deux cartes, rien de coché, et la phrase qui dit pourquoi.
test('sans chemin choisi : deux cartes non cochées, la phrase, aucune étape', async () => {
  renderPaths({ initial: null });
  const group = screen.getByRole('radiogroup', { name: g.paths.label });
  for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
  expect(screen.getByText(g.paths.choose)).toBeInTheDocument();
  expect(group).toHaveAccessibleDescription(g.paths.choose);
  expect(screen.queryByRole('list', { name: g.label })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('champ WABA')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(g.paths.existing.title) }));
  expect(screen.queryByText(g.paths.choose)).not.toBeInTheDocument();
  expect(screen.getByRole('list', { name: g.label })).toBeInTheDocument();
});

// Ruling R-25 (corrige R-23) : la ligne aide à choisir, elle est donc sous les deux cartes avant tout choix.
test('sans chemin : la ligne autre prestataire est visible', () => {
  renderPaths({ initial: null });
  const line = otherProviderLine(OTHER_PROVIDER_FR);
  const group = screen.getByRole('radiogroup', { name: g.paths.label });
  expect(group.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(line.closest('a')).toBeNull();
  expect(within(line).getByRole('link', { name: 'tech@wabagent.com' })).toHaveAttribute('href', 'mailto:tech@wabagent.com');
  expect(screen.queryByRole('list', { name: g.label })).not.toBeInTheDocument();
});

// Audit des décisions R2a, P-11 (texte 2) : avant la reconnaissance, la phrase ne promet les pages du portefeuille qu'aux
// liens vers Meta Business Suite.
test('suite grisée : la phrase ne promet les pages du portefeuille qu\'aux liens de Meta Business Suite (audit P-11)', () => {
  expect(g.locked).toBe(
    "La suite s'ouvre une fois le portefeuille reconnu : les liens vers Meta Business Suite ouvriront alors les pages de ce portefeuille.",
  );
  expect(en.connections.connectFlow.guideMeta.locked).toBe(
    "The next steps open once the portfolio is recognised: links to Meta Business Suite will then open this portfolio's pages.",
  );
  renderPaths({ initial: null, locked: true, businessId: null, wabaId: null });
  expect(screen.getByText(g.locked)).toBeInTheDocument();
});
