import { config } from './config.js';
import {
  resetSession, resetAll, resetBotSession, getRecentHistory, getAllSessions, getAllLeads,
} from './db.js';
import { listBots, loadBotConfig } from './bot-config.js';
import { getTransportForBot } from '../transport/index.js';

const ADMIN_HELP = `*Commandes admin :*
- */reset* - Reset session courante (bot)
- */reset all* - Reset tout (sessions + historique)
- */reset +33XXXXXXXXX* - Reset session d'un autre numéro
- */history* - Historique récent (bot courant)
- */sessions* - Sessions actives
- */leads* - Leads qualifiés
- */bots* - Liste des bots configurés`;

export function isAdmin(phone: string): boolean {
  if (config.adminPhones.length === 0) return false;
  const normalized = phone.replace(/\D/g, '');
  return config.adminPhones.some(p => normalized === p.replace(/\D/g, ''));
}

export async function handleControlCommand(
  phone: string,
  text: string,
  currentClientId: string,
  currentBotId: string
): Promise<boolean> {
  const normalized = text.trim().toLowerCase();
  const raw = text.trim();

  const currentBot = loadBotConfig(currentClientId, currentBotId);
  const transport = await getTransportForBot(currentBot);

  if (normalized === 'menu' || normalized === 'help' || normalized === '/help') {
    if (!isAdmin(phone)) return false;
    await transport.sendText(phone, ADMIN_HELP);
    return true;
  }

  if (normalized === 'reset') {
    await resetBotSession(phone, currentClientId, currentBotId);
    return false;
  }

  if (raw.startsWith('/') && isAdmin(phone)) {
    const parts = raw.slice(1).split(' ');
    const cmd = parts[0]?.toLowerCase();

    if (cmd === 'help') {
      await transport.sendText(phone, ADMIN_HELP);
      return true;
    }

    if (cmd === 'reset') {
      const arg = parts[1]?.toLowerCase();

      if (!arg) {
        await resetSession(phone);
        await transport.sendText(phone, 'Session effacée.');
        return true;
      }

      if (arg === 'all') {
        await resetAll(phone);
        await transport.sendText(phone, 'Reset complet : session + historique effacés.');
        return true;
      }

      if (arg.startsWith('+') || /^\d{10,}$/.test(arg)) {
        await resetAll(arg);
        await transport.sendText(phone, `Session de ${arg} effacée.`);
        return true;
      }

      await transport.sendText(phone, 'Usage : /reset | /reset all | /reset +33XXXXXXXXX');
      return true;
    }

    if (cmd === 'history') {
      const history = (await getRecentHistory(phone, currentClientId, currentBotId, 10)).reverse();
      if (history.length === 0) {
        await transport.sendText(phone, 'Aucun historique.');
        return true;
      }
      const lines = history.map(m => `[${m.role}] ${m.content.slice(0, 100)}`).join('\n\n');
      await transport.sendText(phone, `*Historique ${currentClientId}/${currentBotId} (${history.length} msgs) :*\n\n${lines}`);
      return true;
    }

    if (cmd === 'sessions') {
      const sessions = await getAllSessions();
      if (sessions.length === 0) {
        await transport.sendText(phone, 'Aucune session active.');
        return true;
      }
      const lines = sessions.map(s => `${s.phone} [${s.client_id}/${s.bot_id}] (${s.msg_count} msgs)`).join('\n');
      await transport.sendText(phone, `*Sessions (${sessions.length}) :*\n\n${lines}`);
      return true;
    }

    if (cmd === 'leads') {
      const leads = await getAllLeads();
      if (leads.length === 0) {
        await transport.sendText(phone, 'Aucun lead.');
        return true;
      }
      const lines = leads.slice(0, 10)
        .map(l => `${l.phone} [${l.client_id}/${l.bot_id}] | ${l.created_at.slice(0, 10)}`)
        .join('\n');
      await transport.sendText(phone, `*Leads (${leads.length}) :*\n\n${lines}`);
      return true;
    }

    if (cmd === 'bots') {
      const bots = listBots();
      if (bots.length === 0) {
        await transport.sendText(phone, 'Aucun bot configuré.');
        return true;
      }
      const lines = bots.map(b => `- ${b.client_id}/${b.bot_id} (${b.name}) — ${b.whatsapp_numbers.join(', ')}`).join('\n');
      await transport.sendText(phone, `*Bots configurés (${bots.length}) :*\n\n${lines}`);
      return true;
    }

    await transport.sendText(phone, 'Commande inconnue. Tapez /help.');
    return true;
  }

  return false;
}
