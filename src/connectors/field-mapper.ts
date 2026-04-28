/**
 * FieldMapper — moteur de mapping générique entre les champs Cyran (NormalizedLead)
 * et les propriétés d'un CRM cible (HubSpot, Salesforce, MAD CRM, ...).
 *
 * Stateless et déterministe : un même mapping + un même lead = toujours le même output.
 * Permet l'UI P3 (onboarding self-service) de prévisualiser le résultat avant save.
 *
 * Format JSON : voir connectors-config/{client_id}/{connector_type}.json
 * Doc : docs/CRM_INTEGRATION.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NormalizedLead } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPPINGS_DIR = path.join(__dirname, '..', '..', 'connectors-config');

export interface FieldMappingRule {
  source: string;
  target: string;
  transform?: string;
}

export interface FieldMappingFallback {
  target: string;
  concat_template?: string;
  include_unmapped?: boolean;
}

export interface FieldMappingDeduplication {
  primary_key: string;
  fallback_keys?: string[];
}

export interface FieldMappingFixedValues {
  on_create?: Record<string, string>;
  on_update?: Record<string, string>;
}

/**
 * Default values : appliqués uniquement si la target n'est pas déjà définie
 * par field_mapping. Permet d'avoir des fallbacks non destructifs (ex: si le
 * LLM n'a pas extrait `stage`, on met `lifecyclestage = "lead"` par défaut).
 */
export interface FieldMappingDefaultValues {
  on_create?: Record<string, string>;
  on_update?: Record<string, string>;
}

export interface FieldMapping {
  version: number;
  connector: string;
  target_object: string;
  client_id: string;
  field_mapping: FieldMappingRule[];
  /** Valeurs toujours imposées (écrasent field_mapping). Pour les invariants type "hs_lead_status: NEW". */
  fixed_values?: FieldMappingFixedValues;
  /** Valeurs par défaut (appliquées seulement si la target n'a pas déjà été définie par field_mapping). */
  default_values?: FieldMappingDefaultValues;
  fallback?: FieldMappingFallback;
  deduplication?: FieldMappingDeduplication;
}

export type MappingMode = 'create' | 'update';

export class FieldMapper {
  constructor(private readonly config: FieldMapping) {}

  /**
   * Applique le mapping et retourne les propriétés cibles à pousser au CRM.
   *
   * @param lead Le NormalizedLead source (ou un Partial pour les updates)
   * @param mode 'create' applique fixed_values.on_create, 'update' applique on_update
   */
  apply(lead: Partial<NormalizedLead>, mode: MappingMode = 'create'): Record<string, string> {
    const out: Record<string, string> = {};
    const mappedSources = new Set<string>();

    for (const rule of this.config.field_mapping) {
      const raw = readLeadField(lead, rule.source);
      if (raw === undefined || raw === null || raw === '') continue;

      let value = String(raw);
      if (rule.transform) {
        value = applyTransform(value, rule.transform);
      }

      if (out[rule.target]) {
        out[rule.target] = `${out[rule.target]}\n${value}`;
      } else {
        out[rule.target] = value;
      }
      mappedSources.add(rule.source);
    }

    const fb = this.config.fallback;
    if (fb) {
      const parts: string[] = [];

      if (fb.concat_template) {
        const rendered = renderTemplate(fb.concat_template, lead);
        if (rendered.trim().length > 0) parts.push(rendered);
      }

      if (fb.include_unmapped && lead.custom_fields) {
        for (const [key, value] of Object.entries(lead.custom_fields)) {
          if (mappedSources.has(key)) continue;
          if (value === undefined || value === null || value === '') continue;
          parts.push(`${key} : ${value}`);
        }
      }

      if (parts.length > 0) {
        const concat = parts.join('\n');
        if (out[fb.target]) {
          out[fb.target] = `${out[fb.target]}\n${concat}`;
        } else {
          out[fb.target] = concat;
        }
      }
    }

    const defaults = mode === 'create'
      ? this.config.default_values?.on_create
      : this.config.default_values?.on_update;
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        if (out[key] === undefined) {
          out[key] = value;
        }
      }
    }

    const fixed = mode === 'create'
      ? this.config.fixed_values?.on_create
      : this.config.fixed_values?.on_update;
    if (fixed) {
      for (const [key, value] of Object.entries(fixed)) {
        out[key] = value;
      }
    }

    return out;
  }

  /**
   * Résout la clé de dédup pour un lead donné.
   * Retourne le couple { targetField, value } à utiliser pour la recherche côté CRM,
   * ou null si aucun champ de dédup n'est disponible.
   *
   * Le `targetField` retourné est le nom de la property CRM (pas le champ Cyran),
   * et la valeur est déjà transformée (ex: phone en E.164).
   */
  resolveDedupKey(lead: Partial<NormalizedLead>): { targetField: string; value: string } | null {
    const dedup = this.config.deduplication;
    if (!dedup) return null;

    const candidates = [dedup.primary_key, ...(dedup.fallback_keys ?? [])];

    for (const sourceField of candidates) {
      const raw = readLeadField(lead, sourceField);
      if (raw === undefined || raw === null || raw === '') continue;

      const rule = this.config.field_mapping.find(r => r.source === sourceField);
      if (!rule) continue; // pas mappé côté CRM, on ne peut pas chercher

      let value = String(raw);
      if (rule.transform) value = applyTransform(value, rule.transform);

      return { targetField: rule.target, value };
    }

    return null;
  }

  /**
   * Liste les champs sources Cyran utilisés par ce mapping (utile pour l'UI P3).
   */
  listMappedSourceFields(): string[] {
    return Array.from(new Set(this.config.field_mapping.map(r => r.source)));
  }

  /**
   * Liste les champs cibles CRM utilisés par ce mapping (utile pour l'UI P3).
   */
  listMappedTargetFields(): string[] {
    const targets = new Set<string>();
    for (const rule of this.config.field_mapping) targets.add(rule.target);
    if (this.config.fallback) targets.add(this.config.fallback.target);
    if (this.config.fixed_values?.on_create) {
      for (const k of Object.keys(this.config.fixed_values.on_create)) targets.add(k);
    }
    if (this.config.default_values?.on_create) {
      for (const k of Object.keys(this.config.default_values.on_create)) targets.add(k);
    }
    return Array.from(targets);
  }
}

