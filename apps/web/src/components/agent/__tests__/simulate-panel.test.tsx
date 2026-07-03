import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SimulatePanel } from '../simulate-panel';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ session_id: 's1', reply: 'Bonjour !' }),
  })));
});

test('envoie un message et affiche la réponse (use_bot_config:false)', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <SimulatePanel botId="b1" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
  await userEvent.type(screen.getByRole('textbox'), 'Salut');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByText('Bonjour !')).toBeInTheDocument());
  const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(call[1].body as string)).toMatchObject({ use_bot_config: false });
});

test('bouton fermer appelle onClose', async () => {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <SimulatePanel botId="b1" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Fermer|×/ }));
  expect(onClose).toHaveBeenCalled();
});
