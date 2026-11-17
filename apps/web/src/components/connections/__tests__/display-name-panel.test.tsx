import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach, afterEach, describe } from 'vitest';
import type { DisplayNameRequestView, WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { DisplayNamePanel } from '../display-name-panel';
import { accountView, numberView } from './fixtures';
import { engineError, json, stubFetch } from './helpers';

// Lot R2a, tâche 9 : encart « Nom affiché » de la fenêtre du profil (spec R2a §5.3 et §13.2, maquette 04 partie 3).

// Date du navigateur fixée avant la date limite des demandes (2 déc. 2026) : la phrase « délai probablement dépassé »
// (ruling R-31) ne dépend jamais du jour où les tests tournent.
const BEFORE_DEADLINE = new Date('2026-11-20T12:00:00.000Z');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BEFORE_DEADLINE);
});

afterEach(() => {
  vi.useRealTimers();
});

const APPLY_URL = '/api/whatsapp-accounts/4/numbers/8/display-name/apply';
const REQUEST_URL = '/api/whatsapp-accounts/4/numbers/8/display-name';
const MANAGER_PRECISE = 'https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=1270659448489249&asset_id=104829371625544';
const RULES_URL = 'https://www.facebook.com/business/help/757569725593362';

function request(over: Partial<DisplayNameRequestView> = {}): DisplayNameRequestView {
  return {
    requested_name: 'Boutique Marais Paris',
    status: 'approved_pending',
    rejection_reason: null,
    requested_at: '2026-11-17T12:00:00.000Z',
    approved_at: '2026-11-18T12:00:00.000Z',
    apply_before: '2026-12-02T12:00:00.000Z',
    apply_before_approx: false,
    ...over,
  };
}

const ACCOUNT = accountView({ id: 4, business: { id: '1270659448489249', name: 'Wabagent' } });

function renderPanel(number: WhatsAppNumberView, account: WhatsAppAccountView = ACCOUNT, locale: 'fr' | 'en' = 'fr') {
  const onNumberChanged = vi.fn();
  const onBusyChange = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en} timeZone="Europe/Paris">
      <DisplayNamePanel account={account} number={number} onNumberChanged={onNumberChanged} onBusyChange={onBusyChange} />
    </NextIntlClientProvider>,
  );
  return { onNumberChanged, onBusyChange };
}

const panel = () => screen.getByRole('region', { name: 'Nom affiché' });
const codeField = () => screen.getByLabelText('Code de vérification en deux étapes');

