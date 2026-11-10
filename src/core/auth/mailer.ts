import { maskEmail } from '../phone.js';

export interface Mailer {
  sendInvitation(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

/**
 * Les liens ne sont écrits que sur un choix explicite : `MAILER_LOG_LINKS=true`, valeur exacte, quel que soit
 * `NODE_ENV` (que rien ne fixe de façon fiable : un déploiement qui l'oublierait écrirait des jetons en clair).
 */
function logLinksEnabled(): boolean {
  return process.env['MAILER_LOG_LINKS'] === 'true';
}

/**
 * Seul endroit du moteur qui écrit un lien en clair, sur choix explicite seulement : aucun e-mail n'est envoyé et
 * les essais en réel lisent le lien dans le journal (choix C-6, revue isolation restitution I-3). Sans
 * `MAILER_LOG_LINKS=true`, le lien n'est jamais écrit (test `mailer.test.ts`, recette Q-9) ; l'exemption de la garde
 * `check:logs` est figée par un test.
 */
function writeLink(kind: 'Invitation' | 'Réinitialisation', to: string, link: string): void {
  // check-logs-ignore: lien écrit seulement si MAILER_LOG_LINKS=true est posé explicitement, les essais en réel le lisent ici (choix C-6, revue I-3)
  console.log(`[Mailer] ${kind} WABAGENT pour ${to}: ${link}`);
}

/**
 * Impl par défaut : aucun e-mail n'est envoyé. Avec `MAILER_LOG_LINKS=true`, le lien est écrit dans le journal (les
 * essais en réel le lisent là). Sinon le lien est un secret : il n'est jamais écrit, seule l'adresse masquée l'est.
 */
export class ConsoleMailer implements Mailer {
  async sendInvitation(to: string, link: string): Promise<void> {
    if (!logLinksEnabled()) {
      console.log(`[Mailer] Invitation créée pour ${maskEmail(to)} : envoi d'e-mail non configuré, lien non journalisé`);
      return;
    }
    writeLink('Invitation', to, link);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    if (!logLinksEnabled()) {
      console.log(`[Mailer] Réinitialisation créée pour ${maskEmail(to)} : envoi d'e-mail non configuré, lien non journalisé`);
      return;
    }
    writeLink('Réinitialisation', to, link);
  }
}

/**
 * Au démarrage : sans fournisseur d'e-mail, personne ne reçoit les liens. Ils ne sont écrits dans les journaux que
 * si `MAILER_LOG_LINKS=true`, et le démarrage le dit alors.
 */
export function warnIfMailerNotConfigured(): void {
  if (logLinksEnabled()) {
    console.warn("[Mailer] Aucun envoi d'e-mail configuré : les liens d'invitation et de réinitialisation ne sont pas envoyés");
    console.warn("[Mailer] MAILER_LOG_LINKS=true : les liens d'invitation et de réinitialisation sont écrits dans les journaux, à réserver au développement et à la recette");
    return;
  }
  console.warn("[Mailer] Aucun envoi d'e-mail configuré : les liens d'invitation et de réinitialisation ne sont ni envoyés ni journalisés");
}

/**
 * Sélection de l'impl. V1 : ConsoleMailer. Un impl Resend/SMTP se branchera ici
 * derrière une variable d'env (clé API) sans toucher aux appelants.
 */
export function createMailer(): Mailer {
  return new ConsoleMailer();
}