/**
 * Charge un mapping depuis un fichier JSON.
 * Path : connectors-config/{clientId}/{connectorType}.json
 */
export function loadMappingConfig(connectorType: string, clientId: string): FieldMapping {
  const filePath = path.join(MAPPINGS_DIR, clientId, `${connectorType}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[FieldMapper] Mapping not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as FieldMapping;

  if (parsed.connector !== connectorType) {
    throw new Error(`[FieldMapper] Mapping ${filePath}: connector mismatch (file says "${parsed.connector}", expected "${connectorType}")`);
  }
  if (parsed.client_id !== clientId) {
    throw new Error(`[FieldMapper] Mapping ${filePath}: client_id mismatch (file says "${parsed.client_id}", expected "${clientId}")`);
  }

  return parsed;
}

// --- Helpers ---

function readLeadField(lead: Partial<NormalizedLead>, key: string): unknown {
  const direct = (lead as Record<string, unknown>)[key];
  if (direct !== undefined) return direct;

  if (lead.custom_fields && key in lead.custom_fields) {
    return lead.custom_fields[key];
  }
  return undefined;
}

function applyTransform(value: string, transform: string): string {
  if (transform === 'e164') {
    const digits = value.replace(/\D/g, '');
    if (digits.startsWith('00')) return '+' + digits.slice(2);
    if (value.startsWith('+')) return value;
    return '+' + digits;
  }
  if (transform === 'lowercase') return value.toLowerCase();
  if (transform === 'uppercase') return value.toUpperCase();
  if (transform === 'trim') return value.trim();
  if (transform.startsWith('truncate:')) {
    const n = parseInt(transform.slice('truncate:'.length), 10);
    if (!Number.isFinite(n) || n <= 0) return value;
    return value.slice(0, n);
  }
  console.warn(`[FieldMapper] Unknown transform: ${transform}`);
  return value;
}

function renderTemplate(template: string, lead: Partial<NormalizedLead>): string {
  // Substitue {key} par la valeur correspondante. Si le résultat est vide,
  // on retire la ligne entière (pour éviter "Besoin : " sans valeur).
  return template
    .split('\n')
    .map(line => {
      let hasValue = false;
      const rendered = line.replace(/\{(\w+)\}/g, (_, key) => {
        const v = readLeadField(lead, key);
        if (v !== undefined && v !== null && v !== '') {
          hasValue = true;
          return String(v);
        }
        return '';
      });
      return hasValue ? rendered : null;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}
