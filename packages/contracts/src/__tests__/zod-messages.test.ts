import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  CreateWhatsAppAccountInput, RenameWhatsAppAccountInput, ReplaceWhatsAppCredentialsInput, CreateBotInput,
  SimulateInput, CreateInvitationInput, SetAllowlistInput, ForgotPasswordInput,
} from '../index.js';

const TECHNICAL = /String must|Invalid|Expected|Required|Number must|Array must/;

function messages(schema: ZodTypeAny, value: unknown): string[] {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('la valeur aurait dû être refusée');
  return r.error.issues.map((i) => i.message);
}

const meta = { mode: 'meta_manual', name: 'Boutique', waba_id: '123456789', access_token: 'EAA'.padEnd(40, 'x'), app_secret: 'a'.repeat(32) };
const cm = { mode: 'cm_com', name: 'CM', account_id: '0b9c8a52-4f1e-4d4c-9a39-2a3d5f7e9b10', product_token: 'p'.repeat(36) };
const bot = {
  bot_id: 'sales', name: 'Vente', welcome: { enabled: false, message: {} },
};

// audit R-7
describe('contracts: messages des règles exposées à un écran', () => {
  const cases: Array<[string, ZodTypeAny, unknown, string]> = [
    ['création, nom vide', CreateWhatsAppAccountInput, { ...meta, name: '   ' }, 'Le nom est requis.'],
    ['création, nom trop long', CreateWhatsAppAccountInput, { ...meta, name: 'x'.repeat(81) }, 'Le nom fait 80 caractères au plus.'],
    ['renommer, nom vide', RenameWhatsAppAccountInput, { name: '' }, 'Le nom est requis.'],
    ['renommer, nom trop long', RenameWhatsAppAccountInput, { name: 'x'.repeat(81) }, 'Le nom fait 80 caractères au plus.'],
    ['Meta, jeton court', ReplaceWhatsAppCredentialsInput, { ...meta, access_token: 'court' }, "Le jeton d'accès semble incomplet : collez-le en entier."],
    ['Meta, secret court', ReplaceWhatsAppCredentialsInput, { ...meta, app_secret: 'court' }, "Le secret de l'app semble incomplet : collez-le en entier."],
    ['Meta, jeton trop long', CreateWhatsAppAccountInput, { ...meta, access_token: 'x'.repeat(1001) }, "Le jeton d'accès est trop long."],
    ['Meta, secret trop long', CreateWhatsAppAccountInput, { ...meta, app_secret: 'x'.repeat(129) }, "Le secret de l'app est trop long."],
    ['CM.com, UUID invalide', ReplaceWhatsAppCredentialsInput, { ...cm, account_id: 'pas-un-uuid' }, 'Identifiant de compte CM.com invalide.'],
    ['CM.com, jeton produit court', ReplaceWhatsAppCredentialsInput, { ...cm, product_token: 'court' }, 'Le jeton produit semble incomplet : collez-le en entier.'],
    ['CM.com, jeton produit long', ReplaceWhatsAppCredentialsInput, { ...cm, product_token: 'x'.repeat(201) }, 'Le jeton produit est trop long.'],
    ['agent IA, nom vide', CreateBotInput, { ...bot, name: '' }, 'Le nom est requis.'],
    ['simulateur, message vide', SimulateInput, { message: '' }, 'Écrivez un message.'],
    ['simulateur, message trop long', SimulateInput, { message: 'x'.repeat(4001) }, 'Le message fait 4000 caractères au plus.'],
    ['invitation, e-mail invalide', CreateInvitationInput, { email: 'pas-un-email', grants: [{ entity_id: null, role: 'admin' }] }, 'Adresse e-mail invalide.'],
    ['mot de passe oublié, e-mail invalide', ForgotPasswordInput, { email: 'x' }, 'Adresse e-mail invalide.'],
    ['liste d\'accès, 21 entrées', SetAllowlistInput, { entries: Array.from({ length: 21 }, (_, i) => `+3361234567${i}`) }, '20 entrées au plus.'],
  ];

  it.each(cases)('%s : message français exact', (_label, schema, value, expected) => {
    expect(messages(schema, value)).toContain(expected);
  });

  it.each(cases)('%s : aucun message technique anglais', (_label, schema, value) => {
    for (const m of messages(schema, value)) expect(m).not.toMatch(TECHNICAL);
  });
});
