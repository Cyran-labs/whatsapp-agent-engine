import { EventEmitter } from 'events';
import type { NormalizedLead } from '../connectors/types.js';

/**
 * Bus d'événements interne du moteur.
 *
 * 2 canaux distincts :
 *   - `message` : flux des messages user/assistant (live dashboard)
 *   - `lead`    : événements métier de qualification (consommés par les connecteurs CRM)
 */

export interface BotEvent {
  phone: string;
  client_id: string;
  bot_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface LeadEvent {
  /** Type d'événement métier */
  type: 'qualified' | 'updated';
  /** Lead normalisé prêt à être consommé par un connecteur CRM */
  lead: NormalizedLead;
  /** Liste des champs ajoutés/modifiés par cette extraction (utile pour les events updated) */
  changed_fields: string[];
}

const MAX_EVENTS = 100;
const MESSAGE_EVENT = 'message';
const LEAD_EVENT = 'lead';

class CyranEventBus extends EventEmitter {
  private recentMessages: BotEvent[] = [];

  // --- Canal "message" : conversations user/assistant ---

  publish(event: BotEvent): boolean {
    this.recentMessages.unshift(event);
    if (this.recentMessages.length > MAX_EVENTS) {
      this.recentMessages = this.recentMessages.slice(0, MAX_EVENTS);
    }
    return super.emit(MESSAGE_EVENT, event);
  }

  subscribe(listener: (event: BotEvent) => void): this {
    return super.on(MESSAGE_EVENT, listener);
  }

  getRecentMessages(limit = 20, filter?: { phone?: string; client_id?: string; bot_id?: string }): BotEvent[] {
    let msgs = this.recentMessages;
    if (filter?.phone) msgs = msgs.filter(e => e.phone === filter.phone);
    if (filter?.client_id) msgs = msgs.filter(e => e.client_id === filter.client_id);
    if (filter?.bot_id) msgs = msgs.filter(e => e.bot_id === filter.bot_id);
    return msgs.slice(0, limit);
  }

  reset(): void {
    this.recentMessages = [];
  }

  getActivePhones(): string[] {
    const seen = new Set<string>();
    this.recentMessages.forEach(e => seen.add(e.phone));
    return Array.from(seen);
  }

  // --- Canal "lead" : événements métier consommés par les connecteurs CRM ---

  publishLead(event: LeadEvent): boolean {
    return super.emit(LEAD_EVENT, event);
  }

  subscribeLead(listener: (event: LeadEvent) => void): this {
    return super.on(LEAD_EVENT, listener);
  }
}

export const events = new CyranEventBus();
events.setMaxListeners(0);
