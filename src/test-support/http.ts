import http from 'node:http';
import { onTestFinished } from 'vitest';

const servers = new WeakMap<http.RequestListener, Promise<http.Server>>();

function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Serveur HTTP de test pour supertest, lié à 127.0.0.1 sur un port libre : `request(await serve(app))`.
 *
 * Ne pas passer l'application directement à supertest : il écoute alors sur le joker IPv6 `::`
 * puis se connecte à 127.0.0.1. Sous macOS, le noyau attribue à ce joker des ports déjà tenus en
 * IPv4 par un autre processus (éditeur, Ollama, etc.) ; la requête part chez ce processus, qui
 * répond 404 ou 401, ou ne répond pas (délai dépassé). Lier 127.0.0.1 exclut ces ports.
 *
 * Un serveur par application et par test, fermé à la fin du test. À appeler dans le corps du test.
 */
export function serve(app: http.RequestListener): Promise<http.Server> {
  const existing = servers.get(app);
  if (existing) return existing;
  const server = http.createServer(app);
  const listening = new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
  servers.set(app, listening);
  onTestFinished(async () => {
    servers.delete(app);
    if (server.listening) await close(server);
  });
  return listening;
}
