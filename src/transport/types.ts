/**
 * Transport interface: abstraction du canal WhatsApp utilisé.
 *
 * Permet d'avoir plusieurs implémentations interchangeables :
 *   - cm-com.ts (BSP CM.com)
 *   - meta-cloud.ts (API officielle Meta Cloud)
 *
 * Le core (handler, router, admin) ne dépend que de cette interface.
 */

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListSection {
  title: string;
  options: string[];
}

export interface ProductListSection {
  title: string;
  product_retailer_ids: string[];
}

export interface OrderItem {
  product_retailer_id: string;
  quantity: number;
  item_price: number;
  currency: string;
}

/**
 * Nature d'un message entrant, décidée par le parseur :
 *   - text : texte libre, réponse de bouton, de liste ou de modèle (le texte est dans `text`)
 *   - audio : message vocal
 *   - media : image, vidéo ou document
 *   - order : commande de catalogue (`order` renseigné, `text` résume la commande)
 *   - unsupported : type que le moteur ne sait pas traiter (sticker, localisation, contacts, inconnu)
 *   - ignored : message qui n'appelle aucune réponse (réaction)
 */
export type IncomingKind = 'text' | 'audio' | 'media' | 'order' | 'unsupported' | 'ignored';

export interface IncomingMessage {
  /** Identifiant du contact, tel que reçu du fournisseur (Meta : `from` sans normalisation, un BSUID passe ; CM.com : numéro sans préfixe 00). */
  contactId: string;
  /** Numéro destinataire WhatsApp, brut (Meta : display_phone_number ; CM.com : to.number). Normalisé par le pipeline, sert au routage. */
  toNumber: string;
  /** Identifiant technique du numéro destinataire chez le fournisseur (Meta : metadata.phone_number_id). */
  recipientId?: string;
  kind: IncomingKind;
  /** Type d'origine chez le fournisseur ('sticker', 'image/png', ...), pour les journaux. */
  providerType: string;
  /** Texte du message : renseigné pour `text` et `order`, vide sinon. */
  text: string;
  /** Identifiant unique du message (pour dedup) */
  messageId: string;
  timestamp: string;
  profileName?: string;
  mediaUrl?: string;
  mediaType?: string;
  order?: { catalog_id: string; items: OrderItem[] };
}

/**
 * Nature d'un échec d'envoi, pour que l'appelant décide quoi faire :
 *   - auth : identifiants refusés par le fournisseur, inutile de réessayer
 *   - window_closed : fenêtre de 24 h fermée, un message libre n'est plus accepté
 *   - transient : panne passagère (réseau, limite de débit, erreur serveur), déjà réessayée
 *   - other : refus définitif (requête invalide, etc.)
 */
export type SendErrorKind = 'auth' | 'window_closed' | 'transient' | 'other';

export class TransportSendError extends Error {
  readonly kind: SendErrorKind;
  /** Statut HTTP, absent pour une erreur réseau ou un délai dépassé. */
  readonly status?: number;
  /** Code d'erreur du fournisseur quand il est lisible (Meta : error.code ; CM.com : errorCode). */
  readonly code?: number;

  constructor(message: string, kind: SendErrorKind, details: { status?: number; code?: number } = {}) {
    super(message);
    this.name = 'TransportSendError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
  }
}

/**
 * Driver de transport WhatsApp.
 *
 * Toutes les méthodes d'envoi sont async et résolvent quand le serveur upstream a accepté
 * le message (status 2xx). Elles lèvent une TransportSendError en cas d'échec définitif.
 */
export interface Transport {
  /** Identifiant du transport ('cm-com', 'meta-cloud', ...) */
  readonly id: string;
  /** Identifiant de l'expéditeur côté fournisseur (Meta : phone_number_id ; CM.com : from_number) */
  readonly senderId: string;

  // --- Envoi de messages ---
  sendText(to: string, text: string): Promise<void>;
  sendImage(to: string, imageUrl: string, caption?: string): Promise<void>;
  sendButtons(to: string, text: string, buttons: ReplyButton[]): Promise<void>;
  sendList(to: string, text: string, button: string, sections: ListSection[]): Promise<void>;
  sendImageButtons(to: string, imageUrl: string, text: string, buttons: ReplyButton[]): Promise<void>;
  sendCta(to: string, text: string, buttonText: string, url: string): Promise<void>;
  sendCatalog(to: string, text: string, footer?: string): Promise<void>;
  sendProduct(to: string, text: string, catalogId: string, productRetailerId: string, footer?: string): Promise<void>;
  sendProductList(to: string, text: string, header: string, catalogId: string, sections: ProductListSection[]): Promise<void>;

  // --- UX feedback ---
  sendReadReceipt(messageId: string): Promise<void>;
  sendTypingIndicator(to: string, messageId: string): Promise<void>;

  // --- Webhook entrant ---
  // Le parsing est porté par des fonctions pures (parseMetaWebhook, parseCmWebhook), sans identifiants.

  /**
   * (Optionnel) Vérifie la signature HMAC d'un webhook entrant, calculée sur les octets reçus.
   * Retourne true si valide, false sinon. Un transport qui ne l'implémente pas (CM.com, authentifié
   * par le secret de son URL) n'est jamais accepté sur une route qui exige une signature.
   */
  verifyWebhookSignature?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;

  /**
   * (Optionnel) Teste les identifiants auprès de l'API du provider.
   * Appel réseau réel. Ne throw jamais : retourne { ok, error? }.
   */
  validateCredentials?(): Promise<{ ok: boolean; error?: string }>;
}
