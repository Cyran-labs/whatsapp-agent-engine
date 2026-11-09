import type { Database, BotRecord, PersonalityFields } from '../database/types.js';
import type { BotStatus } from '../database/whatsapp-types.js';
import { ALLOWLIST_MAX, type ActivateBotInput, type AssignNumberInput, type BotNumberSummary, type CreateBotInput, type UnassignNumberInput, type UpdateBotInput } from '@wabagent/contracts';
import { refreshBotConfig, upsertBot } from '../config-store.js';
import { recordAudit } from '../audit.js';
import { AppError, botNotFound, conflict, notFound, validationError } from '../../api/errors.js';
import { normalizeAllowlistEntry } from '../phone.js';
import {
  ASSIGN_NUMBER_REMOVED_MESSAGE, HOLDER_CHANGED_MESSAGE, HOLDER_CHANGED_PATH, TRANSITION_MESSAGES,
  type ErrorReason, type TransitionRefusal,
} from '@wabagent/contracts';
import { isSignatureRejected } from '../../webhooks/signature-monitor.js';
import { loadBotNumberSummary } from './bot-number-summary.js';
import { composeSystemPrompt, isComposableLanguage } from './personality.js';

/**
 * Agent IA tel que l'API le renvoie : son numéro branché (avec l'état affiché de son compte), sa liste d'accès
 * limité et le compteur de messages non servis (spec 2b §8.1 à §8.4). Le transport découle du compte du numéro.
 */
export interface BotDetail extends BotRecord {
  whatsapp_number: BotNumberSummary | null;
  allowlist: string[];
  unserved: { count: number; last_at: string | null };
}
export type BotSummary = BotDetail;

export interface BotServiceDeps { db: Database; }

/** Branchement : l'agent IA ou le numéro est inconnu dans l'organisation (un numéro d'une autre organisation aussi). */
const BOT_OR_NUMBER_NOT_FOUND = 'Agent IA ou numéro WhatsApp introuvable.';
const INVALID_ENTRY_MESSAGE = 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.';
/** Machine d'états et branchement : le compte aux signatures rejetées en série compte comme non connecté (choix 4). */
const TOPOLOGY_OPTIONS = { isAccountBlocked: isSignatureRejected };

/**
 * Valide chaque entrée de la liste d'accès limité (une erreur par indice, sous `path`), normalise (E.164 ou BSUID),
 * fusionne les doublons, puis refuse plus de 20 entrées (erreur sur `path`).
 */
function normalizeAllowlist(entries: string[], path: string): string[] {
  const details: { path: string; message: string }[] = [];
  const normalized: string[] = [];
  entries.forEach((entry, i) => {
    const value = normalizeAllowlistEntry(entry);
    if (value === null) details.push({ path: `${path}.${i}`, message: INVALID_ENTRY_MESSAGE });
    else normalized.push(value);
  });
  if (details.length > 0) throw validationError(details, undefined, 'allowlist.invalid_entry');
  const unique = [...new Set(normalized)];
  if (unique.length > ALLOWLIST_MAX) {
    throw validationError([{ path, message: `${ALLOWLIST_MAX} entrées au plus.` }], undefined, 'allowlist.too_many');
  }
  return unique;
}

/**
 * Refus du store : `not_found` en 404 (agent IA ou numéro inconnu dans l'organisation), le reste en 409.
 * `number_removed` a deux sens : au branchement (`assign`) c'est le numéro choisi qui est retiré ; au changement de
 * statut c'est le numéro actuel de l'agent IA. Le 404 du branchement porte une seule clé, que le numéro soit absent
 * ou tenu par une autre organisation (isolation).
 */
