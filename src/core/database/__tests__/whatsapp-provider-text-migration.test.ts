import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureSqliteWhatsAppSchema } from '../whatsapp-sqlite.js';

// audit R-21 : la colonne du texte brut du fournisseur s'ajoute à une base existante sans rien supprimer
describe('migration SQLite : whatsapp_accounts.error_provider_text', () => {
  it('ajoute la colonne à une base créée avant elle, garde les comptes et leur motif, et se rejoue sans effet', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE bots (client_id TEXT NOT NULL, bot_id TEXT NOT NULL);
      CREATE TABLE whatsapp_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL,
        provider_account_id TEXT NOT NULL, waba_id TEXT, meta_app_id TEXT, secret_encrypted TEXT NOT NULL,
        key_version INTEGER NOT NULL, webhook_key_hash TEXT, state TEXT NOT NULL DEFAULT 'connected',
        error_reason TEXT, error_detail TEXT, last_verified_at TEXT, token_expiry TEXT, last_signature_ok_at TEXT,
        alerts TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT 'x', updated_at TEXT NOT NULL DEFAULT 'x'
      );
      INSERT INTO whatsapp_accounts (client_id, name, mode, provider_account_id, secret_encrypted, key_version, state, error_reason, error_detail)
      VALUES ('acme', 'Compte', 'meta_manual', 'waba-1', 'enc', 1, 'error', 'other', 'Secret de l''app refusé');
    `);
    ensureSqliteWhatsAppSchema(db);
    ensureSqliteWhatsAppSchema(db);
    const row = db.prepare('SELECT name, state, error_detail, error_provider_text FROM whatsapp_accounts').get();
    expect(row).toEqual({ name: 'Compte', state: 'error', error_detail: "Secret de l'app refusé", error_provider_text: null });
    db.close();
  });
});
