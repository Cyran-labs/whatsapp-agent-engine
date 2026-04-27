import { EventEmitter } from 'events';

export interface BotEvent {
  phone: string;
  client_id: string;
  bot_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const MAX_EVENTS = 100;
const EVENT_NAME = 'message';

class BotEventEmitter extends EventEmitter {
  private recent: BotEvent[] = [];

  publish(event: BotEvent): boolean {
    this.recent.unshift(event);
    if (this.recent.length > MAX_EVENTS) {
      this.recent = this.recent.slice(0, MAX_EVENTS);
    }
    return super.emit(EVENT_NAME, event);
  }

  subscribe(listener: (event: BotEvent) => void): this {
    return super.on(EVENT_NAME, listener);
  }

  getRecentMessages(limit = 20, filter?: { phone?: string; client_id?: string; bot_id?: string }): BotEvent[] {
    let msgs = this.recent;
    if (filter?.phone) msgs = msgs.filter(e => e.phone === filter.phone);
    if (filter?.client_id) msgs = msgs.filter(e => e.client_id === filter.client_id);
    if (filter?.bot_id) msgs = msgs.filter(e => e.bot_id === filter.bot_id);
    return msgs.slice(0, limit);
  }

  reset(): void {
    this.recent = [];
  }

  getActivePhones(): string[] {
    const seen = new Set<string>();
    this.recent.forEach(e => seen.add(e.phone));
    return Array.from(seen);
  }
}

export const events = new BotEventEmitter();
events.setMaxListeners(0);