describe('encart : quatre états', () => {
  test('aucune demande : nom affiché, « Approuvé », rappel des 10 changements, « Demander un autre nom »', () => {
    renderPanel(numberView({ id: 8 }));
    const box = panel();
    expect(within(box).getByText('Boutique Marais')).toBeInTheDocument();
    expect(within(box).getByText('Approuvé')).toBeInTheDocument();
    expect(box).toHaveTextContent('10 changements de nom au plus par période de 30 jours.');
    expect(within(box).getByRole('button', { name: 'Demander un autre nom' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Code de vérification en deux étapes')).not.toBeInTheDocument();
  });

  test('en revue : nom actuel, nom demandé et sa date, phrase de la revue', () => {
    renderPanel(numberView({ id: 8, display_name_request: request({ status: 'in_review', approved_at: null, apply_before: null }) }));
    const box = panel();
    expect(within(box).getByText('Boutique Marais')).toBeInTheDocument();
    expect(within(box).getByText('En revue chez Meta')).toBeInTheDocument();
    expect(box).toHaveTextContent('Nom demandé le 17 nov. 2026 : Boutique Marais Paris.');
    expect(box).toHaveTextContent('Le nom actuel reste affiché pendant la revue. Meta revoit en général en 1 à 2 jours.');
    expect(within(box).queryByRole('button', { name: 'Demander un autre nom' })).not.toBeInTheDocument();
  });

  test('refusé : nom refusé, motif de Meta, lien vers les règles de Meta et « Demander un autre nom »', () => {
    renderPanel(numberView({ id: 8, display_name_request: request({ status: 'rejected', rejection_reason: 'Name does not match brand', approved_at: null, apply_before: null }) }));
    const box = panel();
    expect(within(box).getByText('Nouveau nom refusé')).toBeInTheDocument();
    expect(box).toHaveTextContent('« Boutique Marais Paris » refusé par Meta.');
    expect(box).toHaveTextContent('Name does not match brand');
    const rules = within(box).getByRole('link', { name: 'Règles de Meta ↗' });
    expect(rules).toHaveAttribute('href', RULES_URL);
    expect(rules).toHaveAttribute('target', '_blank');
    expect(within(box).getByRole('button', { name: 'Demander un autre nom' })).toBeInTheDocument();
  });

  test('approuvé, à appliquer : nom approuvé, date limite, champ « Code de vérification en deux étapes » et son aide', () => {
    renderPanel(numberView({ id: 8, display_name_request: request() }));
    const box = panel();
    expect(within(box).getByText('Approuvé, à appliquer')).toBeInTheDocument();
    expect(box).toHaveTextContent('« Boutique Marais Paris » approuvé le 18 nov. 2026.');
    expect(box).toHaveTextContent("Il faut l'appliquer avant le 2 déc. 2026.");
    expect(box).not.toHaveTextContent('environ');
    const code = codeField();
    expect(code).toHaveAttribute('inputmode', 'numeric');
    // Ruling R-28 : champ visible, jamais proposé au gestionnaire de mots de passe du navigateur.
    expect(code).toHaveAttribute('type', 'text');
    expect(code).not.toHaveAttribute('type', 'password');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('maxlength', '6');
    expect(code).toHaveAttribute('pattern', '[0-9]{6}');
    expect(box).toHaveTextContent(
      'Le code à 6 chiffres de la vérification en deux étapes de ce numéro, choisi dans WhatsApp Manager. Code oublié : changez-le dans WhatsApp Manager ↗',
    );
    expect(within(box).getByRole('link', { name: 'WhatsApp Manager ↗' })).toHaveAttribute('href', MANAGER_PRECISE);
    expect(within(box).getByRole('button', { name: 'Appliquer le nouveau nom' })).toBeInTheDocument();
    // Le nom approuvé n'est jamais présenté comme le nom affiché.
    expect(within(box).getByText('Boutique Marais')).toBeInTheDocument();
    expect(box).not.toHaveTextContent(/PIN/);
  });
});

test('approuvé, date d\'approbation observée à la relecture : « environ »', () => {
  renderPanel(numberView({ id: 8, display_name_request: request({ apply_before_approx: true }) }));
  expect(panel()).toHaveTextContent("Il faut l'appliquer avant le 2 déc. 2026 environ.");
});

// Ruling R-26 : `pin_enabled === null` (jamais lu) est traité comme un code actif ; seul `false` dit « aucun code ».
test('approuvé, aucun code actif (pin_enabled false) : texte de la spec §13.2', () => {
  renderPanel(numberView({ id: 8, pin_enabled: false, display_name_request: request() }));
  expect(panel()).toHaveTextContent("Aucun code n'est actif sur ce numéro. Choisissez 6 chiffres et notez-les : Meta peut en faire le code du numéro.");
  expect(panel()).not.toHaveTextContent('Code oublié');
});

test('approuvé, code actif (pin_enabled true) : aide standard', () => {
  renderPanel(numberView({ id: 8, pin_enabled: true, display_name_request: request() }));
  expect(panel()).toHaveTextContent('Code oublié : changez-le dans WhatsApp Manager ↗');
  expect(panel()).not.toHaveTextContent("Aucun code n'est actif");
});

test('appliquer : bouton inactif pendant l\'appel', async () => {
  let release: (res: Response) => void = () => undefined;
  const calls = stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
  const { onBusyChange } = renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '123456');
  const button = screen.getByRole('button', { name: 'Appliquer le nouveau nom' });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await userEvent.click(button);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ url: APPLY_URL, method: 'POST', body: { pin: '123456' } });
  release(json(numberView({ id: 8, display_name: 'Boutique Marais Paris', display_name_request: null })));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});

test('appliquer : champ du code vidé après refus, raison et lien vers WhatsApp Manager', async () => {
  const text = fr.errors.reasons.whatsapp_account.pin_rejected;
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', text, [{ path: 'pin', message: text }], 'whatsapp_account.pin_rejected'));
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const url = window.location.href;
  renderPanel(numberView({ id: 8, pin_enabled: true, display_name_request: request() }));
  await userEvent.type(codeField(), '654321');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(text);
  expect(within(alert).getByRole('link', { name: 'Changer le code dans WhatsApp Manager ↗' })).toHaveAttribute('href', MANAGER_PRECISE);
  expect(codeField()).toHaveValue('');
  // Le code n'est jamais gardé : ni stockage du navigateur, ni adresse.
  expect(setItem).not.toHaveBeenCalled();
  expect(window.location.href).toBe(url);
  expect(document.body.innerHTML).not.toContain('654321');
});

test('appliquer : réussite, champ vidé, état appliqué et numéro relu remonté', async () => {
  const applied = numberView({ id: 8, display_name: 'Boutique Marais Paris', display_name_request: null });
  stubFetch(() => json(applied));
  const { onNumberChanged } = renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  expect(await screen.findByText('Nouveau nom appliqué.')).toBeInTheDocument();
  expect(onNumberChanged).toHaveBeenCalledWith(applied);
});

test('appliquer : code qui n\'a pas 6 chiffres refusé sans appel', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '12345');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  expect(screen.getByText('Le code fait 6 chiffres.')).toBeInTheDocument();
  expect(codeField()).toHaveAttribute('aria-invalid', 'true');
  expect(calls).toEqual([]);
});

test('appliquer : délai dépassé, l\'encart repasse à « Demander un autre nom » avec la phrase qui le dit', async () => {
  const text = fr.errors.reasons.whatsapp_account.name_apply_expired;
  stubFetch(() => engineError(409, 'CONFLICT', text, undefined, 'whatsapp_account.name_apply_expired'));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Demander un autre nom' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Code de vérification en deux étapes')).not.toBeInTheDocument();
});