function refusal(reason: 'not_found' | 'holder_changed' | TransitionRefusal, assign: boolean): AppError {
  if (reason === 'not_found') {
    return assign ? notFound(BOT_OR_NUMBER_NOT_FOUND, 'assign.not_found') : botNotFound();
  }
  if (reason === 'number_removed' && assign) return conflict(ASSIGN_NUMBER_REMOVED_MESSAGE, 'assign.number_removed');
  if (reason === 'holder_changed') {
    return new AppError('CONFLICT', HOLDER_CHANGED_MESSAGE, [{ path: HOLDER_CHANGED_PATH, message: HOLDER_CHANGED_MESSAGE }], 'assign.holder_changed');
  }
  const key: ErrorReason = `transition.${reason}`;
  return conflict(TRANSITION_MESSAGES[reason], key);
}

/**
 * Resout les prompts par langue : compose depuis personality (langue guidee),
 * preserve le system_prompt fourni (langue brute). Valide une source pour defaultLang.
 */
function resolvePrompts(
  defaultLang: string,
  systemPrompt: Record<string, string>,
  personality: Record<string, PersonalityFields> | null,
): { system_prompt: Record<string, string>; personality: Record<string, PersonalityFields> | null } {
  const out: Record<string, string> = { ...systemPrompt };
  if (personality) {
    for (const [lang, fields] of Object.entries(personality)) {
      if (!isComposableLanguage(lang)) {
        throw validationError([{ path: 'personality', message: `Langue non supportée pour la composition guidée : ${lang}.` }]);
      }
      out[lang] = composeSystemPrompt(fields, lang);
    }
  }
  if (!out[defaultLang]?.trim()) {
    throw validationError(
      [{ path: 'system_prompt', message: `Aucune personnalité ni prompt pour la langue par défaut (${defaultLang}).` }],
      undefined,
      'bot.default_language_missing',
    );
  }
  return { system_prompt: out, personality: personality ?? null };
}

function inputToRecord(clientId: string, input: CreateBotInput, entityId: number): BotRecord {
  const resolved = resolvePrompts(input.default_language, input.system_prompt, input.personality);
  return {
    client_id: clientId,
    bot_id: input.bot_id,
    name: input.name,
    status: 'draft',
    status_reason: null,
    default_language: input.default_language,
    languages: input.languages,
    system_prompt: resolved.system_prompt,
    lead_fields: input.lead_fields,
    welcome: input.welcome,
    error_messages: input.error_messages,
    catalog: input.catalog,
    llm: input.llm,
    crm: input.crm,
    personality: resolved.personality,
    entity_id: entityId,
  };
}

export class BotService {
  private readonly db: Database;
  constructor(deps: BotServiceDeps) { this.db = deps.db; }

  private async detail(rec: BotRecord): Promise<BotDetail> {
    const [whatsappNumber, allowlist, runtime] = await Promise.all([
      loadBotNumberSummary(this.db, rec.client_id, rec.bot_id),
      this.db.getAllowlist(rec.client_id, rec.bot_id),
      this.db.getBotRuntimeState(rec.client_id, rec.bot_id),
    ]);
    return {
      ...rec,
      whatsapp_number: whatsappNumber,
      allowlist,
      unserved: { count: runtime?.unserved_count ?? 0, last_at: runtime?.unserved_last_at ?? null },
    };
  }

  /** Une entité demandée doit être une entité active de l'organisation. */
  private async assertActiveEntity(clientId: string, entityId: number): Promise<void> {
    const entity = await this.db.getEntity(clientId, entityId);
    if (!entity || entity.status !== 'active') {
      throw validationError([{ path: 'entity_id', message: 'Entité introuvable ou archivée.' }], undefined, 'bot.entity_unavailable');
    }
  }

  /** Entité fournie (contrôlée), sinon l'unique entité active de l'organisation. */
  private async resolveEntityForCreate(clientId: string, entityId: number | undefined): Promise<number> {
    if (entityId !== undefined) {
      await this.assertActiveEntity(clientId, entityId);
      return entityId;
    }
    const active = await this.db.listEntities(clientId);
    const only = active[0];
    if (!only || active.length > 1) {
      throw validationError([{ path: 'entity_id', message: 'Choisissez une entité.' }], undefined, 'bot.entity_required');
    }
    return only.id;
  }

