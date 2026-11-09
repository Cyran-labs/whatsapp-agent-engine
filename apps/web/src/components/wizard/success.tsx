'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/agents/status-pill';
import { LANGUAGE_LABELS, type WizardState } from '@/lib/bot-draft';
import { formatPhone, waMeUrl } from '@/lib/whatsapp-display';
import type { Activated } from './step-activate';

interface Props {
  state: WizardState;
  /** Agent IA créé par l'assistant : la page vers laquelle les liens de fin mènent. */
  botId: string;
  /** `null` : l'agent IA est resté en brouillon ; sinon il est en ligne sur ce numéro. */
  activated: Activated | null;
  onHome: () => void;
  onEdit: () => void;
}

const SECONDARY = 'rounded-xl border border-border bg-surface px-5 py-3 font-semibold text-fg';
const PRIMARY = 'rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg hover:bg-accent-hover';

export function Success({ state, botId, activated, onHome, onEdit }: Props) {
  return activated ? (
    <Live state={state} botId={botId} activated={activated} onHome={onHome} />
  ) : (
    <Draft state={state} botId={botId} onHome={onHome} onEdit={onEdit} />
  );
}

function Draft({ state, botId, onHome, onEdit }: Omit<Props, 'activated'>) {
  const t = useTranslations('success');
  return (
    <div className="mx-auto max-w-lg px-5 py-12 text-center">
      <div className="mx-auto mb-5 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-success-soft text-4xl text-success">✓</div>
      <h1 className="font-serif text-3xl text-fg">{t('title')}</h1>
      <p className="mx-auto mt-2 mb-7 max-w-md text-muted">{t('subtitle', { name: state.name })}</p>

      <div className="rounded-xl border border-border bg-surface p-5 text-left">
        <div className="flex justify-between py-2"><span className="text-muted">{t('agent')}</span><span className="font-semibold text-fg">{state.name}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('languages')}</span><span className="font-semibold text-fg">{state.languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(' · ')}</span></div>
        <div className="flex justify-between border-t border-border py-2"><span className="text-muted">{t('status')}</span><StatusPill status="draft" /></div>
      </div>

      <Link href={`/agents/${botId}`} className="mt-6 flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4 text-left hover:bg-bg">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg text-lg">🔗</span>
        <span className="flex-1"><span className="block font-semibold text-fg">{t('connectTitle')}</span><span className="block text-xs text-muted">{t('connectDesc')}</span></span>
        <span aria-hidden="true" className="font-semibold text-accent-ink">→</span>
      </Link>

      <div className="mt-7 flex justify-center gap-3">
        <button onClick={onHome} className={SECONDARY}>{t('backToAgents')}</button>
        <button onClick={onEdit} className={PRIMARY}>{t('editPersonality')}</button>
      </div>
    </div>
  );
}

function Live({ state, botId, activated, onHome }: Pick<Props, 'state' | 'botId' | 'onHome'> & { activated: Activated }) {
  const t = useTranslations('success');
  const phone = activated.phone;
  const link = phone === null ? null : waMeUrl(phone);
  // `null` : génération en cours (espace réservé), `false` : impossible (le lien wa.me suffit).
  const [qr, setQr] = useState<string | null | false>(null);

  useEffect(() => {
    if (link === null) return undefined;
    let alive = true;
    // Généré dans le navigateur : le numéro ne part vers aucun service externe.
    QRCode.toDataURL(link, { margin: 1, width: 224 })
      .then((src) => { if (alive) setQr(src); })
      .catch((err: unknown) => {
        // Le lien wa.me reste affiché : le QR code n'est qu'un confort.
        console.error('[Wizard] QR code impossible à générer', err);
        if (alive) setQr(false);
      });
    return () => { alive = false; };
  }, [link]);

  return (
    <div className="mx-auto max-w-lg px-5 py-12 text-center">
      <div aria-hidden="true" className="mx-auto mb-3.5 flex h-[74px] w-[74px] items-center justify-center rounded-full bg-success-soft text-4xl text-success">✓</div>
      <h1 className="font-serif text-2xl text-fg">{t('liveTitle', { name: state.name })}</h1>
      <p className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-muted">
        {phone === null
          ? <><StatusPill status={activated.status} /><span>{t('liveNoNumber')}</span></>
          : t.rich('liveOn', {
              status: () => <StatusPill status={activated.status} />,
              phone: formatPhone(phone),
              number: (chunks) => <span className="font-mono text-[13px] text-fg">{chunks}</span>,
            })}
      </p>
      {activated.status === 'limited' && <p className="mx-auto mt-3 max-w-md text-[13px] text-muted">{t('limitedNote')}</p>}

      {link !== null && (
        <div className="mt-5 flex items-center gap-4 rounded-xl border border-border bg-surface p-4 text-left">
          {qr === null && <Skeleton className="h-[112px] w-[112px] shrink-0" />}
          {qr && (
            <img src={qr} alt={t('qrAlt', { name: state.name })} width={112} height={112} className="h-[112px] w-[112px] shrink-0 rounded-md border border-border" />
          )}
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-fg">{t('qrTitle')}</div>
            <p className="mb-1.5 mt-0.5 text-[12.5px] text-muted">{t('qrText')}</p>
            <a href={link} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs font-semibold text-accent-ink hover:underline">
              {link.replace(/^https:\/\//, '')}
            </a>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-center gap-3">
        <button onClick={onHome} className={SECONDARY}>{t('backToAgents')}</button>
        <Link href={`/agents/${botId}`} className={PRIMARY}>{t('openAgent')}</Link>
      </div>
    </div>
  );
}
