// Adresses de webhook Meta inscrites par WABAGENT (lot R1, spec R1 §5.1 et §5.4). Fonctions pures : aucune base, aucun
// appel à Meta, aucun journal (une adresse de webhook contient la clé du compte et ne se journalise jamais).

/** Préfixe des adresses de webhook Meta d'un compte, sous l'adresse publique du moteur. */
const META_WEBHOOK_PATH = '/webhook/meta/';

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

/** Adresse du webhook Meta d'un compte : `<base>/webhook/meta/<clé>`, sans double barre quelle que soit la base. */
export function metaWebhookUrl(base: string, webhookKey: string): string {
  return `${trimBase(base)}${META_WEBHOOK_PATH}${webhookKey}`;
}

/** Domaine seul d'une adresse (jamais le chemin, qui peut porter une clé), null si l'adresse est illisible. */
export function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Où pointe le webhook de l'app Meta (spec R1 §5.4) :
 * - `ours` : l'adresse d'un compte `connected` de la même organisation et de la même app (`ownAccountUrls`, lue par
 *   l'appelant dans l'organisation du compte, jamais ailleurs) ;
 * - `empty` : rien d'inscrit ;
 * - `other_account_of_ours` : une adresse de compte de WABAGENT (`<base>/webhook/meta/...`) qui n'est pas dans la
 *   liste (compte retiré, par exemple) : WABAGENT peut la remplacer sans rien casser chez le client ;
 * - `elsewhere` : toute autre adresse (autre produit du client) : jamais remplacée sans confirmation (§10, question 1).
 */
export function classifyAppWebhook(
  current: string | null, base: string, ownAccountUrls: readonly string[],
): 'ours' | 'empty' | 'elsewhere' | 'other_account_of_ours' {
  if (current === null || current === '') return 'empty';
  if (ownAccountUrls.includes(current)) return 'ours';
  return current.startsWith(`${trimBase(base)}${META_WEBHOOK_PATH}`) ? 'other_account_of_ours' : 'elsewhere';
}