  /** Agent IA de l'organisation, sinon 404 (un agent IA d'une autre organisation répond comme un agent IA inconnu). */
  private async requireBot(clientId: string, botId: string): Promise<BotRecord> {
    const rec = await this.db.getBotRecord(clientId, botId);
    if (!rec) throw botNotFound();
    return rec;
  }

  async listBots(clientId: string): Promise<BotSummary[]> {
    const recs = (await this.db.listBotRecords()).filter((r) => r.client_id === clientId);
    return Promise.all(recs.map((r) => this.detail(r)));
  }

  async getBot(clientId: string, botId: string): Promise<BotDetail> {
    return this.detail(await this.requireBot(clientId, botId));
  }

  async createBot(clientId: string, actorUserId: number | null, input: CreateBotInput): Promise<BotDetail> {
    if (await this.db.getBotRecord(clientId, input.bot_id)) throw conflict('bot_id déjà pris.', 'bot.id_taken');
    const entityId = await this.resolveEntityForCreate(clientId, input.entity_id);
    const rec = inputToRecord(clientId, input, entityId);
    await upsertBot(rec);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.create', target: `bot:${clientId}/${rec.bot_id}`, client_id: clientId, metadata: { name: rec.name } });
    return this.getBot(clientId, rec.bot_id);
  }

