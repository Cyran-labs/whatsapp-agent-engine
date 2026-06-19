/**
 * Connecteur Attio — push de leads vers Person + Company + Note, et optionnellement
 * création d'un Deal (stage configurable) + Task assignée (parité avec le flow
 * acquisition de la prod whatsapp-cyran-bot).
 *
 * Pourquoi Attio ne passe PAS par FieldMapper (contrairement à HubSpot) :
 * le modèle Attio est imbriqué (name: [{first_name,last_name}], email_addresses,
 * deals avec stage par ID, références people<->companies, notes, tasks), alors que
 * FieldMapper produit un Record<string,string> plat. La grammaire structurelle Attio
 * vit donc dans ce connecteur ; ce qui varie par tenant est externalisé dans AttioOptions
 * (apiKey, dealStageId, ownerMemberId, flags createDeal/createTask, noteTitle).
 *
 * Auth : API key Attio (Bearer). En P3 onboarding self-service, token chiffré par client en DB.
 */

import type {
  CRMConnector,
  NormalizedLead,
  NormalizedBooking,
} from './types.js';

const ATTIO_API_BASE = 'https://api.attio.com/v2';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 4000, 16000];
const TASK_DEADLINE_DAYS = 2;

export interface AttioOptions {
  apiKey: string;
  /** Crée un Deal en plus du Person+Company+Note (parité flow acquisition prod). */
  createDeal?: boolean;
  /** Stage ID du deal à créer (requis si createDeal). */
  dealStageId?: string;
  /** workspace_member_id propriétaire du deal et destinataire de la task (requis si createDeal/createTask). */
  ownerMemberId?: string;
  /** Crée une Task assignée à ownerMemberId (déclenche la notif mail Attio native). */
  createTask?: boolean;
  /** Titre de la note ajoutée sur la Person (défaut: "Lead WhatsApp"). */
  noteTitle?: string;
  timeoutMs?: number;
}

interface UpsertResult {
  personId: string | null;
  companyId: string | null;
}

export class AttioConnector implements CRMConnector {
  readonly connectorName = 'attio';

  private readonly apiKey: string;
  private readonly createDeal: boolean;
  private readonly dealStageId?: string;
  private readonly ownerMemberId?: string;
  private readonly createTask: boolean;
  private readonly noteTitle: string;
  private readonly timeoutMs: number;

