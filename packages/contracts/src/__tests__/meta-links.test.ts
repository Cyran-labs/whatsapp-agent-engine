import { describe, expect, it } from 'vitest';
import { extractMetaIds, metaLinks } from '../index.js';

const BUSINESS = '1270659448489249';
const WABA = '1122051030798254';

// Adresses relevées au registre R1 (`.superpowers/sdd/2026-11-12-raccordement-automatique-r1/progress.md`, lignes 169 à 174).
const OVERVIEW = `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${BUSINESS}&asset_id=${WABA}`;
const PHONE_NUMBERS = `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${BUSINESS}&asset_id=${WABA}`;

// Plan R2a, cas limite 1
describe('contracts: liens Meta', () => {
  it('extractMetaIds : cas limites', () => {
    expect(extractMetaIds(BUSINESS)).toEqual({ business_id: BUSINESS, asset_id: null });
    expect(extractMetaIds(OVERVIEW)).toEqual({ business_id: BUSINESS, asset_id: WABA });
    expect(extractMetaIds(PHONE_NUMBERS)).toEqual({ business_id: BUSINESS, asset_id: WABA });
    // Un autre domaine qui porte business_id n'est jamais lu
    expect(extractMetaIds('https://evil.example/?business_id=1')).toBeNull();
    expect(extractMetaIds(`https://evil.example/?business_id=${BUSINESS}`)).toBeNull();
    expect(extractMetaIds(`https://business.facebook.com.evil.example/?business_id=${BUSINESS}`)).toBeNull();
    expect(extractMetaIds(`https://evil.example/?u=https://business.facebook.com/?business_id=${BUSINESS}`)).toBeNull();
    expect(extractMetaIds(`https://business.facebook.com@evil.example/?business_id=${BUSINESS}`)).toBeNull();
    // asset_id seul
    expect(extractMetaIds(`https://business.facebook.com/latest/whatsapp_manager/overview/?asset_id=${WABA}`))
      .toEqual({ business_id: null, asset_id: WABA });
    // Paramètre en double : la première valeur
    expect(extractMetaIds(`https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}&business_id=99999999`))
      .toEqual({ business_id: BUSINESS, asset_id: null });
    // Fragment ignoré
    expect(extractMetaIds(`https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}#asset_id=${WABA}`))
      .toEqual({ business_id: BUSINESS, asset_id: null });
    expect(extractMetaIds(`https://business.facebook.com/latest/settings/business_info#business_id=${BUSINESS}`)).toBeNull();
    // Chiffres avec espaces
    expect(extractMetaIds(' 1270 6594 4848 9249 ')).toEqual({ business_id: BUSINESS, asset_id: null });
    // Entrées non reconnues
    expect(extractMetaIds('')).toBeNull();
    expect(extractMetaIds('   ')).toBeNull();
    expect(extractMetaIds('1234')).toBeNull();
    expect(extractMetaIds('1'.repeat(26))).toBeNull();
    expect(extractMetaIds('Wabagent')).toBeNull();
    expect(extractMetaIds('https://business.facebook.com/latest/settings/business_info')).toBeNull();
    expect(extractMetaIds('https://business.facebook.com/latest/settings/business_info?business_id=abc')).toBeNull();
    expect(extractMetaIds('ftp://business.facebook.com/?business_id=1270659448489249')).toBeNull();
    // Paramètre mal formé : seul l'autre est gardé
    expect(extractMetaIds(`https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=abc&asset_id=${WABA}`))
      .toEqual({ business_id: null, asset_id: WABA });
  });

  it('metaLinks : précis seulement avec le portefeuille', () => {
    const precise = metaLinks({ business_id: BUSINESS, waba_id: WABA });
    expect(precise.phoneNumbers).toEqual({ url: PHONE_NUMBERS, precise: true });
    expect(precise.managerOverview).toEqual({ url: OVERVIEW, precise: true });
    expect(precise.businessInfo).toEqual({
      url: `https://business.facebook.com/latest/settings/business_info?business_id=${BUSINESS}`, precise: true,
    });
    expect(precise.whatsappAccounts).toEqual({
      url: `https://business.facebook.com/latest/settings/whatsapp_business_presence/?business_id=${BUSINESS}`, precise: true,
    });
    // Forme non confirmée dans les vraies pages : jamais présentée comme précise dans ce lot (Ruling R-9)
    expect(precise.systemUsers).toEqual({
      url: `https://business.facebook.com/latest/settings/system_users?business_id=${BUSINESS}`, precise: false,
    });
    expect(precise.developerApps.precise).toBe(false);

    // Sans portefeuille : précis nulle part
    for (const ids of [{ business_id: null, waba_id: WABA }, { business_id: null, waba_id: null }]) {
      const links = metaLinks(ids);
      for (const link of Object.values(links)) expect(link.precise).toBe(false);
      expect(links.phoneNumbers.url).not.toContain('business_id');
      expect(links.systemUsers.url).toBe('https://business.facebook.com/latest/settings/');
    }
    // Sans portefeuille, l'adresse générique d'aujourd'hui (`whatsAppManagerUrl`)
    expect(metaLinks({ business_id: null, waba_id: WABA }).phoneNumbers.url)
      .toBe(`https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${WABA}`);

    // Portefeuille sans WABA : les pages d'une WABA restent génériques, celles du portefeuille sont précises
    const businessOnly = metaLinks({ business_id: BUSINESS, waba_id: null });
    expect(businessOnly.phoneNumbers.precise).toBe(false);
    expect(businessOnly.managerOverview.precise).toBe(false);
    expect(businessOnly.businessInfo.precise).toBe(true);
    expect(businessOnly.whatsappAccounts.precise).toBe(true);
    expect(businessOnly.developerApps.precise).toBe(false);

    // Identifiant qui n'est pas fait de chiffres : traité comme absent, jamais recopié dans une adresse
    const odd = metaLinks({ business_id: '12345&asset_id=1', waba_id: 'x/../y' });
    for (const link of Object.values(odd)) {
      expect(link.precise).toBe(false);
      expect(link.url).not.toContain('12345');
      expect(link.url).not.toContain('x/../y');
    }
  });
});
