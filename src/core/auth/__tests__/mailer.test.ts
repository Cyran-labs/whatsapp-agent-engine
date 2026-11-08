import { describe, expect, it, vi } from 'vitest';
import { ConsoleMailer } from '../mailer.js';

describe('ConsoleMailer', () => {
  it('logue le lien sans throw', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('nomme le produit WABAGENT, jamais l\'ancien nom', async () => {
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