  constructor(options: AttioOptions) {
    if (!options.apiKey) {
      throw new Error('[Attio] apiKey is required');
    }
    if (options.createDeal) {
      if (!options.dealStageId) {
        throw new Error('[Attio] dealStageId is required when createDeal is enabled');
      }
      // L'attribut `owner` du Deal est requis dans Attio (vérifié sur le schéma réel).
      // Sans owner, la création de Deal renverrait un 400 au runtime.
      if (!options.ownerMemberId) {
        throw new Error('[Attio] ownerMemberId is required when createDeal is enabled');
      }
    }
    if (options.createTask && !options.createDeal) {
      throw new Error('[Attio] createTask requires createDeal (la task est rattachée au deal)');
    }

    this.apiKey = options.apiKey;
    this.createDeal = options.createDeal ?? false;
    this.dealStageId = options.dealStageId;
    this.ownerMemberId = options.ownerMemberId;
    this.createTask = options.createTask ?? false;
    this.noteTitle = options.noteTitle ?? 'Lead WhatsApp';
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async pushLead(lead: NormalizedLead): Promise<void> {
    const { personId, companyId } = await this.upsertPersonAndCompany(lead);
    if (!personId) {
      console.error(`[Attio] pushLead: person upsert failed (${lead.email ?? lead.phone})`);
      throw new Error('[Attio] person upsert failed');
    }

    const fullName = `${lead.prenom ?? ''} ${lead.nom ?? ''}`.trim();

    if (this.createDeal) {
      await this.createDealWithTask(lead, personId, companyId, fullName);
    } else {
      await this.addNote('people', personId, this.buildLeadNote(lead), this.noteTitle);
      console.log(`[Attio] Note added for ${fullName || lead.phone}`);
    }
  }

  async updateLead(leadId: string, fields: Partial<NormalizedLead>): Promise<void> {
    // Attio upsert (PUT matching_attribute) est naturellement idempotent : on ré-upsert
    // la Person avec les champs enrichis. Pas de note pour éviter le bruit sur chaque update.
    const partial: Partial<NormalizedLead> = {
      ...fields,
      lead_id: leadId,
      updated_at: fields.updated_at ?? new Date().toISOString(),
    };
    const { personId } = await this.upsertPersonAndCompany(partial);
    if (!personId) {
      console.warn(`[Attio] updateLead: person upsert failed (lead_id=${leadId}), ignoring`);
      return;
    }
    console.log(`[Attio] updateLead: person enriched (lead_id=${leadId})`);
  }

  async pushBooking(booking: NormalizedBooking): Promise<void> {
    const partial: Partial<NormalizedLead> = {
      client_id: booking.client_id,
      bot_id: booking.bot_id,
      lead_id: booking.lead_id,
      phone: booking.phone,
      email: booking.invitee_email,
      prenom: booking.invitee_name,
      source: booking.source,
      updated_at: new Date().toISOString(),
    };

    const { personId } = await this.upsertPersonAndCompany(partial);
    if (!personId) {
      console.error(`[Attio] pushBooking: person upsert failed (${booking.phone})`);
      throw new Error('[Attio] person upsert failed');
    }

    const noteLines: string[] = [];
    noteLines.push(`RDV : ${booking.event_name}`);
    noteLines.push(`Début : ${booking.start_time}`);
    if (booking.end_time) noteLines.push(`Fin : ${booking.end_time}`);
    if (booking.notes) noteLines.push(`Notes : ${booking.notes}`);
    noteLines.push(`Source : ${booking.source}`);
    noteLines.push(`Phone : ${this.formatPhone(booking.phone)}`);

    await this.addNote('people', personId, noteLines.join('\n'), `${this.noteTitle} — RDV confirmé`);
    console.log(`[Attio] Booking note added (${booking.start_time})`);
  }

  // --- Person / Company ---

  /**
   * Upsert d'une Person (match par email si dispo, sinon par téléphone numérique),
   * lien optionnel à une Company (créée si absente). Retourne les IDs.
   */
  private async upsertPersonAndCompany(lead: Partial<NormalizedLead>): Promise<UpsertResult> {
    const firstName = lead.prenom ?? '';
    const lastName = lead.nom ?? '';
    const fullName = `${firstName} ${lastName}`.trim();

    const personValues: Record<string, unknown[]> = {};
    if (fullName) {
      personValues['name'] = [{ first_name: firstName, last_name: lastName, full_name: fullName }];
    }
    if (lead.email) {
      personValues['email_addresses'] = [{ email_address: lead.email }];
    }
    // Attio rejette les "numéros" alphanumériques (ex: wa_id / username). On ne range
    // dans phone_numbers que les téléphones réellement numériques ; sinon on matche par email.
    const phoneNumeric = lead.phone ? this.isNumericPhone(lead.phone) : false;
    if (lead.phone && phoneNumeric) {
      personValues['phone_numbers'] = [{ original_phone_number: this.formatPhone(lead.phone) }];
    }
    if (lead.fonction) {
      personValues['job_title'] = [{ value: lead.fonction }];
    }

    const matchAttr = lead.email ? 'email_addresses' : 'phone_numbers';
    if (matchAttr === 'phone_numbers' && !phoneNumeric) {
      console.warn(`[Attio] No email and non-numeric phone (${lead.phone}): upsert match unreliable`);
    }

    const personResult = await this.request<{ data?: { id?: { record_id?: string } } }>(
      'PUT',
      `/objects/people/records?matching_attribute=${matchAttr}`,
      { data: { values: personValues } }
    );
    const personId = personResult?.data?.id?.record_id ?? null;
    if (personId) {
      console.log(`[Attio] Person upserted: ${fullName || lead.phone} (${personId})`);
    }

    let companyId: string | null = null;
    if (lead.societe && personId) {
      companyId = await this.upsertCompany(lead.societe);
      if (companyId) {
        await this.request(
          'PUT',
          `/objects/people/records?matching_attribute=${matchAttr}`,
          { data: { values: { ...personValues, company: [{ target_object: 'companies', target_record_id: companyId }] } } }
        );
        console.log(`[Attio] Person linked to company: ${lead.societe}`);
      }
    }

    return { personId, companyId };
  }

  private async upsertCompany(name: string): Promise<string | null> {
    const search = await this.request<{ data?: Array<{ id?: { record_id?: string } }> }>(
      'POST',
      '/objects/companies/records/query',
      { filter: { name: { $eq: name } } }
    );
    const existing = search?.data?.[0]?.id?.record_id;
    if (existing) return existing;

    const created = await this.request<{ data?: { id?: { record_id?: string } } }>(
      'POST',
      '/objects/companies/records',
      { data: { values: { name: [{ value: name }] } } }
    );
    return created?.data?.id?.record_id ?? null;
  }

  // --- Deal + Task ---

  private async createDealWithTask(
    lead: NormalizedLead,
    personId: string,
    companyId: string | null,
    fullName: string,
  ): Promise<void> {
    const dealName = lead.societe ? `${lead.societe} — ${fullName}`.trim() : (fullName || lead.phone);

    const dealValues: Record<string, unknown> = {
      name: [{ value: dealName }],
      stage: [{ status: this.dealStageId }],
      // owner est requis sur le Deal (cf. validation constructeur).
      owner: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: this.ownerMemberId }],
      associated_people: [{ target_object: 'people', target_record_id: personId }],
    };
    if (companyId) {
      dealValues['associated_company'] = [{ target_object: 'companies', target_record_id: companyId }];
    }

