import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleMailer, createMailer, warnIfMailerNotConfigured } from '../mailer.js';

function captureConsole(): { lines: () => string[]; restore: () => void } {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  return {
    lines: () => spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => String(a)).join(' '))),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ConsoleMailer hors production', () => {
  it('logue le lien sans throw', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('nomme le produit WABAGENT, jamais l\'ancien nom', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toBe('[Mailer] Invitation WABAGENT pour x@y.test: https://app/invite?token=abc');
    expect(lines[1]).toBe('[Mailer] Réinitialisation WABAGENT pour x@y.test: https://app/reset?token=def');
    expect(lines.join('\n')).not.toMatch(/Flow Labs/i);
    spy.mockRestore();
  });
});

// recette Q-9
describe('ConsoleMailer en production', () => {
  it('n\'écrit jamais le lien ni l\'adresse en clair, seulement l\'adresse masquée', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const out = captureConsole();
    const m = new ConsoleMailer();
    await m.sendInvitation('claire.bernard@x.fr', 'https://app/invite?token=SECRETINVITE');
    await m.sendPasswordReset('claire.bernard@x.fr', 'https://app/reset?token=SECRETRESET');
    const lines = out.lines();
    out.restore();
    const all = lines.join('\n');
    expect(all).not.toContain('SECRETINVITE');
    expect(all).not.toContain('SECRETRESET');
    expect(all).not.toContain('https://app');
    expect(all).not.toContain('claire.bernard');
    expect(lines).toEqual([
      '[Mailer] Invitation créée pour c•••@x.fr : envoi d\'e-mail non configuré, lien non journalisé',
      '[Mailer] Réinitialisation créée pour c•••@x.fr : envoi d\'e-mail non configuré, lien non journalisé',
    ]);
  });
});

// recette Q-9
describe('warnIfMailerNotConfigured', () => {
  it('avertit une fois au démarrage en production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const out = captureConsole();
    warnIfMailerNotConfigured();
    const lines = out.lines();
    out.restore();
    expect(lines).toEqual(['[Mailer] Aucun envoi d\'e-mail configuré : les liens d\'invitation et de réinitialisation ne sont pas journalisés en production']);
  });

  it('se tait hors production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const out = captureConsole();
    warnIfMailerNotConfigured();
    const lines = out.lines();
    out.restore();
    expect(lines).toEqual([]);
  });
});

describe('createMailer', () => {
  it('retourne un ConsoleMailer en V1', () => {
    expect(createMailer()).toBeInstanceOf(ConsoleMailer);
  });
});
