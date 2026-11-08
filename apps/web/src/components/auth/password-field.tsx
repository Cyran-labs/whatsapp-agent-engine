'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Champ de saisie des pages hors app : bordure fine, anneau de focus vert (maquette 10). */
export const AUTH_INPUT_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-[13px] py-2.5 text-[13.5px] text-fg focus-within:border-[1.5px] focus-within:border-accent-ink focus-within:shadow-[0_0_0_3px_rgba(110,231,183,0.28)]';

export const AUTH_LABEL_CLASS = 'mb-1.5 flex justify-between text-[13px] font-semibold';

/**
 * Segments allumés de la jauge : 0 sous 10 caractères, sinon 1 plus un segment par critère rempli
 * (majuscule et minuscule, chiffre, symbole).
 */
export function passwordStrength(password: string): number {
  if (password.length < 10) return 0;
  const criteria = [/[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)];
  return 1 + criteria.filter(Boolean).length;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  /** Jauge à 4 segments et mention « 10 caractères minimum. » (création de mot de passe). */
  withMeter?: boolean;
  /** Élément à droite du libellé (« Mot de passe oublié ? »). */
  labelAction?: React.ReactNode;
}

export function PasswordField({ label, value, onChange, autoComplete, withMeter = false, labelAction }: Props) {
  const t = useTranslations('auth.invite');
  const id = useId();
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);

  return (
    <div>
      <div className={AUTH_LABEL_CLASS}>
        <label htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className={AUTH_INPUT_CLASS}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none"
        />
        <button type="button" onClick={() => setVisible((v) => !v)} className="text-xs text-muted-2 hover:text-fg">
          {visible ? t('hide') : t('show')}
        </button>
      </div>
      {withMeter && (
        <>
          <div className="mt-2 flex gap-1" aria-hidden="true" data-testid="strength-meter">
            {[1, 2, 3, 4].map((segment) => (
              <span key={segment} className={`h-1 flex-1 rounded-[2px] ${segment <= strength ? 'bg-success' : 'bg-border'}`} />
            ))}
          </div>
          <div className="mt-1.5 text-[11.5px] text-muted-2">{t('passwordHint')}</div>
        </>
      )}
    </div>
  );
}
