import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { DisconnectDialog } from '../disconnect-dialog';
import en from '../../../../messages/en.json';
import { accountView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderDialog() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Boutique principale' })} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

test('la fenêtre nomme le compte et explique ce que le retrait change', () => {
  stubFetch(() => new Response(null, { status: 204 }));
  renderDialog();
  expect(screen.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' })).toBeInTheDocument();
  // Texte fidèle au moteur (disconnectWhatsAppAccount) : numéros retirés, agents IA désactivés ou en brouillon, identifiants effacés, webhook invalidé.
  const text = screen.getByRole('dialog').textContent ?? '';
  expect(text).toContain('numéros du compte sont retirés de la liste');
  expect(text).toContain('agents IA Offline ou en Draft qui les tenaient perdent leur numéro');
  expect(text).toContain('identifiants enregistrés sont effacés');
  expect(text).toContain("adresse de webhook du compte cesse de fonctionner");
  // Audit des décisions R1, F-2 (décision de François du 12 nov. 2026) : l'app Meta est désabonnée du compte WhatsApp.
  expect(text).toContain("L'app Meta sera désabonnée de ce compte WhatsApp : plus aucun message de ce compte ne passera par cette app.");
  expect(text).toContain('il faudra le raccorder de nouveau');
});

// Point d'attention 3 de la revue : refus du moteur affiché tel quel, rien ne change à l'écran.
test('409 du moteur : son message et les agents IA nommés s\'affichent, onDone n\'est pas appelé', async () => {
  const calls = stubFetch(() =>
    engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", [
      { path: 'bots.conseil', message: 'Conseil Marais' },
      { path: 'bots.sav', message: 'SAV commandes' },
    ], 'whatsapp_account.in_use'),
  );
  const { onDone, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Mettez d'abord Offline les agents IA qui utilisent ce compte :");
  expect(screen.getByText('Conseil Marais')).toBeInTheDocument();
  expect(screen.getByText('SAV commandes')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/7/disconnect', method: 'POST', body: undefined }]);
  expect(onDone).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

// Corps absent (ancien moteur ou faux moteur) : rien à dire, le retrait est fini.
test('204 : onDone est appelé', async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

const disconnected = (body: { waba_cleanup: string; app_webhook: string; repointed_to?: string }): Response => json(body);

// spec R1 §5.5 : le moteur répond 200 avec le bilan du nettoyage chez Meta. Relecture finale R1 FR-M7 : le repointage
// est dit par la notification de la page, la fenêtre se ferme aussitôt et lui passe le nom du compte.
test('200, nettoyage fait et webhook de l\'app repointé : onDone tout de suite avec le compte qui reçoit le webhook', async () => {
  stubFetch(() => disconnected({ waba_cleanup: 'done', app_webhook: 'repointed', repointed_to: 'Boutique Lyon' }));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(onDone).toHaveBeenCalledWith('Boutique Lyon');
});

test('200, CM.com (rien à nettoyer chez Meta) : onDone tout de suite', async () => {
  stubFetch(() => disconnected({ waba_cleanup: 'not_applicable', app_webhook: 'not_applicable' }));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
});

test('déconnexion : phrase app_webhook left, la fenêtre reste ouverte jusqu\'à Fermer', async () => {
  stubFetch(() => disconnected({ waba_cleanup: 'done', app_webhook: 'left' }));
  const { onDone, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  // Le retrait est fait : le titre passe au passé, plus de question.
  const dialog = await screen.findByRole('dialog', { name: 'Compte Boutique principale retiré' });
  expect(within(dialog).getByText(
    "Le webhook de votre app Meta pointe encore vers ce compte retiré. Pour le changer : tableau de bord de l'app Meta, WhatsApp, Configuration.",
  )).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Retirer le compte Boutique principale ?' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Retirer le compte' })).not.toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

test('déconnexion : retrait chez Meta échoué, phrase dite avec le repointage (neutre) ; Échap ferme et termine le retrait', async () => {
  stubFetch(() => disconnected({ waba_cleanup: 'failed', app_webhook: 'repointed', repointed_to: 'Boutique Lyon' }));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByText(
    "L'app Meta n'a pas pu être désabonnée de ce compte WhatsApp : ses messages partent encore vers WABAGENT, qui ne les traite plus. Contactez le support.",
  )).toBeInTheDocument();
  // Relecture finale R1 FR-M7 : phrase neutre, pas une alerte.
  const repointed = within(dialog).getByText('Le webhook de votre app Meta pointe maintenant vers le compte Boutique Lyon.');
  expect(repointed.className).not.toContain('warning');
  expect(within(dialog).queryByText(/pointe encore/)).not.toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onDone).toHaveBeenCalledTimes(1);
  // Déjà dit dans la fenêtre : la notification ne le répète pas.
  expect(onDone).toHaveBeenCalledWith(null);
});

test('déconnexion, interface anglaise : les deux phrases en anglais', async () => {
  stubFetch(() => disconnected({ waba_cleanup: 'failed', app_webhook: 'left' }));
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Main shop' })} onClose={vi.fn()} onDone={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
  expect(await screen.findByRole('dialog', { name: 'Account Main shop removed' })).toBeInTheDocument();
  expect(screen.getByText(en.connections.disconnect.appWebhookLeft)).toBeInTheDocument();
  expect(screen.getByText(en.connections.disconnect.wabaCleanupFailed)).toBeInTheDocument();
});

// Audit des décisions R1, F-1 : une adresse qui n'est pas celle du compte n'est jamais touchée, la fenêtre le dit.
test.each(['fr', 'en'] as const)("déconnexion : adresse en place hors de ce compte (%s), phrase dite, la fenêtre reste ouverte", async (locale) => {
  stubFetch(() => disconnected({ waba_cleanup: 'other_address', app_webhook: 'not_applicable' }));
  const onDone = vi.fn();
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Boutique principale' })} onClose={vi.fn()} onDone={onDone} />, locale);
  await userEvent.click(screen.getByRole('button', { name: locale === 'fr' ? 'Retirer le compte' : 'Remove account' }));
  const m = locale === 'fr' ? (await import('../../../../messages/fr.json')).default : en;
  expect(await screen.findByText(m.connections.disconnect.wabaOtherAddress)).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

// Audit des décisions R1 P-4 (A-2) : webhook de l'app non lu, la fenêtre ne dit pas qu'il pointe vers ce compte.
test.each(['fr', 'en'] as const)("déconnexion : webhook de l'app non lu (%s), phrase prudente avec le chemin dans Meta", async (locale) => {
  stubFetch(() => disconnected({ waba_cleanup: 'done', app_webhook: 'unknown' }));
  const onDone = vi.fn();
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Boutique principale' })} onClose={vi.fn()} onDone={onDone} />, locale);
  await userEvent.click(screen.getByRole('button', { name: locale === 'fr' ? 'Retirer le compte' : 'Remove account' }));
  const m = locale === 'fr' ? (await import('../../../../messages/fr.json')).default : en;
  expect(await screen.findByText(m.connections.disconnect.appWebhookUnknown)).toBeInTheDocument();
  expect(screen.queryByText(m.connections.disconnect.appWebhookLeft)).not.toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

test('textes du webhook de l\'app au retrait : ceux de la décision A-2', async () => {
  const fr = (await import('../../../../messages/fr.json')).default;
  expect(fr.connections.disconnect.appWebhookLeft).toBe("Le webhook de votre app Meta pointe encore vers ce compte retiré. Pour le changer : tableau de bord de l'app Meta, WhatsApp, Configuration.");
  expect(fr.connections.disconnect.appWebhookUnknown).toBe("WABAGENT n'a pas pu lire le webhook de votre app Meta. Vérifiez-le dans le tableau de bord de l'app Meta, WhatsApp, Configuration.");
});

test('409 ORG_CHANGED : aucun message d\'erreur, onDone n\'est pas appelé', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retirer le compte' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

test('Annuler ferme sans rien envoyer', async () => {
  const calls = stubFetch(() => new Response(null, { status: 204 }));
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

// audit R-22
test('audit R-22 : Échap pendant l\'envoi ne ferme pas la fenêtre, Annuler est désactivé avec sa raison, le refus reste visible', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async () => {
    await gate;
    return engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", undefined, 'whatsapp_account.in_use');
  });
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  const cancel = within(dialog).getByRole('button', { name: 'Annuler' });
  expect(cancel).toBeDisabled();
  expect(cancel).toHaveAccessibleDescription('Envoi en cours');
  release();
  expect(await within(dialog).findByRole('alert')).toHaveTextContent("Mettez d'abord Offline");
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeEnabled();
});

// Task 6 : la clé du refus a une traduction, c'est elle qui s'affiche ; en anglais jamais le français du moteur
test('409 whatsapp_account.in_use, interface anglaise : texte traduit, jamais le français du moteur, agents IA nommés', async () => {
  stubFetch(() =>
    engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", [{ path: 'bots.sav', message: 'SAV commandes' }], 'whatsapp_account.in_use'),
  );
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Main shop' })} onClose={vi.fn()} onDone={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('Désactivez');
  expect(screen.getByText('SAV commandes')).toBeInTheDocument();
});

test('panne du moteur (500) : texte contextuel et référence, onDone non appelé', async () => {
  stubFetch(() => json({ error: { code: 'INTERNAL', message: 'boom', request_id: 'req-42' } }, 500));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Action impossible pour le moment. Réessayez.');
  expect(alert).toHaveTextContent('req-42');
  expect(onDone).not.toHaveBeenCalled();
});

// revue Minor 7 : un refus métier sans clé connue garde un texte d'action, pas celui d'une panne serveur
test('409 sans clé connue, interface anglaise : « Action failed. Please try again. », jamais le français ni le texte de panne', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Un refus que le web ne connaît pas.'));
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Main shop' })} onClose={vi.fn()} onDone={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Action failed. Please try again.');
  expect(alert).not.toHaveTextContent('refus');
});
