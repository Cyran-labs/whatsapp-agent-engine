import pLimit from 'p-limit';
import { config } from './config.js';
import { getConversation, addMessage, saveLead, getLeadData, getCrossConversations } from './db.js';
import { chat, client, withRetry } from '../llm/anthropic.js';
import { getTransportForBot } from '../transport/index.js';
import type { Transport } from '../transport/index.js';
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

const INTERNAL_ROUTES = new Set(['/dashboard', '/health', '/webhook', '/images']);

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

export async function handleMessage(
  phone: string,
  text: string,
  botCfg: BotConfig,
  messageId?: string,
  profileName?: string
): Promise<void> {
  console.log(`[Bot] Message from ${phone} (${botCfg.client_id}/${botCfg.bot_id}): ${text.slice(0, 80)}`);

  const transport = getTransportForBot(botCfg);

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
  const messages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const basePrompt = botCfg.system_prompt
    .replace(/\{\{BASE_URL\}\}/g, config.baseUrl)
    .replace(/\{\{PHONE\}\}/g, phone);

  const dynamicParts: Array<{ text: string; cache?: boolean }> = [];

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

  const crossHistory = await getCrossConversations(phone, botCfg.client_id, botCfg.bot_id, 10);
  if (crossHistory.length > 0) {
    const crossLines = crossHistory
      .reverse()
      .map(m => `[${m.bot_id}/${m.role}] ${m.content.slice(0, 200)}`)
      .join('\n');
    dynamicParts.push({
      text: `## Historique cross-bot\nCe prospect a aussi echange avec d'autres bots :\n${crossLines}`,
    });
  }

  try {
    const chatModel = botCfg.llm?.model;
    const rawResponse = await llmLimit(() =>
      chat(
        [
          { text: basePrompt, cache: true },
          ...dynamicParts,
        ],
        messages,
        chatModel
      )
    );
    console.log(`[Bot] Raw response: ${rawResponse.slice(0, 400)}`);

    await addMessage(phone, botCfg.client_id, botCfg.bot_id, 'assistant', rawResponse);
    events.publish({
      phone,
      client_id: botCfg.client_id,
      bot_id: botCfg.bot_id,
      role: 'assistant',
      content: rawResponse,
      timestamp: new Date().toISOString(),
    });

    const responses = parseAllResponses(rawResponse);
    for (let i = 0; i < responses.length; i++) {
      const parsed = responses[i];
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      console.log(`[Bot] Dispatching type=${parsed.type} to ${phone}`);
      try {
        await dispatchResponse(transport, phone, parsed, botCfg);
      } catch (dispatchErr) {
        console.error(`[Bot] Dispatch failed for type=${parsed.type}:`, dispatchErr);
      }
    }

    const fullHistory = (await getConversation(phone, botCfg.client_id, botCfg.bot_id, 30)).reverse();
    const existingProfile = await getLeadData(phone, botCfg.client_id, botCfg.bot_id);
    extractAndSaveLead(phone, botCfg, fullHistory, existingProfile, profileName).catch((err: Error) => {
      console.error(`[LeadExtractor] Error: ${err.message}`);
    });
  } catch (err) {
    console.error(`[Bot] LLM error:`, err);
    await transport.sendText(phone, 'Désolé, je rencontre un problème technique. Réessayez dans un instant.');
  } finally {
    if (typingTimeout) clearTimeout(typingTimeout);
  }
}

export async function handleWelcome(
  phone: string,
  botCfg: BotConfig,
  messageId?: string,
  profileName?: string
): Promise<void> {
  if (!botCfg.welcome.enabled) {
    return;
  }

  const transport = getTransportForBot(botCfg);

  if (messageId) {
    await transport.sendReadReceipt(messageId).catch(() => {});
    await transport.sendTypingIndicator(phone, messageId).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const message = botCfg.welcome.message.replace(/\{profileName\}/g, profileName || '');
  await transport.sendText(phone, message);
  await addMessage(phone, botCfg.client_id, botCfg.bot_id, 'assistant', '[Welcome]');
  console.log(`[Welcome] Sent to ${phone} (${botCfg.client_id}/${botCfg.bot_id})`);
}