// Ruling R-31 (revue finale I-1) : Meta ne dit pas toujours qu'une demande a expiré ; passée la date limite (date du
// navigateur), l'encart ne propose plus le code mais une nouvelle demande.
test('approuvé, date limite passée : « probablement dépassé », « Demander un autre nom », plus de champ du code', async () => {
  vi.setSystemTime(new Date('2026-12-02T12:00:01.000Z'));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  const box = panel();
  expect(box).toHaveTextContent('Le délai pour appliquer ce nom est probablement dépassé. Demandez de nouveau ce nom.');
  expect(box).not.toHaveTextContent("Il faut l'appliquer avant");
  expect(screen.queryByLabelText('Code de vérification en deux étapes')).not.toBeInTheDocument();
  expect(within(box).queryByRole('button', { name: 'Appliquer le nouveau nom' })).not.toBeInTheDocument();
  await userEvent.click(within(box).getByRole('button', { name: 'Demander un autre nom' }));
  expect(screen.getByLabelText('Nouveau nom')).toHaveFocus();
});

test('approuvé, date limite pas encore passée : champ du code, sans « probablement dépassé »', () => {
  vi.setSystemTime(new Date('2026-12-02T11:59:59.000Z'));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  expect(panel()).not.toHaveTextContent('probablement dépassé');
  expect(codeField()).toBeInTheDocument();
});

test('approuvé, date limite passée, en anglais : texte anglais, aucun texte français', () => {
  vi.setSystemTime(new Date('2026-12-03T12:00:00.000Z'));
  renderPanel(numberView({ id: 8, display_name_request: request() }), ACCOUNT, 'en');
  const box = screen.getByRole('region', { name: 'Display name' });
  expect(box).toHaveTextContent('The time limit to apply this name has probably passed. Request this name again.');
  expect(within(box).getByRole('button', { name: 'Request another name' })).toBeInTheDocument();
  expect(box).not.toHaveTextContent('délai');
});

// Ruling R-2 : test de restitution de `name_apply_in_progress` côté écran.
test('appliquer : application déjà en cours, texte de la raison', async () => {
  const text = fr.errors.reasons.whatsapp_account.name_apply_in_progress;
  stubFetch(() => engineError(409, 'CONFLICT', 'Texte du moteur.', undefined, 'whatsapp_account.name_apply_in_progress'));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(codeField()).toHaveValue('');
});

test('demander un autre nom : champ, envoi, puis état « en revue » relu', async () => {
  const inReview = numberView({ id: 8, display_name_request: request({ status: 'in_review', requested_name: 'Marais Mode', approved_at: null, apply_before: null }) });
  const calls = stubFetch(() => json(inReview));
  const { onNumberChanged } = renderPanel(numberView({ id: 8 }));
  await userEvent.click(screen.getByRole('button', { name: 'Demander un autre nom' }));
  const input = screen.getByLabelText('Nouveau nom');
  expect(input).toHaveFocus();
  expect(panel()).toHaveTextContent('Meta revoit en général en 1 à 2 jours.');
  await userEvent.type(input, 'Marais Mode');
  expect(within(panel()).getByText('11 / 512')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText('Demande envoyée à Meta.')).toBeInTheDocument();
  expect(calls).toEqual([{ url: REQUEST_URL, method: 'POST', body: { new_display_name: 'Marais Mode' } }]);
  expect(onNumberChanged).toHaveBeenCalledWith(inReview);
});

test('demander un autre nom : nom vide refusé sans appel, refus de Meta restitué avec son texte', async () => {
  const calls = stubFetch(() =>
    json({ error: { code: 'WA_VALIDATION_FAILED', message: 'Meta a renvoyé une erreur', details: [{ path: 'display_name', message: 'Meta a renvoyé une erreur', provider_text: 'Too many name changes' }] } }, 422),
  );
  renderPanel(numberView({ id: 8 }));
  await userEvent.click(screen.getByRole('button', { name: 'Demander un autre nom' }));
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(screen.getByText('Le nom est requis.')).toBeInTheDocument();
  expect(calls).toEqual([]);
  await userEvent.type(screen.getByLabelText('Nouveau nom'), 'Marais Mode');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Meta a renvoyé une erreur');
  expect(screen.getByText('Too many name changes')).toBeInTheDocument();
});

test('appliquer : plus aucun nom à appliquer chez le moteur, texte de la raison', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Texte du moteur.', undefined, 'whatsapp_account.no_display_name_request'));
  renderPanel(numberView({ id: 8, display_name_request: request() }));
  await userEvent.type(codeField(), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Appliquer le nouveau nom' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.reasons.whatsapp_account.no_display_name_request);
});

// Ruling R-28 : le code est à noter quand aucun code n'est actif ; il reste visible et hors du gestionnaire de mots de passe.
test.each([false, true, null])('code : champ texte visible, autoComplete one-time-code (pin_enabled %s)', (pinEnabled) => {
  renderPanel(numberView({ id: 8, pin_enabled: pinEnabled, display_name_request: request() }));
  const code = codeField();
  expect(code).toHaveAttribute('type', 'text');
  expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
