'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ALLOWLIST_ENTRY_MAX, ALLOWLIST_MAX } from '@wabagent/contracts';
import { formatPhone } from '@/lib/whatsapp-display';

interface Props {
  entries: string[];
  /** Refus du moteur par indice de ligne (le parent lit le chemin `…<i>` de ses détails), affichés sous la ligne. */
  errors: Record<number, string>;
  onChange: (entries: string[]) => void;
  disabled?: boolean;
  /** Saisie en cours, pas encore ajoutée : le parent peut ainsi refuser d'enregistrer une saisie perdue. */
  onDraftChange?: (draft: string) => void;
}

const FIELD = 'min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-[13px] py-2.5 font-mono text-[13px] text-fg disabled:cursor-not-allowed disabled:opacity-50';
const ADD = 'rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-[13px] font-semibold text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Liste d'accès limité d'un agent IA : numéros E.164 ou identifiants WhatsApp, `ALLOWLIST_MAX` au plus.
 * Le format est jugé par le moteur (il normalise et fusionne les doublons) : ici on ne fait que tenir la liste.
 */
export function AllowlistEditor({ entries, errors, onChange, disabled = false, onDraftChange }: Props) {
  const t = useTranslations('allowlist');
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const reasonId = `${baseId}-reason`;
  const [draft, setDraftState] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  const full = entries.length >= ALLOWLIST_MAX;
  const value = draft.trim();
  const reason = full
    ? t('full', { max: ALLOWLIST_MAX })
    : duplicate
      ? t('duplicate')
      : value === ''
        ? t('needValue')
        : t('hint');

  const setDraft = (next: string) => {
    setDraftState(next);
    onDraftChange?.(next);
  };

  const type = (next: string) => {
    setDuplicate(false);
    setDraft(next);
  };

  const add = () => {
    if (disabled || full || value === '') return;
    // Un numéro déjà listé n'est pas ajouté une seconde fois : le champ se vide et le dit.
    if (entries.includes(value)) setDuplicate(true);
    else {
      setDuplicate(false);
      onChange([...entries, value]);
    }
    setDraft('');
  };

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-semibold text-fg">{t('label')}</label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="tel"
          autoComplete="off"
          value={draft}
          maxLength={ALLOWLIST_ENTRY_MAX}
          placeholder={t('placeholder')}
          disabled={disabled || full}
          aria-describedby={reasonId}
          onChange={(event) => type(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
          className={FIELD}
        />
        <button type="button" onClick={add} disabled={disabled || full || value === ''} aria-describedby={reasonId} className={ADD}>
          {t('add')}
        </button>
      </div>
      <p id={reasonId} className="mt-1.5 text-[12.5px] text-muted-2">{reason}</p>

      {entries.length === 0 ? (
        <p className="mt-2.5 text-[13px] text-muted">{t('empty')}</p>
      ) : (
        <ul aria-label={t('listLabel')} className="mt-2.5 divide-y divide-border rounded-lg border border-border bg-surface">
          {entries.map((entry, index) => (
            <li key={`${index}-${entry}`} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="break-all font-mono text-[13px] text-fg">{formatPhone(entry)}</span>
                <button
                  type="button"
                  onClick={() => onChange(entries.filter((_, i) => i !== index))}
                  disabled={disabled}
                  aria-label={t('remove', { entry: formatPhone(entry) })}
                  className="shrink-0 text-[12.5px] font-semibold text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('removeShort')}
                </button>
              </div>
              {errors[index] && <p role="alert" className="mt-1 text-[12.5px] text-danger">{errors[index]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
