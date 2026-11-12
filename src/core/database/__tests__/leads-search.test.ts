/**
 * Recherche des leads (spec navigation 9.2) : pour un membre qui reçoit les numéros des contacts masqués, la recherche
 * ne porte que sur le nom, jamais sur le numéro, sinon elle dirait si un numéro est un contact. Les deux pilotes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { Database } from '../types.js';

const PHONE = '+33612345678';

describe('listLeadsByBot : recherche avec ou sans le numéro', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.saveLead(PHONE, 'acme', 'ventes', { phone: PHONE, name: 'Marie' });
    await db.saveLead('+33700000000', 'acme', 'ventes', { phone: '+33700000000', name: 'Paul' });
  });

  afterEach(async () => {
    await db.close();
  });

  const phonesFor = async (text: string, includePhone: boolean): Promise<{ phones: string[]; total: number }> => {
    const { leads, total } = await db.listLeadsByBot('acme', 'ventes', { search: { text, includePhone }, limit: 10, offset: 0 });
    return { phones: leads.map((l) => l.phone), total };
  };

  // nav 15.6
  it('includePhone faux : rien par le numéro (entier ou partiel), le lead par son nom', async () => {
    expect(await phonesFor('612345', false)).toEqual({ phones: [], total: 0 });
    expect(await phonesFor(PHONE, false)).toEqual({ phones: [], total: 0 });
    expect(await phonesFor('Marie', false)).toEqual({ phones: [PHONE], total: 1 });
  });

  // nav 15.6
  it('includePhone vrai : le lead par son numéro et par son nom', async () => {
    expect(await phonesFor('612345', true)).toEqual({ phones: [PHONE], total: 1 });
    expect(await phonesFor(PHONE, true)).toEqual({ phones: [PHONE], total: 1 });
    expect(await phonesFor('Marie', true)).toEqual({ phones: [PHONE], total: 1 });
  });
});
