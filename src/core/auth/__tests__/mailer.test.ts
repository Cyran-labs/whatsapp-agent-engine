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

// revue isolation restitution I-3
describe('ConsoleMailer avec MAILER_LOG_LINKS=true', () => {
  it.each(['test', 'development', 'production', ''])('écrit le lien sans throw (NODE_ENV=%j)', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('MAILER_LOG_LINKS', 'true');
    const out = captureConsole();
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    const lines = out.lines();
    out.restore();
    expect(lines).toEqual([
      '[Mailer] Invitation WABAGENT pour x@y.test: https://app/invite?token=abc',
      '[Mailer] Réinitialisation WABAGENT pour x@y.test: https://app/reset?token=def',
    ]);
  });

  it('nomme le produit WABAGENT, jamais l\'ancien nom', async () => {
    vi.stubEnv('MAILER_LOG_LINKS', 'true');
    const out = captureConsole();
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    const lines = out.lines();
    out.restore();
    expect(lines.join('\n')).not.toMatch(/Flow Labs/i);
  });
});

// revue isolation restitution I-3, recette Q-9
describe('ConsoleMailer sans MAILER_LOG_LINKS=true', () => {
  const masked = [
    '[Mailer] Invitation créée pour c•••@x.fr : envoi d\'e-mail non configuré, lien non journalisé',
    '[Mailer] Réinitialisation créée pour c•••@x.fr : envoi d\'e-mail non configuré, lien non journalisé',
  ];

  async function send(): Promise<string[]> {
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
    return lines;
  }

  it.each(['production', 'development', 'test', ''])('n\'écrit jamais le lien ni l\'adresse en clair, variable absente (NODE_ENV=%j)', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('MAILER_LOG_LINKS', '');
    expect(await send()).toEqual(masked);
  });

  it.each(['false', '1', 'yes', 'TRUE', ' true', 'true '])('seule la valeur exacte « true » écrit le lien (%j)', async (value) => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MAILER_LOG_LINKS', value);
    expect(await send()).toEqual(masked);
  });

  it('MAILER_LOG_LINKS=false en production : le lien reste tu', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MAILER_LOG_LINKS', 'false');
    expect(await send()).toEqual(masked);
  });
});

// recette Q-9, revue isolation restitution I-3
describe('warnIfMailerNotConfigured', () => {
  const NOT_CONFIGURED = '[Mailer] Aucun envoi d\'e-mail configuré : les liens d\'invitation et de réinitialisation ne sont pas envoyés';
  const NOT_CONFIGURED_SILENT = '[Mailer] Aucun envoi d\'e-mail configuré : les liens d\'invitation et de réinitialisation ne sont ni envoyés ni journalisés';
  const LINKS_WRITTEN = '[Mailer] MAILER_LOG_LINKS=true : les liens d\'invitation et de réinitialisation sont écrits dans les journaux, à réserver au développement et à la recette';

  it.each(['production', 'development', 'test'])('avertit au démarrage que rien n\'est envoyé, sans écrire les liens (NODE_ENV=%s)', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('MAILER_LOG_LINKS', '');
    const out = captureConsole();
    warnIfMailerNotConfigured();
    const lines = out.lines();
    out.restore();
    expect(lines).toEqual([NOT_CONFIGURED_SILENT]);
  });

  it.each(['production', 'development'])('avec MAILER_LOG_LINKS=true, avertit aussi que les liens sont écrits dans les journaux (NODE_ENV=%s)', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('MAILER_LOG_LINKS', 'true');
    const out = captureConsole();
    warnIfMailerNotConfigured();
    const lines = out.lines();
    out.restore();
    expect(lines).toEqual([NOT_CONFIGURED, LINKS_WRITTEN]);
  });
});

describe('createMailer', () => {
  it('retourne un ConsoleMailer en V1', () => {
    expect(createMailer()).toBeInstanceOf(ConsoleMailer);
  });
});
