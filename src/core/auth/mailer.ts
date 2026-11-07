export interface Mailer {
  sendInvitation(to: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

/** Impl par défaut : logue le lien (dev / pas de fournisseur configuré). */
export class ConsoleMailer implements Mailer {
  async sendInvitation(to: string, link: string): Promise<void> {
    console.log(`[Mailer] Invitation Flow Labs pour ${to}: ${link}`);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    console.log(`[Mailer] Réinitialisation Flow Labs pour ${to}: ${link}`);
  }
}

/**
 * Sélection de l'impl. V1 : ConsoleMailer. Un impl Resend/SMTP se branchera ici
 * derrière une variable d'env (clé API) sans toucher aux appelants.
 */
export function createMailer(): Mailer {
  return new ConsoleMailer();
}
