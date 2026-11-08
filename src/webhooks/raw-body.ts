import express from 'express';

/** Requête dont le corps brut a été conservé par l'analyseur des webhooks. */
export type RawBodyRequest = express.Request & { rawBody?: Buffer };

/**
 * Analyseur JSON des routes de webhook seulement (256 ko) : le corps brut est conservé en octets,
 * la signature Meta est vérifiée sur ce qui a été reçu (audit 4.2). Monté route par route : une URL
 * inconnue répond 404 sans que son corps soit lu.
 */
export const webhookJsonParser = express.json({
  limit: '256kb',
  verify: (req: RawBodyRequest, _res, buf) => {
    req.rawBody = buf;
  },
});
