import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../bot-config.js';

// Le router ne doit faire AUCUNE écriture : createSession est exposé ici pour
// vérifier qu'il n'est jamais appelé (contrat lecture seule, cf. vérif HMAC avant persistance).
vi.mock('../db.js', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock('../bot-config.js', () => ({
  findBotByNumber: vi.fn(),
  loadBotConfig: vi.fn(),
}));

import { routeIncomingMessage } from '../router.js';
import { getSession, createSession } from '../db.js';
import { findBotByNumber, loadBotConfig } from '../bot-config.js';

const getSessionMock = vi.mocked(getSession);
const createSessionMock = vi.mocked(createSession);
const findBotMock = vi.mocked(findBotByNumber);
const loadBotMock = vi.mocked(loadBotConfig);

function cfg(): BotConfig {
  return { client_id: 'c1', bot_id: 'b1', transport: 'meta-cloud' } as BotConfig;
}

describe('routeIncomingMessage (lecture seule)', () => {
  afterEach(() => vi.clearAllMocks());

  it('nouvelle session : route sans écrire (pas de createSession)', async () => {
    getSessionMock.mockResolvedValue(undefined);
    findBotMock.mockReturnValue(cfg());
    const route = await routeIncomingMessage('33600000000', '15550000000');
    expect(route).toMatchObject({ client_id: 'c1', bot_id: 'b1', is_new_session: true });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('session existante : is_new_session false, pas d\'écriture', async () => {
    getSessionMock.mockResolvedValue({ client_id: 'c1', bot_id: 'b1' } as never);
    loadBotMock.mockReturnValue(cfg());
    const route = await routeIncomingMessage('33600000000', '15550000000');
    expect(route).toMatchObject({ is_new_session: false });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('aucun bot pour le numéro : null', async () => {
    getSessionMock.mockResolvedValue(undefined);
    findBotMock.mockReturnValue(null);
    expect(await routeIncomingMessage('33600000000', '00000000000')).toBeNull();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
