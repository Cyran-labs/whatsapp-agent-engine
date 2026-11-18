import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { BusinessStep } from '../business-step';
import { renderIntl } from './helpers';

const b = fr.connections.connectFlow.guideMeta.business;
const BUSINESS = '1270659448489249';
const WABA = '1122051030798254';
const MANAGER = `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${BUSINESS}&asset_id=${WABA}`;

function Harness({ error = null }: { error?: string | null }) {
  const [value, setValue] = useState('');
  return <BusinessStep id="business" value={value} onChange={setValue} error={error} />;
}

function renderStep(locale: 'fr' | 'en' = 'fr', error: string | null = null) {
  return renderIntl(<Harness error={error} />, locale);
}

const field = () => screen.getByLabelText(b.field);

// Maquette 01, variante A (spec R2a §5.1, point 2) : un seul champ, l'aide « Où trouver l'identifiant ? » dépliée dessous,
// avec le schéma dessiné (pas une image) de la page « Informations sur le portefeuille business » et le lien vers elle.
test('étape 1 : un seul champ, aide dépliée avec le schéma dessiné de la page Meta', () => {
  const { container } = renderStep();
  const step = screen.getByRole('list', { name: b.title });
  expect(within(step).getAllByRole('textbox')).toHaveLength(1);
  expect(field()).toHaveAttribute('autocomplete', 'off');
  const help = container.querySelector('details');
  expect(help).toHaveAttribute('open');
  expect(within(help as HTMLElement).getByText(b.help)).toBeInTheDocument();
  const schema = within(help as HTMLElement).getByRole('figure', { name: b.schema.label });
  expect(schema).toHaveTextContent(b.schema.title);
  expect(schema).toHaveTextContent(b.schema.name);
  expect(schema).toHaveTextContent(b.schema.id);
  expect(schema.querySelector('img')).toBeNull();
  expect(help).toHaveTextContent(b.helpPath);
  // Sans portefeuille reconnu, le lien est générique (metaLinks, precise: false) et garde son texte générique.
  const link = within(help as HTMLElement).getByRole('link', { name: b.link });
  expect(link).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// Revue finale M-a (PO-1) : sans ligatures, « https:// » ne s'affiche jamais « https: / » dans le champ ni dans le schéma.
test('étape 1 : champ et identifiant du schéma en chasse fixe sans ligatures', () => {
  renderStep();
  expect(field()).toHaveClass('font-mono', '[font-variant-ligatures:none]');
  const schema = screen.getByRole('figure', { name: b.schema.label });
  const id = within(schema).getByText((_, el) => el?.tagName === 'DD' && el.classList.contains('font-mono'));
  expect(id).toHaveClass('[font-variant-ligatures:none]');
});

// Spec R2a §5.1, point 2, et §12 : contrôle de forme seulement, aucun nom de portefeuille à l'étape 1.
test('étape 1 : identifiant seul reconnu, « Portefeuille <identifiant> reconnu » sans nom, lien précis', async () => {
  renderStep();
  await userEvent.type(field(), BUSINESS);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent(b.recognised.replace('{business}', BUSINESS));
  expect(status).not.toHaveTextContent(/Wabagent/);
  expect(screen.queryByText(b.wabaFound.replace('{waba}', WABA))).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: b.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`,
  );
  expect(screen.queryByRole('link', { name: b.link })).not.toBeInTheDocument();
  expect(field()).not.toHaveAttribute('aria-invalid');
});

test('étape 1 : adresse de WhatsApp Manager, portefeuille reconnu et compte WhatsApp repéré', async () => {
  renderStep();
  await userEvent.click(field());
  await userEvent.paste(MANAGER);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent(b.recognised.replace('{business}', BUSINESS));
  expect(status).toHaveTextContent(b.wabaFound.replace('{waba}', WABA));
});

// Ruling du contrôleur (tâche 8) : une adresse collée sans schéma n'est pas reconnue par extractMetaIds.
test('étape 1 : adresse sans schéma, « Adresse non reconnue » à la sortie du champ, relié au champ', async () => {
  renderStep();
  await userEvent.click(field());
  await userEvent.paste(`business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`);
  expect(screen.queryByText(b.unrecognised)).not.toBeInTheDocument();
  await userEvent.tab();
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(field()).toHaveAccessibleDescription(new RegExp(b.unrecognised.replace(/[.()…]/g, '\\$&')));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // Ruling R-32 (revue finale M-f) : texte unique d'une adresse non reconnue.
  expect(b.unrecognised).toBe(
    "Adresse non reconnue : collez l'adresse d'une page de Meta Business Suite qui contient l'ID du portefeuille, ou l'identifiant seul.",
  );
});

test('interface anglaise : adresse non reconnue, texte anglais fidèle (ruling R-32)', async () => {
  renderStep('en');
  const e = en.connections.connectFlow.guideMeta.business;
  expect(e.unrecognised).toBe('Address not recognised: paste the address of a Meta Business Suite page that contains the portfolio ID, or the ID alone.');
  await userEvent.click(screen.getByLabelText(e.field));
  await userEvent.paste('business.facebook.com/latest/settings');
  await userEvent.tab();
  expect(screen.getByLabelText(e.field)).toHaveAccessibleDescription(new RegExp(e.unrecognised.replace(/[.()…]/g, '\\$&')));
});

test('étape 1 : un refus posé par le formulaire est affiché sous le champ', () => {
  renderStep('fr', b.required);
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(field()).toHaveAccessibleDescription(new RegExp(b.required.replace(/[.()…]/g, '\\$&')));
});

test('interface anglaise : textes anglais', async () => {
  renderStep('en');
  const e = en.connections.connectFlow.guideMeta.business;
  expect(screen.getByRole('list', { name: e.title })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(e.field), BUSINESS);
  expect(screen.getByRole('status')).toHaveTextContent(e.recognised.replace('{business}', BUSINESS));
});

// Un refus du moteur sur le portefeuille (champ `business_id`) reste dit même quand la forme est reconnue.
test('étape 1 : un refus du formulaire reste dit à côté de « reconnu »', async () => {
  function WithError() {
    const [value, setValue] = useState(BUSINESS);
    return <BusinessStep id="business" value={value} onChange={setValue} error="Refus du moteur sur le portefeuille." />;
  }
  renderIntl(<WithError />);
  expect(screen.getByRole('status')).toHaveTextContent(b.recognised.replace('{business}', BUSINESS));
  expect(field()).toHaveAttribute('aria-invalid', 'true');
  expect(field()).toHaveAccessibleDescription(/Refus du moteur sur le portefeuille\./);
});

// Audit des décisions R2a, P-11 (texte 1) : sans étiquette « précis » ou « générique », la phrase ne promet que ce qui est
// vrai : les liens vers Meta Business Suite ouvrent les pages du portefeuille, ceux de Meta for Developers restent généraux.
test('étape 1 : « reconnu » dit quels liens ouvrent les pages du portefeuille (audit P-11)', async () => {
  expect(b.recognised).toBe(
    'Portefeuille {business} reconnu. Les liens vers Meta Business Suite ouvrent ses pages ; ceux de Meta for Developers restent généraux.',
  );
  expect(en.connections.connectFlow.guideMeta.business.recognised).toBe(
    'Portfolio {business} recognised. Links to Meta Business Suite open its pages; those to Meta for Developers stay general.',
  );
  renderStep();
  await userEvent.type(field(), BUSINESS);
  expect(screen.getByRole('status')).toHaveTextContent(
    `Portefeuille ${BUSINESS} reconnu. Les liens vers Meta Business Suite ouvrent ses pages ; ceux de Meta for Developers restent généraux.`,
  );
});
