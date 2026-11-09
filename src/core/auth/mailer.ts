import { maskEmail } from '../phone.js';

export interface Mailer {
  sendInvitation(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Seul endroit du moteur qui écrit un lien en clair, hors production seulement : aucun e-mail n'est envoyé et les
 * essais en réel lisent le lien dans le journal (choix C-6). La branche production ne l'appelle jamais (test
 * `mailer.test.ts`, recette Q-9) ; l'exemption de la garde `check:logs` est figée par un test.
 */
function writeDevelopmentLink(kind: 'Invitation' | 'Réinitialisation', to: string, link: string): void {
  // check-logs-ignore: lien écrit hors production seulement, les essais en réel le lisent ici (choix C-6)
  console.log(`[Mailer] ${kind} WABAGENT pour ${to}: ${link}`);
}

/**
 * Impl par défaut : aucun e-mail n'est envoyé. Hors production, le lien est écrit dans le journal (les essais en
 * réel le lisent là). En production, le lien est un secret : il n'est jamais écrit, seule l'adresse masquée l'est.
 */
export class ConsoleMailer implements Mailer {
  async sendInvitation(to: string, link: string): Promise<void> {
    if (isProduction()) {
      console.log(`[Mailer] Invitation créée pour ${maskEmail(to)} : envoi d'e-mail non configuré, lien non journalisé`);
      return;
    }
    writeDevelopmentLink('Invitation', to, link);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (isProduction()) {
      console.log(`[Mailer] Réinitialisation créée pour ${maskEmail(to)} : envoi d'e-mail non configuré, lien non journalisé`);
      return;
    }
    writeDevelopmentLink('Réinitialisation', to, link);
  }
}

/** Au démarrage en production : sans fournisseur d'e-mail, personne ne reçoit les liens (et ils ne sont pas journalisés). */
export function warnIfMailerNotConfigured(): void {
  if (!isProduction()) return;
  console.warn("[Mailer] Aucun envoi d'e-mail configuré : les liens d'invitation et de réinitialisation ne sont pas journalisés en production");
}

/**
 * Sélection de l'impl. V1 : ConsoleMailer. Un impl Resend/SMTP se branchera ici
 * derrière une variable d'env (clé API) sans toucher aux appelants.
 */
export function createMailer(): Mailer {
  return new ConsoleMailer();
}
