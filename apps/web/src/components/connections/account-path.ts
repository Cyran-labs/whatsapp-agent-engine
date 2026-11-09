/** Route BFF d'un compte WhatsApp : l'identifiant est toujours un entier, jamais du texte saisi. */
export const accountPath = (id: number): string => `/api/whatsapp-accounts/${id}`;
