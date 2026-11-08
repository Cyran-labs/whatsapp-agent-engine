import pLimit from 'p-limit';
import { config } from './config.js';
import { getConversation, addMessage, saveLead, getLeadData, getDatabase } from './db.js';
import { chat, withRetry, getClientForTenant } from '../llm/anthropic.js';
import type { ChatMessage } from '../llm/anthropic.js';
import { recordUsage } from '../llm/usage-recorder.js';
import { resolveLlmCredentials } from './credentials/resolver.js';
import type { Transport } from '../transport/index.js';
import { TransportSendError } from '../transport/types.js';
import { events } from './events.js';
import type { BotConfig } from './bot-config.js';

const llmLimit = pLimit(10);

async function extractAndSaveLead(
  phone: string,
  botCfg: BotConfig,
  conversation: Array<{ role: string; content: string }>,
  existingProfile?: Record<string, unknown> | null,
  profileName?: string
): Promise<void> {
  if (conversation.length < 2) return;

  const convText = conversation
    .map((m) => `${m.role === 'user' ? 'Prospect' : 'Bot'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const systemPrompt = `Extract lead qualification data from this WhatsApp conversation as compact JSON.
Only include fields confirmed by explicit user statements. Fields to extract: ${botCfg.lead_fields}
Return ONLY a valid JSON object. If nothing to extract yet, return {}.`;

  const userContent = existingProfile && Object.keys(existingProfile).length > 0
    ? `EXISTING PROFILE:\n${JSON.stringify(existingProfile)}\n\nLATEST MESSAGES:\n${convText}`
    : convText;

  const client = await getClientForTenant(botCfg.client_id, botCfg.bot_id);
  const response = await llmLimit(() =>
    withRetry(() =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      })
    )
  );

  resolveLlmCredentials(botCfg.client_id, botCfg.bot_id)
    .then((res) => recordUsage({
      clientId: botCfg.client_id, botId: botCfg.bot_id, phone,
      callType: 'lead_extraction', mode: res.mode,
      model: 'claude-haiku-4-5-20251001', usage: (response as { usage?: unknown }).usage,
    }))
    .catch(() => {});

  const block = response.content[0];
  if (block?.type !== 'text') return;

  const match = block.text.match(/\{[\s\S]*\}/);
  if (!match) return;

  const extracted = JSON.parse(match[0]) as Record<string, unknown>;
  const keys = Object.keys(extracted);
  if (keys.length === 0) return;

  await saveLead(phone, botCfg.client_id, botCfg.bot_id, extracted);
  console.log(`[LeadExtractor] Saved: ${keys.join(', ')}`);

  // Émission de l'événement lead.qualified pour les connecteurs CRM (fire-and-forget).
  // Le merge avec existingProfile garantit que le payload contient TOUS les champs
  // déjà connus, pas seulement ceux qui viennent d'être ajoutés. Le connecteur fait
  // l'upsert de son côté (création ou update via dédup email/phone).
  const merged = { ...(existingProfile ?? {}), ...extracted };
  const isNewLead = !existingProfile || Object.keys(existingProfile).length === 0;
  const now = new Date().toISOString();

  events.publishLead({
    type: isNewLead ? 'qualified' : 'updated',
    changed_fields: keys,
    lead: {
      client_id: botCfg.client_id,
      bot_id: botCfg.bot_id,
      lead_id: phone,
      phone,
      profile_name: profileName,
      // Champs canoniques NormalizedLead (français pour rétrocompat avec l'extracteur historique).
      // Le FieldMapper côté connecteur accepte aussi les variantes anglaises (first_name, etc.).
      prenom: stringOrUndef(merged['prenom'] ?? merged['first_name']),
      nom: stringOrUndef(merged['nom'] ?? merged['last_name']),
      email: stringOrUndef(merged['email']),
      societe: stringOrUndef(merged['societe'] ?? merged['company']),
      fonction: stringOrUndef(merged['fonction'] ?? merged['job_title'] ?? merged['position']),
      besoin: stringOrUndef(merged['besoin'] ?? merged['need']),
      budget: stringOrUndef(merged['budget']),
      stage: stringOrUndef(merged['stage'] ?? merged['lifecycle_stage']),
      // Tout le reste (champs custom du bot) va dans custom_fields.
      // Le FieldMapper peut les inclure dans le fallback (concat dans message).
      custom_fields: collectCustomFields(merged),
      source: `whatsapp-${botCfg.client_id}-${botCfg.bot_id}`,
      created_at: (existingProfile?.['created_at'] as string | undefined) ?? now,
      updated_at: now,
    },
  });
}

const KNOWN_LEAD_KEYS = new Set([
  'prenom', 'first_name',
  'nom', 'last_name',
  'email',
  'phone', 'profileName', 'profile_name',
  'societe', 'company',
  'fonction', 'job_title', 'position',
  'besoin', 'need',
  'budget',
  'stage', 'lifecycle_stage',
  'created_at', 'updated_at',
]);

function stringOrUndef(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

function collectCustomFields(lead: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead)) {
    if (KNOWN_LEAD_KEYS.has(k)) continue;
    const str = stringOrUndef(v);
    if (str !== undefined) out[k] = str;
  }
  return out;
}

interface BotResponse {
  type: 'text' | 'buttons' | 'list' | 'image' | 'image_buttons' | 'image_cta' | 'cta'
      | 'product' | 'product_list' | 'catalog';
  text?: string;
  options?: string[];
  button?: string;
  sections?: Array<{ title: string; options?: string[]; product_retailer_ids?: string[] }>;
  url?: string;
  caption?: string;
  cta_text?: string;
  cta_button?: string;
  cta_url?: string;
  product_retailer_id?: string;
  header?: string;
  footer?: string;
}

export function parseAllResponses(raw: string): BotResponse[] {
  const responses: BotResponse[] = [];
  const trimmed = raw.trim();

  let leadingText = '';
  const firstBraceIdx = trimmed.indexOf('{');
  if (firstBraceIdx > 0) {
    leadingText = trimmed.slice(0, firstBraceIdx).trim();
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, i + 1)) as BotResponse;
          if (parsed.type) responses.push(parsed);
        } catch {
          // skip malformed block
        }
        start = -1;
      }
    }
  }

  if (leadingText && responses.length > 0) {
    const first = responses[0];
    if (!first.text || first.text.trim() === '') {
      first.text = leadingText;
      console.log(`[Bot] Injected leading text into empty ${first.type} block`);
    }
  }

  if (responses.length > 1) {
    const merged: BotResponse[] = [];
    for (let i = 0; i < responses.length; i++) {
      const curr = responses[i];
      const prev = merged[merged.length - 1];
      if (
        prev?.type === 'text' &&
        prev.text &&
        curr.type !== 'text' &&
        (!curr.text || curr.text.trim() === '')
      ) {
        curr.text = prev.text;
        merged[merged.length - 1] = curr;
        console.log(`[Bot] Merged text block into ${curr.type} block`);
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  if (responses.length > 0) return responses;

  console.warn(`[Bot] Reponse non-JSON de Claude: ${trimmed.slice(0, 120)}`);
  return [{ type: 'text', text: trimmed }];
}

const INTERNAL_ROUTES = new Set(['/health', '/webhook', '/images']);

async function dispatchResponse(transport: Transport, to: string, response: BotResponse, botCfg: BotConfig): Promise<void> {
  if (response.url) {
    if (response.url.startsWith('/')) {
      const firstSegment = '/' + (response.url.split('/')[1] || '');
      if (INTERNAL_ROUTES.has(firstSegment)) {
        response.url = config.baseUrl + response.url;
      } else {
        console.warn(`[Bot] URL relative hallucinee rejetee: ${response.url}`);
        response.url = config.baseUrl;
      }
    }
    if (response.url.includes('calendly.com')) {
      const params: string[] = [];
      if (!response.url.includes('utm_content=')) {
        params.push(`utm_content=${to}`);
      }
      const lead = await getLeadData(to, botCfg.client_id, botCfg.bot_id);
      if (lead) {
        const firstName = (lead['first_name'] as string) || (lead['prenom'] as string) || '';
        const lastName = (lead['last_name'] as string) || (lead['nom'] as string) || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const email = (lead['email'] as string) || '';
        if (fullName) params.push(`name=${encodeURIComponent(fullName)}`);
        if (email) params.push(`email=${encodeURIComponent(email)}`);
      }
      if (params.length > 0) {
        const sep = response.url.includes('?') ? '&' : '?';
        response.url = `${response.url}${sep}${params.join('&')}`;
      }
    }
  }

  switch (response.type) {
    case 'buttons':
      if (response.options && response.options.length >= 2) {
        await transport.sendButtons(
          to,
          response.text || '',
          response.options.slice(0, 3).map((opt, i) => {
            const title = opt.length > 20 ? opt.slice(0, 20).trimEnd() : opt;
            if (opt.length > 20) {
              console.warn(`[Bot] Button label truncated (>20 chars): "${opt}" -> "${title}"`);
            }
            return { id: `btn_${i}`, title };
          })
        );
      } else {
        await transport.sendText(to, response.text || '');
      }
      break;

    case 'list': {
      const listSections = (response.sections || [])
        .filter(s => s.options && s.options.length > 0)
        .map(s => ({ title: s.title, options: s.options as string[] }));
      if (listSections.length > 0) {
        await transport.sendList(
          to,
          response.text || '',
          response.button || 'Voir les options',
          listSections
        );
      } else {
        await transport.sendText(to, response.text || '');
      }
      break;
    }

    case 'image':
      if (response.url) {
        await transport.sendImage(to, response.url, response.caption);
      }
      break;

    case 'image_buttons':
      if (response.url && response.options && response.options.length >= 2) {
        await transport.sendImage(to, response.url, response.text || '');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await transport.sendButtons(
          to,
          'Que souhaitez-vous faire ?',
          response.options.slice(0, 3).map((opt, i) => {
            const title = opt.length > 20 ? opt.slice(0, 20).trimEnd() : opt;
            if (opt.length > 20) {
              console.warn(`[Bot] Button label truncated (>20 chars): "${opt}" -> "${title}"`);
            }
            return { id: `btn_${i}`, title };
          })
        );
      } else if (response.url) {
        await transport.sendImage(to, response.url, response.text);
      } else {
        await transport.sendText(to, response.text || '');
      }
      break;

    case 'cta':
      if (response.url) {
        await transport.sendCta(to, response.text || '', response.button || 'En savoir plus', response.url);
      } else {
        await transport.sendText(to, response.text || '');
      }
      break;

    case 'image_cta':
      if (response.url && response.cta_url) {
        await transport.sendImage(to, response.url, response.text || '');
        await new Promise(resolve => setTimeout(resolve, 3500));
        await transport.sendCta(
          to,
          response.cta_text || 'Consultez la fiche complète :',
          response.cta_button || 'Voir la fiche',
          response.cta_url,
        );
      } else if (response.url) {
        await transport.sendImage(to, response.url, response.text);
      } else {
        await transport.sendText(to, response.text || '');
      }
      break;

    case 'catalog':
      await transport.sendCatalog(to, response.text || 'Voici notre catalogue', response.footer);
      break;

    case 'product': {
      const catalogId = botCfg.catalog?.meta_catalog_id || '';
      if (!catalogId || !response.product_retailer_id) {
        console.warn(`[Bot] product message skipped: missing catalog_id or product_retailer_id`);
        await transport.sendText(to, response.text || '');
        break;
      }
      await transport.sendProduct(to, response.text || '', catalogId, response.product_retailer_id, response.footer);
      break;
    }

    case 'product_list': {
      const catalogId = botCfg.catalog?.meta_catalog_id || '';
      if (!catalogId || !response.sections || response.sections.length === 0) {
        console.warn(`[Bot] product_list message skipped: missing catalog_id or sections`);
        await transport.sendText(to, response.text || '');
        break;
      }
      const sections = response.sections
        .filter(s => s.product_retailer_ids && s.product_retailer_ids.length > 0)
        .map(s => ({
          title: s.title.slice(0, 24),
          product_retailer_ids: (s.product_retailer_ids || []).slice(0, 30),
        }));
      if (sections.length === 0) {
        await transport.sendText(to, response.text || '');
        break;
      }
      await transport.sendProductList(to, response.text || '', response.header || 'Nos produits', catalogId, sections);
      break;
    }

    case 'text':
    default:
      await transport.sendText(to, response.text || '');
      break;
  }
}

/**
 * Contexte d'une conversation entrante, construit par l'appelant après la vérification de signature
 * et la création de la session : agent IA routé, transport déjà résolu, numéro destinataire normalisé.
 */
export interface ConversationContext {
  bot: BotConfig;
  transport: Transport;
  /** Numéro destinataire WhatsApp normalisé (E.164). */
  waNumber: string;
  contactId: string;
  messageId: string;
  profileName?: string;
}

const AUTH_ERROR_MESSAGE = 'Jeton refusé par le fournisseur WhatsApp.';

/**
 * Un refus d'authentification du fournisseur signale que le jeton du transport n'est plus valide :
 * l'erreur est enregistrée sur l'état d'exécution de l'agent IA pour apparaître dans le tableau de bord.
 * Les autres genres d'erreur d'envoi ne disent rien de la validité des identifiants.
 */
async function reportSendError(ctx: ConversationContext, err: unknown): Promise<void> {
  if (!(err instanceof TransportSendError) || err.kind !== 'auth') return;
  try {
    await getDatabase().setTransportValidation(ctx.bot.client_id, ctx.bot.bot_id, null, AUTH_ERROR_MESSAGE);
    console.warn(`[Bot] Jeton refusé par le fournisseur pour ${ctx.bot.client_id}/${ctx.bot.bot_id}`);
  } catch (dbErr) {
    console.error('[Bot] Impossible d\'enregistrer l\'erreur de transport:', dbErr instanceof Error ? dbErr.message : dbErr);
  }
}

/**
 * Prépare l'historique pour l'API du LLM, qui attend un premier message `user`.
 * Les messages `assistant` en tête (accueil envoyé avant le premier message du contact) sont retirés
 * de la liste et rendus à part, pour être donnés au LLM dans le prompt.
 */
export function buildLlmMessages(
  history: Array<{ role: string; content: string }>
): { messages: ChatMessage[]; leadingAssistant: string[] } {
  let firstUser = 0;
  while (firstUser < history.length && history[firstUser]?.role === 'assistant') firstUser++;
  return {
    leadingAssistant: history.slice(0, firstUser).map((m) => m.content),
    messages: history.slice(firstUser).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  };
}

export async function handleMessage(ctx: ConversationContext, text: string): Promise<void> {
  const { bot: botCfg, transport, contactId: phone, messageId, profileName } = ctx;
  console.log(`[Bot] Message reçu (${botCfg.client_id}/${botCfg.bot_id})`);

  let typingTimeout: ReturnType<typeof setTimeout> | undefined;
  const scheduleTyping = () => {
    if (!messageId) return;
    const jitter = 8000 + Math.random() * 7000;
    typingTimeout = setTimeout(() => {
      transport.sendTypingIndicator(phone, messageId).catch(() => {});
      scheduleTyping();
    }, jitter);
  };
  if (messageId) {
    transport.sendReadReceipt(messageId).catch(() => {});
    transport.sendTypingIndicator(phone, messageId).catch(() => {});
    scheduleTyping();
  }

  try {
    await saveLead(phone, botCfg.client_id, botCfg.bot_id, { phone, ...(profileName ? { profileName } : {}) });

    await addMessage(phone, botCfg.client_id, botCfg.bot_id, 'user', text);
    events.publish({
      phone,
      client_id: botCfg.client_id,
      bot_id: botCfg.bot_id,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });

    const history = (await getConversation(phone, botCfg.client_id, botCfg.bot_id, 20)).reverse();
    const { messages, leadingAssistant } = buildLlmMessages(history);

    const basePrompt = botCfg.system_prompt
      .replace(/\{\{BASE_URL\}\}/g, config.baseUrl)
      .replace(/\{\{PHONE\}\}/g, phone);

    const dynamicParts: Array<{ text: string; cache?: boolean }> = [];

    if (leadingAssistant.length > 0) {
      dynamicParts.push({
        text: `## Messages déjà envoyés au contact\nMessages déjà envoyés au contact, à ne pas répéter :\n${leadingAssistant.map((m) => `- ${m}`).join('\n')}`,
      });
    }

    if (profileName) {
      dynamicParts.push({
        text: `## Contexte prospect\nNom du profil WhatsApp : "${profileName}"\nUtilise ce nom pour personnaliser l'accueil.`,
      });
    }

    const leadProfile = await getLeadData(phone, botCfg.client_id, botCfg.bot_id);
    if (leadProfile && Object.keys(leadProfile).length > 0) {
      const { phone: _p, profileName: _pn, ...displayProfile } = leadProfile;
      if (Object.keys(displayProfile).length > 0) {
        dynamicParts.push({
          text: `## Profil prospect connu\nDonnees deja collectees (ne pas les redemander) :\n${JSON.stringify(displayProfile, null, 2)}`,
        });
      }
    }

    let rawResponse: string;
    try {
      rawResponse = await llmLimit(() =>
        chat(
          [
            { text: basePrompt, cache: true },
            ...dynamicParts,
          ],
          messages,
          { clientId: botCfg.client_id, botId: botCfg.bot_id, model: botCfg.llm?.model }
        )
      );
    } catch (err) {
      console.error(`[Bot] LLM error:`, err);
      try {
        await transport.sendText(phone, 'Désolé, je rencontre un problème technique. Réessayez dans un instant.');
      } catch (sendErr) {
        await reportSendError(ctx, sendErr);
        console.error('[Bot] Message de repli non envoyé:', sendErr instanceof Error ? sendErr.message : sendErr);
      }
      return;
    }
    console.log(`[Bot] Réponse reçue (${rawResponse.length} caractères)`);

    // L'enregistrement et la publication ne doivent jamais empêcher l'envoi de la réponse au contact.
    try {
      await addMessage(phone, botCfg.client_id, botCfg.bot_id, 'assistant', rawResponse);
    } catch (err) {
      console.error(`[Bot] Réponse non enregistrée (${botCfg.client_id}/${botCfg.bot_id}): ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      events.publish({
        phone,
        client_id: botCfg.client_id,
        bot_id: botCfg.bot_id,
        role: 'assistant',
        content: rawResponse,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Bot] Événement de réponse non publié (${botCfg.client_id}/${botCfg.bot_id}): ${err instanceof Error ? err.message : String(err)}`);
    }

    const responses = parseAllResponses(rawResponse);
    for (let i = 0; i < responses.length; i++) {
      const parsed = responses[i];
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      console.log(`[Bot] Dispatching type=${parsed.type}`);
      try {
        await dispatchResponse(transport, phone, parsed, botCfg);
      } catch (dispatchErr) {
        await reportSendError(ctx, dispatchErr);
        console.error(`[Bot] Dispatch failed for type=${parsed.type}:`, dispatchErr);
        // Jeton refusé : les envois suivants échoueraient aussi, inutile d'attendre ni de réessayer.
        if (dispatchErr instanceof TransportSendError && dispatchErr.kind === 'auth') break;
      }
    }

    // L'indicateur de saisie n'a plus de sens une fois la réponse envoyée.
    if (typingTimeout) clearTimeout(typingTimeout);

    // Extraction attendue (plus de tâche détachée) pour qu'elle reste sous le verrou du contact.
    // Un échec d'extraction ne fait jamais échouer le traitement du message.
    try {
      const fullHistory = (await getConversation(phone, botCfg.client_id, botCfg.bot_id, 30)).reverse();
      const existingProfile = await getLeadData(phone, botCfg.client_id, botCfg.bot_id);
      await extractAndSaveLead(phone, botCfg, fullHistory, existingProfile, profileName);
    } catch (err) {
      console.error(`[LeadExtractor] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    if (typingTimeout) clearTimeout(typingTimeout);
  }
}

export async function handleWelcome(ctx: ConversationContext): Promise<void> {
  const { bot: botCfg, transport, contactId: phone, messageId, profileName } = ctx;
  if (!botCfg.welcome.enabled) {
    return;
  }

  if (messageId) {
    await transport.sendReadReceipt(messageId).catch(() => {});
    await transport.sendTypingIndicator(phone, messageId).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const message = botCfg.welcome.message.replace(/\{profileName\}/g, profileName || '');
  try {
    await transport.sendText(phone, message);
  } catch (err) {
    await reportSendError(ctx, err);
    throw err;
  }
  // Le texte réellement envoyé est enregistré : le LLM le voit ensuite dans le contexte de la conversation.
  // L'accueil est parti : un échec d'enregistrement est journalisé sans être propagé.
  try {
    await addMessage(phone, botCfg.client_id, botCfg.bot_id, 'assistant', message);
  } catch (err) {
    console.error(`[Welcome] Accueil envoyé mais non enregistré (${botCfg.client_id}/${botCfg.bot_id}): ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`[Welcome] Envoyé (${botCfg.client_id}/${botCfg.bot_id})`);
}