  /** Contenu seulement : le statut n'est jamais écrit ici (revue 2b-1 I-3), il passe par `setStatus`. */
  async updateBot(clientId: string, botId: string, actorUserId: number | null, patch: UpdateBotInput): Promise<BotDetail> {
    const existing = await this.requireBot(clientId, botId);
    const mergedDefaultLang = patch.default_language ?? existing.default_language;
    const mergedSystemPrompt = patch.system_prompt ?? existing.system_prompt;
    const mergedPersonality = patch.personality !== undefined ? patch.personality : existing.personality;
    const resolved = resolvePrompts(mergedDefaultLang, mergedSystemPrompt, mergedPersonality);
    if (patch.entity_id !== undefined) await this.assertActiveEntity(clientId, patch.entity_id);
    const merged: BotRecord = {
      ...existing,
      ...(patch.entity_id !== undefined ? { entity_id: patch.entity_id } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      default_language: mergedDefaultLang,
      ...(patch.languages !== undefined ? { languages: patch.languages } : {}),
      system_prompt: resolved.system_prompt,
      personality: resolved.personality,
      ...(patch.lead_fields !== undefined ? { lead_fields: patch.lead_fields } : {}),
      ...(patch.welcome !== undefined ? { welcome: patch.welcome } : {}),
      ...(patch.error_messages !== undefined ? { error_messages: patch.error_messages } : {}),
      ...(patch.catalog !== undefined ? { catalog: patch.catalog } : {}),
      ...(patch.llm !== undefined ? { llm: patch.llm } : {}),
      ...(patch.crm !== undefined ? { crm: patch.crm } : {}),
    };
    await upsertBot(merged);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.update', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: null });
    if (patch.entity_id !== undefined && patch.entity_id !== existing.entity_id) {
      await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.entity', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { from: existing.entity_id, to: patch.entity_id } });
    }
    return this.getBot(clientId, botId);
  }

  /** Changement de statut par la machine d'états du store, faits relus dans sa transaction (audit 3.5). */
  async setStatus(clientId: string, botId: string, actorUserId: number | null, status: BotStatus): Promise<BotDetail> {
    const result = await this.db.transitionBotStatus(clientId, botId, status, TOPOLOGY_OPTIONS);
    if (!result.ok) throw refusal(result.reason, false);
    await refreshBotConfig(clientId, botId);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.status', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { from: result.from, to: result.to } });
    return this.getBot(clientId, botId);
  }

  /**
   * Branche un numéro inventorié de l'organisation (spec 2b §7.5) : l'agent IA qui le tenait le perd (repasse en
   * brouillon s'il était en accès limité ou actif), l'agent IA cible quitte son ancien numéro, en une transaction.
   */
  async assignNumber(clientId: string, botId: string, actorUserId: number | null, input: AssignNumberInput): Promise<BotDetail> {
    const numberId = input.number_id;
    const result = await this.db.assignNumber(clientId, botId, numberId, { ...TOPOLOGY_OPTIONS, expectedHolder: { kind: 'expected', bot_id: input.expected_bot_id } });
    if (!result.ok) throw refusal(result.reason, true);
    await refreshBotConfig(clientId, botId);
    if (result.previous_bot_id !== null) await refreshBotConfig(clientId, result.previous_bot_id);
    if (result.changed) {
      await recordAudit(this.db, {
        actor_user_id: actorUserId, action: 'bot.number', target: `bot:${clientId}/${botId}`, client_id: clientId,
        metadata: { from_number_id: result.previous_number_id, to_number_id: numberId, previous_bot_id: result.previous_bot_id },
      });
    }
    return this.getBot(clientId, botId);
  }

  /**
   * Débranche le numéro de l'agent IA (qui repasse en brouillon s'il servait). `expected_number_id` est le numéro que
   * l'écran affichait : s'il n'est plus celui de l'agent IA (ou s'il n'en a plus), 409 et rien n'est écrit (revue finale 2b-3 I-2).
   */
  async unassignNumber(clientId: string, botId: string, actorUserId: number | null, input: UnassignNumberInput): Promise<BotDetail> {
    await this.requireBot(clientId, botId);
    // Identifiant du numéro libéré lu par le store dans sa transaction : l'audit porte l'état réellement changé.
    const result = await this.db.unassignNumber(clientId, botId, input.expected_number_id);
    if (!result.ok) throw refusal(result.reason, false);
    await refreshBotConfig(clientId, botId);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'bot.number', target: `bot:${clientId}/${botId}`, client_id: clientId,
      metadata: { from_number_id: result.number_id, to_number_id: null, previous_bot_id: null },
    });
    return this.getBot(clientId, botId);
  }

  /**
   * Remplace la liste d'accès limité (spec 2b §8.3). Une liste vide est enregistrée même pour un agent IA `limited`
   * (il ne répond alors à personne, spec §8.3). L'audit ne porte que le nombre d'entrées.
   */
  async setAllowlist(clientId: string, botId: string, actorUserId: number | null, entries: string[]): Promise<BotDetail> {
    const normalized = normalizeAllowlist(entries, 'entries');
    const result = await this.db.replaceAllowlist(clientId, botId, normalized);
    if (!result.ok) throw refusal(result.reason, false);
    await recordAudit(this.db, { actor_user_id: actorUserId, action: 'bot.allowlist', target: `bot:${clientId}/${botId}`, client_id: clientId, metadata: { count: normalized.length } });
    return this.getBot(clientId, botId);
  }

  /**
   * Activation en une opération (spec 2b §8.2) : branchement, liste d'accès limité et transition dans une seule
   * transaction du store ; un refus annule tout. En `limited`, la liste fournie remplace la liste (vide : refus).
   * En `active` (numéro de test depuis le brouillon), une liste vide laisse la liste existante en place.
   */
  async activate(clientId: string, botId: string, actorUserId: number | null, input: ActivateBotInput): Promise<BotDetail> {
    const allowlist = normalizeAllowlist(input.allowlist, 'allowlist');
    const written = input.status === 'limited' || allowlist.length > 0 ? allowlist : null;
    const result = await this.db.activateWithNumber(
      clientId, botId, input.number_id, input.status, written, { ...TOPOLOGY_OPTIONS, expectedHolder: { kind: 'expected', bot_id: input.expected_bot_id } },
    );
    if (!result.ok) throw refusal(result.reason, true);
    await refreshBotConfig(clientId, botId);
    const previous = result.assign?.ok ? result.assign.previous_bot_id : null;
    if (previous !== null) await refreshBotConfig(clientId, previous);
    const detail = await this.getBot(clientId, botId);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'bot.activate', target: `bot:${clientId}/${botId}`, client_id: clientId,
      metadata: { status: input.status, number_id: input.number_id, count: detail.allowlist.length },
    });
    return detail;
  }
}
