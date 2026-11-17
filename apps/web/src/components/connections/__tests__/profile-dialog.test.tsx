import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { WHATSAPP_VERTICALS, type WhatsAppBusinessProfileView } from '@wabagent/contracts';
import fr from '../../../../messages/fr.json';
import { ProfileDialog } from '../profile-dialog';
import { accountView, numberView } from './fixtures';
import { engineError, json, renderIntl, stubFetch, type Call } from './helpers';

// Lot R2a, tâche 9 : fenêtre « Profil WhatsApp » d'un numéro (spec R2a §5.2, maquette 04).

beforeEach(() => {
  vi.restoreAllMocks();
});

const PROFILE_URL = '/api/whatsapp-accounts/4/numbers/8/profile';

function profileView(over: Partial<WhatsAppBusinessProfileView> = {}): WhatsAppBusinessProfileView {
  return {
    about: 'Réponse en quelques minutes',
    description: 'Boutique en ligne de vêtements.',
    address: '12 rue des Lilas, 75011 Paris',
    email: 'contact@exemple.fr',
    websites: ['https://exemple.fr'],
    vertical: 'APPAREL',
    photo_url: null,
    read_at: '2026-11-17T10:00:00.000Z',
    ...over,
  };
}

function renderDialog(handler: (call: Call) => Response | Promise<Response>) {
  const calls = stubFetch(handler);
  const onClose = vi.fn();
  const onChanged = vi.fn();
  renderIntl(<ProfileDialog account={accountView({ id: 4 })} number={numberView({ id: 8 })} onClose={onClose} onChanged={onChanged} />);
  return { calls, onClose, onChanged };
}

const field = (name: string, exact = false) => screen.getByLabelText(name, { exact, selector: 'input, textarea, select' });

