'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountModeView, WhatsAppWebhookView } from '@wabagent/contracts';

const FEEDBACK_MS = 2000;
const BUTTON = 'shrink-0 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink';

type CopyState = 'idle' | 'copied' | 'failed';

/** Bouton « Copier » : copie `text` dans le presse-papiers, confirme ou signale l'échec, sans jamais journaliser le contenu. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useTranslations('connections.webhook');
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let next: CopyState = 'copied';
    try {
      if (!navigator.clipboard) throw new Error('presse-papiers indisponible');
      await navigator.clipboard.writeText(text);
    } catch {
      next = 'failed';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS);
  }

  return (
    <>
      <button type="button" aria-label={label} onClick={() => void copy()} className={BUTTON}>
        {t('copy')}
      </button>
      <span role="status" className="min-w-[72px] text-xs text-muted-2">
        {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : ''}
      </span>
    </>
  );
}

function maskToken(token: string): string {
  return `••••${token.slice(-4)}`;
}

/**
 * Boîte webhook d'un compte : adresse à coller chez le fournisseur et, pour Meta, jeton de vérification
 * (masqué par défaut). L'adresse est celle du compte ; sans adresse publique du moteur, seul le chemin s'affiche.
 */
export function WebhookBox({ webhook, mode }: { webhook: WhatsAppWebhookView; mode: WhatsAppAccountModeView }) {
  const t = useTranslations('connections.webhook');
  const [revealed, setRevealed] = useState(false);
  if (webhook.path === '') return null;
  const token = mode === 'meta_manual' ? webhook.verify_token : null;

  return (
    <div className="border-t border-border bg-surface px-[18px] py-3.5">
      <h3 className="text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t('title')}</h3>
      <p className="mt-1 text-xs text-muted">{mode === 'meta_manual' ? t('hintMeta') : t('hintCm')}</p>

      <div className="mt-2.5">
        <div className="text-xs font-semibold text-fg">{t('urlLabel')}</div>
        <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-surface-subtle py-1.5 pl-2.5 pr-1.5">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-muted">{webhook.url ?? webhook.path}</code>
          {webhook.url !== null && <CopyButton text={webhook.url} label={t('copyUrl')} />}
        </div>
        {webhook.url === null && <p className="mt-1 text-xs text-warning-ink">{t('noPublicUrl')}</p>}
      </div>

      {token !== null && (
        <div className="mt-2.5">
          <div className="text-xs font-semibold text-fg">{t('verifyLabel')}</div>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-surface-subtle py-1.5 pl-2.5 pr-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-muted">{revealed ? token : maskToken(token)}</code>
            <button type="button" onClick={() => setRevealed((v) => !v)} className={BUTTON}>
              {revealed ? t('hide') : t('show')}
            </button>
            <CopyButton text={token} label={t('copyToken')} />
          </div>
        </div>
      )}
    </div>
  );
}