    const dealResult = await this.request<{ data?: { id?: { record_id?: string } } }>(
      'POST',
      '/objects/deals/records',
      { data: { values: dealValues } }
    );
    const dealId = dealResult?.data?.id?.record_id ?? null;
    if (!dealId) {
      console.error('[Attio] Deal creation failed (no id returned)');
      throw new Error('[Attio] deal creation failed');
    }
    console.log(`[Attio] Deal created: ${dealName} (${dealId})`);

    await this.addNote('deals', dealId, this.buildLeadNote(lead), `${this.noteTitle} — ${fullName || lead.phone}`);

    if (this.createTask && this.ownerMemberId) {
      await this.createTaskForDeal(lead, dealId, fullName);
    }
  }

  private async createTaskForDeal(lead: NormalizedLead, dealId: string, fullName: string): Promise<void> {
    const content =
      `Nouveau lead WhatsApp qualifié : ${fullName || lead.phone}${lead.societe ? ` (${lead.societe})` : ''}.\n\n` +
      `Contact : ${this.formatPhone(lead.phone)}${lead.email ? ` — ${lead.email}` : ''}\n` +
      (lead.besoin ? `Besoin : ${lead.besoin}\n` : '') +
      'Voir le deal pour le détail.';

    // Attio exige un deadline_at valide (sinon 400 "Invalid date"). Échéance J+2.
    const deadlineAt = new Date(Date.now() + TASK_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await this.request('POST', '/tasks', {
      data: {
        content,
        format: 'plaintext',
        deadline_at: deadlineAt,
        is_completed: false,
        linked_records: [{ target_object: 'deals', target_record_id: dealId }],
        assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: this.ownerMemberId }],
      },
    });
    console.log(`[Attio] Task created and assigned for deal ${dealId}`);
  }

  // --- Note ---

  private async addNote(
    parentObject: 'people' | 'deals',
    parentRecordId: string,
    content: string,
    title: string,
  ): Promise<void> {
    await this.request('POST', '/notes', {
      data: {
        format: 'plaintext',
        title,
        content,
        parent_object: parentObject,
        parent_record_id: parentRecordId,
      },
    });
  }

  private buildLeadNote(lead: NormalizedLead): string {
    const lines: string[] = [];
    if (lead.fonction) lines.push(`Fonction : ${lead.fonction}`);
    if (lead.besoin) lines.push(`Besoin : ${lead.besoin}`);
    if (lead.budget) lines.push(`Budget : ${lead.budget}`);
    if (lead.stage) lines.push(`Stage : ${lead.stage}`);
    lines.push(`Contact : ${this.formatPhone(lead.phone)}${lead.email ? ` — ${lead.email}` : ''}`);
    if (lead.custom_fields) {
      for (const [key, value] of Object.entries(lead.custom_fields)) {
        if (value === undefined || value === null || value === '') continue;
        lines.push(`${key} : ${value}`);
      }
    }
    lines.push(`Source : ${lead.source}`);
    return lines.join('\n');
  }

  // --- Helpers ---

  /** Un téléphone exploitable par Attio phone_numbers = uniquement chiffres (optionnellement préfixé +). */
  private isNumericPhone(phone: string): boolean {
    return /^\+?\d+$/.test(phone.replace(/[\s.-]/g, ''));
  }

  private formatPhone(phone: string): string {
    if (!this.isNumericPhone(phone)) return phone;
    return phone.startsWith('+') ? phone : `+${phone.replace(/[\s.-]/g, '')}`;
  }

  /**
   * Requête HTTP Attio avec retry exponentiel + timeout.
   * Retry sur 429 et 5xx, fail-fast sur 4xx.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${ATTIO_API_BASE}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      }

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.ok) {
          return (await res.json()) as T;
        }

        const text = await res.text();

        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          console.error(`[Attio] ${method} ${path} client error ${res.status}: ${text.slice(0, 300)}`);
          throw new Error(`Attio ${res.status}: ${text.slice(0, 200)}`);
        }

        lastError = new Error(`Attio ${res.status}: ${text.slice(0, 200)}`);
        console.warn(`[Attio] ${method} ${path} retryable error ${res.status} (attempt ${attempt + 1}/${MAX_RETRIES})`);
      } catch (err) {
        lastError = err as Error;
        if (lastError.message.startsWith('Attio 4')) throw lastError;
        console.warn(`[Attio] ${method} ${path} attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    console.error(`[Attio] ${method} ${path} FAILED after ${MAX_RETRIES} attempts`);
    throw lastError ?? new Error('Attio request failed');
  }
}