test('fenêtre : squelette pendant la lecture', async () => {
  let release: (res: Response) => void = () => undefined;
  renderDialog(() => new Promise<Response>((resolve) => { release = resolve; }));
  const dialog = screen.getByRole('dialog', { name: 'Profil WhatsApp du +33 6 12 45 78 90' });
  expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(dialog.querySelector('[data-skeleton]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
  release(json(profileView()));
  expect(await screen.findByDisplayValue('Réponse en quelques minutes')).toBeInTheDocument();
});

// Revue finale M-b (PO-2) : « 1er » pour le premier jour du mois.
test('fenêtre : date de lecture le premier jour du mois, « 1er »', async () => {
  renderDialog(() => json(profileView({ read_at: '2026-12-01T10:00:00.000Z' })));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  expect(screen.getByText(/^Lu chez Meta le 1er déc\. 2026/)).toBeInTheDocument();
});

test('fenêtre : lecture en échec, Réessayer', async () => {
  let attempt = 0;
  const { calls } = renderDialog(() => {
    attempt += 1;
    return attempt === 1
      ? engineError(422, 'WA_VALIDATION_FAILED', 'Meta ne répond pas.', [{ path: '_transient', message: 'Meta ne répond pas.' }], 'whatsapp_account.meta_unavailable')
      : json(profileView());
  });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(fr.errors.reasons.whatsapp_account.meta_unavailable);
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByDisplayValue('Réponse en quelques minutes')).toBeInTheDocument();
  expect(calls.map((c) => [c.method, c.url])).toEqual([['GET', PROFILE_URL], ['GET', PROFILE_URL]]);
});

test('fenêtre : lecture en échec sur un numéro retiré, raison lisible', async () => {
  renderDialog(() => engineError(409, 'CONFLICT', 'Ce numéro a été retiré chez Meta.', undefined, 'whatsapp_account.number_removed'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce numéro a été retiré chez Meta.');
  expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
});

test('fenêtre : champs dans l\'ordre de la maquette, compteurs en caractères (emoji compris), secteur en français', async () => {
  renderDialog(() => json(profileView({ about: 'Salut 😀' })));
  await screen.findByDisplayValue('Salut 😀');
  const labels = [...screen.getByRole('dialog').querySelectorAll('[data-profile-field]')].map((el) => el.getAttribute('data-profile-field'));
  expect(labels).toEqual(['photo', 'about', 'description', 'vertical', 'address', 'email', 'websites']);
  // « Salut 😀 » : 7 caractères (l'emoji compte pour 1), pas 8 unités UTF-16.
  expect(screen.getByText('7 / 139')).toBeInTheDocument();
  expect(screen.getByText('31 / 512')).toBeInTheDocument();
  expect((field('Secteur') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Vêtements et accessoires');
  expect(screen.getByText('2 au plus')).toBeInTheDocument();
});

test('fenêtre : seuls les champs modifiés sont envoyés, champ vidé compris', async () => {
  const { calls } = renderDialog((call) =>
    call.method === 'PUT'
      ? json(profileView({ about: 'Réponse sous 1 h (relu)', description: '', vertical: 'RETAIL' }))
      : json(profileView()),
  );
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.clear(field('Infos'));
  await userEvent.type(field('Infos'), 'Réponse sous 1 h');
  await userEvent.clear(field('Description'));
  await userEvent.selectOptions(field('Secteur'), 'RETAIL');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(put.url).toBe(PROFILE_URL);
  expect(put.body).toEqual({ about: 'Réponse sous 1 h', description: '', vertical: 'RETAIL' });
  // Version relue affichée, avec l'avis de réussite.
  expect(await screen.findByText('Profil enregistré chez Meta.')).toBeInTheDocument();
  expect(field('Infos')).toHaveValue('Réponse sous 1 h (relu)');
});

test('fenêtre : site web retiré envoyé comme liste vide, second site ajouté', async () => {
  const { calls } = renderDialog((call) => (call.method === 'PUT' ? json(profileView({ websites: [] })) : json(profileView())));
  await screen.findByDisplayValue('https://exemple.fr');
  await userEvent.clear(field('Site web', true));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ websites: [] });
  await screen.findByText('Profil enregistré chez Meta.');
  // Le second site ne s'ajoute qu'après un premier site rempli (2 au plus).
  expect(screen.queryByRole('button', { name: 'Ajouter un second site' })).not.toBeInTheDocument();
  await userEvent.type(field('Site web', true), 'https://exemple.fr');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter un second site' }));
  expect(field('Second site web')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ajouter un second site' })).not.toBeInTheDocument();
});

test('fenêtre : rien de modifié, rien n\'est envoyé et la fenêtre le dit', async () => {
  const { calls } = renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Aucun changement à enregistrer.')).toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
});

test('fenêtre : infos vides, le texte le dit et l\'enregistrement est bloqué', async () => {
  const { calls } = renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.clear(field('Infos'));
  expect(screen.getByText('Les infos ne peuvent pas être vides.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  expect(field('Infos')).toHaveFocus();
  expect(field('Infos')).toHaveAttribute('aria-invalid', 'true');
});

test('fenêtre : e-mail mal formé refusé avant l\'envoi', async () => {
  const { calls } = renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('contact@exemple.fr');
  await userEvent.clear(field('E-mail'));
  await userEvent.type(field('E-mail'), 'contact@exemple');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Adresse e-mail invalide.')).toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
});

test('fenêtre : texte trop long, compteur et refus avant l\'envoi', async () => {
  const { calls } = renderDialog(() => json(profileView({ address: '' })));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.click(field('Adresse'));
  await userEvent.paste('a'.repeat(257));
  expect(screen.getByText('257 / 256')).toBeInTheDocument();
  expect(screen.getByText('256 caractères au plus.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
});

test('fenêtre : un refus de champ s\'affiche sous le champ', async () => {
  renderDialog((call) =>
    call.method === 'PUT'
      ? engineError(400, 'VALIDATION_ERROR', 'Adresse refusée.', [{ path: 'address', message: 'Adresse refusée.' }])
      : json(profileView()),
  );
  await screen.findByDisplayValue('12 rue des Lilas, 75011 Paris');
  await userEvent.type(field('Adresse'), ' bis');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const message = await screen.findByText('Adresse refusée.');
  const input = field('Adresse');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input.getAttribute('aria-describedby') ?? '').toContain(message.id);
  expect(screen.queryByText('Profil enregistré chez Meta.')).not.toBeInTheDocument();
});

test('fenêtre : refus de Meta sans champ désigné, en tête de la fenêtre avec le texte de Meta replié', async () => {
  renderDialog((call) =>
    call.method === 'PUT'
      ? json({ error: { code: 'WA_VALIDATION_FAILED', message: 'Meta a renvoyé une erreur', details: [{ path: 'profile', message: 'Meta a renvoyé une erreur', provider_text: 'Param about is invalid' }] } }, 422)
      : json(profileView()),
  );
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.type(field('Infos'), '!');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Meta a renvoyé une erreur');
  expect(screen.getByText('Param about is invalid')).toBeInTheDocument();
  expect(screen.getByText('Texte renvoyé par le fournisseur')).toBeInTheDocument();
});

// Ruling R-17 : écriture confirmée par Meta, relecture en échec : un avis, jamais « non enregistré ».
test('fenêtre : profil enregistré mais relecture en échec, avis sans erreur', async () => {
  const text = fr.errors.reasons.whatsapp_account.profile_saved_unread;
  renderDialog((call) =>
    call.method === 'PUT'
      ? engineError(422, 'WA_VALIDATION_FAILED', text, [{ path: 'profile', message: text }], 'whatsapp_account.profile_saved_unread')
      : json(profileView()),
  );
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.type(field('Infos'), '!');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const notice = await screen.findByText(text);
  const status = notice.closest('[role="status"]');
  expect(status).not.toBeNull();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // Ruling R-28 : ton d'avertissement, ni réussite ni erreur ; revue finale M-c : sur fond ambre doux, lisible en sombre.
  expect(status).toHaveClass('text-warning-ink', 'bg-warning-soft');
  expect(status).not.toHaveClass('text-success-ink');
  expect(status).not.toHaveClass('text-danger');
});

test('photo : enregistrée mais relecture en échec, avis d\'avertissement, ni réussite ni erreur', async () => {
  const text = fr.errors.reasons.whatsapp_account.profile_saved_unread;
  renderDialog((call) =>
    call.method === 'POST'
      ? engineError(422, 'WA_VALIDATION_FAILED', text, [{ path: 'profile', message: text }], 'whatsapp_account.profile_saved_unread')
      : json(profileView()),
  );
  await screen.findByDisplayValue('Réponse en quelques minutes');
  await userEvent.upload(screen.getByLabelText('Changer la photo'), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' }));
  const status = (await screen.findByText(text)).closest('[role="status"]');
  // Revue finale M-c : l'encre d'avertissement n'est lisible que sur son fond (thème sombre compris).
  expect(status).toHaveClass('text-warning-ink', 'bg-warning-soft');
  expect(status).not.toHaveClass('text-success-ink');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('fenêtre : l\'aperçu suit la saisie', async () => {
  renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  const preview = screen.getByRole('region', { name: 'Aperçu : ce que voit le contact' });
  expect(within(preview).getByText('Boutique Marais')).toBeInTheDocument();
  expect(within(preview).getByText('Vêtements et accessoires')).toBeInTheDocument();
  await userEvent.clear(field('Description'));
  await userEvent.type(field('Description'), 'Livraison en 48 h');
  expect(within(preview).getByText('Livraison en 48 h')).toBeInTheDocument();
  await userEvent.selectOptions(field('Secteur'), 'RETAIL');
  expect(within(preview).getByText('Commerce de détail')).toBeInTheDocument();
  expect(within(preview).getByText(/le rendu exact dépend de l'application WhatsApp du contact/)).toBeInTheDocument();
});

test('photo : gif refusé avant l\'envoi, avec la raison', async () => {
  const { calls } = renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText('Changer la photo'), new File(['GIF89a'], 'logo.gif', { type: 'image/gif' }));
  expect(await screen.findByText(fr.errors.reasons.whatsapp_account.photo_invalid)).toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
});

test('photo : fichier de plus de 5 Mo refusé avant l\'envoi', async () => {
  const { calls } = renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Changer la photo'), big);
  expect(await screen.findByText(fr.errors.reasons.whatsapp_account.photo_invalid)).toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
});

test('photo : PNG envoyé tel quel, aperçu depuis la photo relue', async () => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return init?.method === 'POST' ? json(profileView({ photo_url: 'https://pps.whatsapp.net/v/photo.jpg' })) : json(profileView());
  }));
  renderIntl(<ProfileDialog account={accountView({ id: 4 })} number={numberView({ id: 8 })} onClose={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByDisplayValue('Réponse en quelques minutes');
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Changer la photo'), file);
  expect(await screen.findByText('Photo enregistrée chez Meta.')).toBeInTheDocument();
  const post = sent.find((s) => s.init?.method === 'POST')!;
  expect(post.url).toBe(`${PROFILE_URL}/photo`);
  expect(new Headers(post.init?.headers).get('content-type')).toBe('image/png');
  expect(post.init?.body).toBe(file);
  const images = screen.getAllByRole('img', { name: 'Photo du profil' });
  expect(images.length).toBeGreaterThan(0);
  for (const img of images) expect(img).toHaveAttribute('src', 'https://pps.whatsapp.net/v/photo.jpg');
});

// Ruling R-27 : libellés français des 22 secteurs de Meta, à valider par François en recette.
test('secteur : les 22 valeurs de Meta, chacune avec son libellé, sans option vide quand le secteur est connu', async () => {
  renderDialog(() => json(profileView()));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  const options = [...(field('Secteur') as HTMLSelectElement).options];
  expect(options.map((o) => o.value)).toEqual([...WHATSAPP_VERTICALS]);
  expect(options.every((o) => o.textContent !== '' && o.textContent !== o.value)).toBe(true);
});

test('secteur inconnu de la liste : « Non renseigné », et rien n\'est envoyé pour le secteur tant qu\'il n\'est pas choisi', async () => {
  const { calls } = renderDialog((call) => (call.method === 'PUT' ? json(profileView({ vertical: '' })) : json(profileView({ vertical: '' }))));
  await screen.findByDisplayValue('Réponse en quelques minutes');
  expect((field('Secteur') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Non renseigné');
  await userEvent.type(field('Infos'), '!');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ about: 'Réponse en quelques minutes!' });
});

test('fenêtre : profil non réglable pour ce compte, raison lisible', async () => {
  renderDialog(() => engineError(409, 'CONFLICT', 'Texte du moteur.', undefined, 'whatsapp_account.profile_unsupported'));
  expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.reasons.whatsapp_account.profile_unsupported);
});

test('fenêtre : panne du moteur à la lecture, texte de la fenêtre et référence, jamais « Erreur interne. »', async () => {
  renderDialog(() => json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-42' } }, 500));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Lecture du profil impossible. Réessayez.');
  expect(alert).toHaveTextContent('req-42');
  expect(alert).not.toHaveTextContent('Erreur interne.');
});
