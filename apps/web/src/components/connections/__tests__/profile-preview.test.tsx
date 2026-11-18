import { screen, within } from '@testing-library/react';
import { test, expect } from 'vitest';
import type { WhatsAppBusinessProfileView } from '@wabagent/contracts';
import fr from '../../../../messages/fr.json';
import { draftOf, type ProfileDraft } from '../profile-draft';
import { ProfilePreview } from '../profile-preview';
import { renderIntl } from './helpers';

// Recette R2a du 18 nov. 2026 (RC-3, décision de François) : l'aperçu côté contact affichait un site ou un e-mail que le
// champ refusait (« Adresse du site invalide. », « Adresse e-mail invalide. »). Il n'affiche plus une valeur que la
// validation de son champ refuse et qui ne partira donc pas chez Meta.

const p = fr.connections.profile.preview;

function fromMeta(over: Partial<WhatsAppBusinessProfileView> = {}): WhatsAppBusinessProfileView {
  return {
    about: 'Réponse en quelques minutes', description: 'Boutique en ligne.', address: '12 rue des Lilas', email: 'contact@exemple.fr',
    websites: ['https://exemple.fr'], vertical: 'APPAREL', photo_url: null, read_at: '2026-11-17T10:00:00.000Z', ...over,
  };
}

function renderPreview(baseline: ProfileDraft, draft: ProfileDraft) {
  renderIntl(<ProfilePreview displayName="Boutique Marais" baseline={baseline} draft={draft} photoUrl={null} />);
  return screen.getByRole('region', { name: p.title });
}

test('site et e-mail refusés par leur champ : absents de l\'aperçu, les valeurs valides restent (RC-3)', () => {
  const baseline = draftOf(fromMeta());
  const preview = renderPreview(baseline, { ...baseline, email: 'pas-un-email', websites: ['Notre boutique', 'https://second.fr'] });
  expect(preview).not.toHaveTextContent('pas-un-email');
  expect(preview).not.toHaveTextContent('Notre boutique');
  expect(within(preview).queryByText(p.email)).not.toBeInTheDocument();
  expect(within(preview).getByText('https://second.fr')).toBeInTheDocument();
  expect(within(preview).getAllByText(p.website)).toHaveLength(1);
  expect(within(preview).getByText('Boutique en ligne.')).toBeInTheDocument();
});

test('même règle pour tout champ refusé par la même validation : infos et description trop longues (RC-3)', () => {
  const baseline = draftOf(fromMeta());
  const longAbout = 'a'.repeat(140);
  const longDescription = 'd'.repeat(513);
  const preview = renderPreview(baseline, { ...baseline, about: longAbout, description: longDescription, address: 'x'.repeat(257) });
  expect(preview).not.toHaveTextContent(longAbout);
  expect(preview).not.toHaveTextContent(longDescription);
  expect(within(preview).queryByText(p.address)).not.toBeInTheDocument();
  expect(within(preview).getByText('contact@exemple.fr')).toBeInTheDocument();
});

test('valeur saisie redevenue valide : de nouveau dans l\'aperçu (RC-3)', () => {
  const baseline = draftOf(fromMeta());
  const preview = renderPreview(baseline, { ...baseline, email: 'nouveau@exemple.fr', websites: ['wabagent.com'] });
  expect(within(preview).getByText('nouveau@exemple.fr')).toBeInTheDocument();
  expect(within(preview).getByText('wabagent.com')).toBeInTheDocument();
});

// Revue finale M-e : une valeur non touchée telle que Meta la rend n'est pas envoyée, le contact la voit : l'aperçu la garde.
test('valeur non touchée telle que Meta la rend, hors des règles de WABAGENT : gardée dans l\'aperçu (RC-3)', () => {
  const baseline = draftOf(fromMeta({ websites: ['Notre boutique'], email: 'ancien@exemple' }));
  const preview = renderPreview(baseline, { ...baseline, description: 'Autre description' });
  expect(within(preview).getByText('Notre boutique')).toBeInTheDocument();
  expect(within(preview).getByText('ancien@exemple')).toBeInTheDocument();
});
