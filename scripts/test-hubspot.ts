/**
 * Test runtime du connecteur HubSpot.
 *
 * Lance un push lead vers le HubSpot configuré dans .env (HUBSPOT_TOKEN),
 * puis un second push avec le même email pour vérifier la dédup (UPDATE et pas CREATE).
 *
 * Usage : npx tsx scripts/test-hubspot.ts
 */

import { HubSpotConnector } from '../src/connectors/hubspot.js';
import { config } from '../src/core/config.js';

async function main() {
  const token = config.hubspot.accessToken;
  if (!token) {
    console.error('HUBSPOT_TOKEN missing in .env');
    process.exit(1);
  }

  const connector = new HubSpotConnector({ accessToken: token, clientId: 'default' });

  const testLead = {
    client_id: 'default',
    bot_id: 'example',
    lead_id: 'test-' + Date.now(),
    phone: '33761848975',
    profile_name: 'Francois Test Engine',
    prenom: 'Francois',
    nom: 'Greze',
    email: 'francois+engine-test@cyran.fr',
    societe: 'Cyran',
    fonction: 'Founder',
    besoin: 'Test du connecteur HubSpot du moteur Cyran Labs Engine',
    budget: 'à définir',
    source: 'whatsapp-cyran-labs-engine',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log('=== Push 1 (création) ===');
  await connector.pushLead(testLead);

  console.log('=== Push 2 (même email -> doit UPDATE) ===');
  await connector.pushLead({
    ...testLead,
    besoin: 'Mise a jour du besoin pour tester idempotency',
    budget: '5000-10000 EUR/mois',
    updated_at: new Date().toISOString(),
  });

  console.log('=== Done ===');
}

main().catch(err => { console.error(err); process.exit(1); });
