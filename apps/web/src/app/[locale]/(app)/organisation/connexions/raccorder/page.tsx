'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import { ConnectForm } from '@/components/connections/connect-form';
import { ConnectResult } from '@/components/connections/connect-result';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';

/** Raccordement guidé d'un compte WhatsApp (admin seulement : garde de `organisation/layout.tsx`). */
export default function RaccorderPage() {
  const t = useTranslations('connections.connectFlow');
  const { refreshCounts } = useOrganisationCounts();
  const [created, setCreated] = useState<WhatsAppAccountCreated | null>(null);

  return (
    <div className="max-w-[760px]">
      <h1 className="mb-1 font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
      <div className="mt-4">
        {created ? (
          <ConnectResult account={created} />
        ) : (
          <ConnectForm
            onCreated={(account) => {
              setCreated(account);
              // Le compteur Connexions du rail compte le nouveau compte.
              refreshCounts();
            }}
          />
        )}
      </div>
    </div>
  );
}
