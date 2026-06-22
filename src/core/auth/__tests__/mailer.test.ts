import { describe, expect, it, vi } from 'vitest';
import { ConsoleMailer } from '../mailer.js';

describe('ConsoleMailer', () => {
  it('logue le lien sans throw', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = new ConsoleMailer();
    await m.sendInvitation('x@y.test', 'https://app/invite?token=abc');
    await m.sendPasswordReset('x@y.test', 'https://app/reset?token=def');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
