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

/**
 * Numéros que l'on peut retenir : ceux des comptes connectés. Un numéro d'un compte en erreur ne pourrait ni être
 * activé (`decideActivation`) ni servir ; il est montré non choisissable, la raison sous l'en-tête de son compte
 * (spec 12.3, même règle dans l'assistant et sur la page de l'agent IA).
 */
export function choosableNumbers(accounts: WhatsAppAccountView[]): WhatsAppNumberView[] {
  return selectableGroups(accounts)
    .filter((group) => group.account.state === 'connected')
    .flatMap((group) => group.numbers);
}

interface Props {
  accounts: WhatsAppAccountView[];
  selectedId: number | null;
  /** Agent IA pour lequel on choisit : son propre numéro n'est ni « utilisé par un autre » ni un avertissement. */
  currentBotId: string | null;
  onSelect: (numberId: number) => void;
  /**
   * Moment où l'ancien détenteur d'un numéro choisi le perd : `activation` dans l'assistant (le branchement suit
   * l'activation), `immediate` depuis la page de l'agent IA (le branchement est tout de suite). Dans les deux cas
   * (spec 12.3), l'avertissement est sur la ligne avant le choix.
   */
  timing?: 'activation' | 'immediate';
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
  timing: 'activation' | 'immediate';
  /** Compte non connecté : numéro non choisissable, décrit par la raison affichée sous l'en-tête du compte. */
  offReasonId: string | null;
}

function Option({ account, number, name, selected, currentBotId, onSelect, timing, offReasonId }: OptionProps) {
  const t = useTranslations('numberPicker');
  const baseId = useId();
  const bot = number.bot;
  const isCurrent = bot !== null && bot.bot_id === currentBotId;
  const usedByOther = bot !== null && !isCurrent;
  const swapId = `${baseId}-swap`;
  const testId = `${baseId}-test`;
  const off = offReasonId !== null;
  // Un numéro non choisissable n'annonce pas de débranchement : il n'aura pas lieu.
  const showSwap = usedByOther && !off;
  const describedBy = [offReasonId, showSwap ? swapId : null, selected && number.is_test ? testId : null].filter(Boolean).join(' ');
  const serving = bot !== null && isServingStatus(bot.status);

  return (
    <>
      <label
        className={`mb-[7px] flex items-center gap-3 rounded-lg border px-3.5 py-[11px] focus-within:ring-2 focus-within:ring-accent-ink ${
          off
            ? 'cursor-not-allowed border-border bg-surface-subtle text-muted-2'
            : `cursor-pointer ${selected ? 'border-accent-ink bg-accent-soft' : `border-border-strong ${usedByOther ? 'bg-surface-subtle' : 'bg-surface'}`}`
        }`}
      >
        <input
          type="radio"
          name={name}
          checked={selected && !off}
          disabled={off}
          onChange={() => onSelect(number.id)}
          aria-describedby={describedBy || undefined}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 rounded-full ${selected ? 'border-[5px] border-accent-ink' : 'border-[1.5px] border-border-strong'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block whitespace-nowrap font-mono text-[13px]">{formatPhone(number.phone_e164)}</span>
          <span className="block text-xs text-muted-2">
            {number.display_name}
            {bot === null && ` · ${t('free')}`}
          </span>
          {/* Pastilles sous le numéro, à la ligne si besoin : elles ne rétrécissent jamais la colonne du numéro. */}
          {(number.is_test || isCurrent || usedByOther) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {number.is_test && <span className={`${TAG} bg-tertiary-soft text-tertiary-ink`}>{t('testBadge')}</span>}
              {isCurrent && <span className={`${TAG} bg-accent-soft text-accent-ink`}>{t('current')}</span>}
              {usedByOther && <span className={`${TAG} bg-warning-soft text-warning-ink`}>{t('usedBy', { bot: bot.name })}</span>}
            </span>
          )}
        </span>
      </label>
      {showSwap && (
        <p id={swapId} className={`${NOTE} bg-warning-soft text-warning-ink`}>
          {t.rich(timing === 'immediate' ? 'swapWarningNow' : 'swapWarning', { bot: bot.name, serving: serving ? 'yes' : 'other', b: (chunks) => <b>{chunks}</b> })}
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
export function NumberPicker({ accounts, selectedId, currentBotId, onSelect, timing = 'activation' }: Props) {
  const t = useTranslations('numberPicker');
  const baseId = useId();
  const groups = selectableGroups(accounts);
  return (
    <div role="radiogroup" aria-label={t('legend')}>
      {groups.map(({ account, numbers }) => {
        const headingId = `${baseId}-account-${account.id}`;
        const offReasonId = account.state === 'connected' ? null : `${baseId}-account-${account.id}-off`;
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
            {offReasonId !== null && (
              <p id={offReasonId} className="mb-2 rounded-lg bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger-ink">
                {t('accountNotConnected')}
              </p>
            )}
            {numbers.map((number) => (
              <Option
                key={number.id}
                account={account}
                number={number}
                name={`${baseId}-number`}
                selected={number.id === selectedId}
                currentBotId={currentBotId}
                onSelect={onSelect}
                timing={timing}
                offReasonId={offReasonId}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
