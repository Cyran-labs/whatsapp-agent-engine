/**
 * Transport interface — abstraction du canal WhatsApp utilisé.
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

export interface IncomingMessage {
  /** Numéro de l'expéditeur (format normalisé : digits only, sans +/00) */
  phone: string;
  /** Numéro destinataire WhatsApp (le numéro qui a reçu le message). Sert au routing multi-bot. */
  toNumber: string;
  /** Texte du message (peut être '[audio]', '[message non-texte]', '[ORDER_RECEIVED]...') */
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
 * Driver de transport WhatsApp.
 *
 * Toutes les méthodes d'envoi sont async et résolvent quand le serveur upstream a accepté
 * le message (status 2xx). Elles peuvent throw en cas d'échec définitif.
 */
export interface Transport {
  /** Identifiant du transport ('cm-com', 'meta-cloud', ...) */
  readonly id: string;

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
  /**
   * Parse un payload de webhook entrant (format propre au transport)
   * et retourne un IncomingMessage normalisé, ou null si non interprétable.
   */
  parseWebhookPayload(body: unknown): IncomingMessage | null;

  /**
   * (Optionnel) Vérifie la signature HMAC d'un webhook entrant.
   * Retourne true si valide, false sinon. Si non implémenté, retourne true (transport
   * sans vérification — ex: CM.com qui s'appuie sur une URL secrète).
   */
  verifyWebhookSignature?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  /**
   * (Optionnel) Teste les identifiants auprès de l'API du provider.
   * Appel réseau réel. Ne throw jamais : retourne { ok, error? }.
   */
  validateCredentials?(): Promise<{ ok: boolean; error?: string }>;
}
