import { maskEmail } from '../phone.js';

export interface Mailer {
  sendInvitation(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Ligne écrite hors production seulement : adresse et lien en clair, car les essais en réel (aucun e-mail n'est
 * envoyé) lisent le lien dans le journal (choix C-6). Construite ici pour que le seul endroit du moteur qui écrit un
 * lien soit explicite ; la branche production ne l'appelle jamais (test `mailer.test.ts`, recette Q-9).
 */
function developmentLine(kind: 'Invitation' | 'Réinitialisation', to: string, link: string): string {
  return `[Mailer] ${kind} WABAGENT pour ${to}: ${link}`;
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
    const line = developmentLine('Invitation', to, link);
    console.log(line);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (isProduction()) {
      console.log(`[Mailer] Réinitialisation créée pour ${maskEmail(to)} : envoi d'e-mail non configuré, lien non journalisé`);
      return;
    }
    const line = developmentLine('Réinitialisation', to, link);
    console.log(line);
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
