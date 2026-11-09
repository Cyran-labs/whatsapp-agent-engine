'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { isServingStatus, type WhatsAppAccountView, type WhatsAppNumberView } from '@wabagent/contracts';
import { formatPhone, metaAppUrl } from '@/lib/whatsapp-display';

export interface PickerGroup {
  account: WhatsAppAccountView;
  numbers: WhatsAppNumberView[];
}

/**
 * Numéros proposables, groupés par compte : numéros présents chez le fournisseur des comptes connectés ou en erreur
 * (un compte déconnecté n'a plus d'identifiants, un numéro retiré n'existe plus). Le moteur décide de l'activation.
 */
export function selectableGroups(accounts: WhatsAppAccountView[]): PickerGroup[] {
  return accounts
    .filter((account) => account.state === 'connected' || account.state === 'error')
    .map((account) => ({ account, numbers: account.numbers.filter((n) => n.provider_state === 'present') }))
    .filter((group) => group.numbers.length > 0);
}

interface Props {
  accounts: WhatsAppAccountView[];
  selectedId: number | null;
  /** Agent IA pour lequel on choisit : son propre numéro n'est ni « utilisé par un autre » ni un avertissement. */
  currentBotId: string | null;
  onSelect: (numberId: number) => void;
}

const TAG = 'whitespace-nowrap rounded-pill border border-border px-2 py-0.5 text-[11px] font-semibold';
const NOTE = 'mb-2 mt-1 rounded-lg px-3 py-2.5 text-[12.5px]';

interface OptionProps {
  account: WhatsAppAccountView;
  number: WhatsAppNumberView;
  name: string;
  selected: boolean;
  currentBotId: string | null;
  onSelect: (numberId: number) => void;
}

function Option({ account, number, name, selected, currentBotId, onSelect }: OptionProps) {
  const t = useTranslations('numberPicker');
  const baseId = useId();
  const bot = number.bot;
  const isCurrent = bot !== null && bot.bot_id === currentBotId;
  const usedByOther = bot !== null && !isCurrent;
  const swapId = `${baseId}-swap`;
  const testId = `${baseId}-test`;
  const describedBy = selected ? [usedByOther ? swapId : null, number.is_test ? testId : null].filter(Boolean).join(' ') : '';
  const serving = bot !== null && isServingStatus(bot.status);

  return (
    <>
      <label
        className={`mb-[7px] flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-[11px] focus-within:ring-2 focus-within:ring-accent-ink ${
          selected ? 'border-accent-ink bg-accent-soft' : `border-border-strong ${usedByOther ? 'bg-surface-subtle' : 'bg-surface'}`
        }`}
      >
        <input
          type="radio"
          name={name}
          checked={selected}
          onChange={() => onSelect(number.id)}
          aria-describedby={describedBy || undefined}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 rounded-full ${selected ? 'border-[5px] border-accent-ink' : 'border-[1.5px] border-border-strong'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[13px]">{formatPhone(number.phone_e164)}</span>
          <span className="block text-xs text-muted-2">
            {number.display_name}
            {bot === null && ` · ${t('free')}`}
          </span>
        </span>
        {number.is_test && <span className={`${TAG} bg-tertiary-soft text-tertiary-ink`}>{t('testBadge')}</span>}
        {isCurrent && <span className={`${TAG} bg-accent-soft text-accent-ink`}>{t('current')}</span>}
        {usedByOther && <span className={`${TAG} bg-warning-soft text-warning-ink`}>{t('usedBy', { bot: bot.name })}</span>}
      </label>
      {selected && usedByOther && (
        <p id={swapId} className={`${NOTE} bg-warning-soft text-warning-ink`}>
          {t.rich('swapWarning', { bot: bot.name, serving: serving ? 'yes' : 'other', b: (chunks) => <b>{chunks}</b> })}
        </p>
      )}
      {selected && number.is_test && (
        <p id={testId} className={`${NOTE} bg-tertiary-soft text-tertiary-ink`}>
          {t('testReminder')}
          {account.mode === 'meta_manual' && (
            <>
              {' '}
              <a href={metaAppUrl(account.meta_app_id)} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                {t('testRecipients')}
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}

/** Choix d'un numéro WhatsApp de l'organisation (assistant de création, puis encart de la page de l'agent IA). */
export function NumberPicker({ accounts, selectedId, currentBotId, onSelect }: Props) {
  const t = useTranslations('numberPicker');
  const baseId = useId();
  const groups = selectableGroups(accounts);
  return (
    <div role="radiogroup" aria-label={t('legend')}>
      {groups.map(({ account, numbers }) => {
        const headingId = `${baseId}-account-${account.id}`;
        return (
          <div key={account.id} role="group" aria-labelledby={headingId}>
            <div className="mb-[7px] mt-3.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[1.3px] text-muted-2">
              <span id={headingId}>{account.name}</span>
              {account.state === 'error' && (
                <span className="rounded-pill bg-danger-soft px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-danger-ink">
                  {t('accountError')}
                </span>
              )}
            </div>
            {numbers.map((number) => (
              <Option
                key={number.id}
                account={account}
                number={number}
                name={`${baseId}-number`}
                selected={number.id === selectedId}
                currentBotId={currentBotId}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
