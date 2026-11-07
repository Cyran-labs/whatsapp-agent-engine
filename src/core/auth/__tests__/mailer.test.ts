import { describe, expect, it, vi } from 'vitest';
import { ConsoleMailer } from '../mailer.js';

describe('ConsoleMailer', () => {
  it('logue le lien sans throw', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    await m.sendAccessGranted('x@y.test', 'Acme');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(String(spy.mock.calls[2]![0])).toContain('Acme');
    spy.mockRestore();
  });
});
