import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../bot-config.js';

// Le router ne doit faire AUCUNE écriture ni consulter de session : le module db.js est simulé
// pour vérifier qu'aucune de ses fonctions de session n'est appelée (contrat lecture seule,
// cf. vérif HMAC avant persistance).
vi.mock('../db.js', () => ({
  getSession: vi.fn(),
  createSessionIfAbsent: vi.fn(),
  touchSession: vi.fn(),
}));
vi.mock('../bot-config.js', () => ({
  findBotByNumber: vi.fn(),
  loadBotConfig: vi.fn(),
}));

import { routeIncomingMessage } from '../router.js';
import { getSession, createSessionIfAbsent, touchSession } from '../db.js';
import { findBotByNumber, loadBotConfig } from '../bot-config.js';

const getSessionMock = vi.mocked(getSession);
const createSessionMock = vi.mocked(createSessionIfAbsent);
const touchSessionMock = vi.mocked(touchSession);
const findBotMock = vi.mocked(findBotByNumber);
const loadBotMock = vi.mocked(loadBotConfig);

function cfg(): BotConfig {
  return { client_id: 'c1', bot_id: 'b1', transport: 'meta-cloud' } as BotConfig;
}

function expectNoSessionAccess(): void {
  expect(getSessionMock).not.toHaveBeenCalled();
  expect(createSessionMock).not.toHaveBeenCalled();
  expect(touchSessionMock).not.toHaveBeenCalled();
}

describe('routeIncomingMessage (lecture seule)', () => {
  afterEach(() => vi.clearAllMocks());

  it('route par numéro destinataire, sans lire ni écrire de session', async () => {
    findBotMock.mockReturnValue(cfg());
    const route = await routeIncomingMessage('33600000000', '15550000000');
    expect(route).toMatchObject({ client_id: 'c1', bot_id: 'b1' });
    expect(findBotMock).toHaveBeenCalledWith('15550000000');
    expectNoSessionAccess();
  });

  // audit 1.1 : une session ne change jamais l'agent IA routé.
  it('une session existante pour un autre agent IA ne change pas le routage', async () => {
    getSessionMock.mockResolvedValue({ wa_number: '+15550000000', phone: '33600000000', client_id: 'autre', bot_id: 'ancien' } as never);
    findBotMock.mockReturnValue(cfg());
    const route = await routeIncomingMessage('33600000000', '15550000000');
    expect(route).toMatchObject({ client_id: 'c1', bot_id: 'b1' });
    expect(loadBotMock).not.toHaveBeenCalled();
    expectNoSessionAccess();
  });

  it('aucun bot pour le numéro : null', async () => {
    findBotMock.mockReturnValue(null);
    expect(await routeIncomingMessage('33600000000', '00000000000')).toBeNull();
    expectNoSessionAccess();
  });
});
