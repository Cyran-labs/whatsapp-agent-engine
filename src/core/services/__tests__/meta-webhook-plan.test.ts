import { describe, expect, it } from 'vitest';
import { classifyAppWebhook, hostOf, metaWebhookUrl } from '../meta-webhook-plan.js';

const KEY = 'cle-de-webhook-0123456789abcdefghijklmnopq';

describe('adresse du webhook Meta inscrite par WABAGENT (lot R1)', () => {
  it('URL inscrite sans double barre (base avec barres finales, base avec un chemin)', () => {
    expect(metaWebhookUrl('https://dev.wabagent.com/', KEY)).toBe(`https://dev.wabagent.com/webhook/meta/${KEY}`);
    expect(metaWebhookUrl('https://dev.wabagent.com//', KEY)).toBe(`https://dev.wabagent.com/webhook/meta/${KEY}`);
    expect(metaWebhookUrl('https://dev.wabagent.com', KEY)).toBe(`https://dev.wabagent.com/webhook/meta/${KEY}`);
    expect(metaWebhookUrl('https://dev.wabagent.com/moteur/', KEY)).toBe(`https://dev.wabagent.com/moteur/webhook/meta/${KEY}`);
  });

  it('hostOf : domaine seul, jamais le chemin ni la clé ; null pour une adresse illisible', () => {
    expect(hostOf(`https://autre-produit.example.com/hooks/${KEY}?x=1`)).toBe('autre-produit.example.com');
    expect(hostOf('https://autre.example.com:8443/a')).toBe('autre.example.com');
    expect(hostOf('pas une adresse')).toBeNull();
    expect(hostOf('')).toBeNull();
  });

  describe('classifyAppWebhook', () => {
    const base = 'https://dev.wabagent.com/';
    const ours = [`https://dev.wabagent.com/webhook/meta/${KEY}`, 'https://dev.wabagent.com/webhook/meta/autre-cle-du-meme-org'];

    it("rien d'inscrit : empty", () => {
      expect(classifyAppWebhook(null, base, ours)).toBe('empty');
      expect(classifyAppWebhook('', base, ours)).toBe('empty');
    });

    it("adresse d'un compte connecté de la même organisation et de la même app : ours", () => {
      expect(classifyAppWebhook(ours[1]!, base, ours)).toBe('ours');
    });

    it("adresse de WABAGENT qui n'est pas dans la liste (compte retiré, autre compte) : other_account_of_ours", () => {
      expect(classifyAppWebhook('https://dev.wabagent.com/webhook/meta/cle-d-un-compte-retire', base, ours)).toBe('other_account_of_ours');
    });

    it("adresse hors de WABAGENT, ou qui ne fait que commencer comme la base : elsewhere", () => {
      expect(classifyAppWebhook('https://autre-produit.example.com/hooks', base, ours)).toBe('elsewhere');
      expect(classifyAppWebhook('https://dev.wabagent.com.attaquant.example/webhook/meta/x', base, ours)).toBe('elsewhere');
      expect(classifyAppWebhook('https://dev.wabagent.com/autre-chemin', base, ours)).toBe('elsewhere');
    });

    it('une liste vide ne rend jamais ours', () => {
      expect(classifyAppWebhook(ours[0]!, base, [])).toBe('other_account_of_ours');
    });
  });
});
