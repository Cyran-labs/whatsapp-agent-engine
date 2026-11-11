'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import { ConnectForm } from '@/components/connections/connect-form';
import { ConnectResult } from '@/components/connections/connect-result';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';
import { PageContent, PageHeader } from '@/components/shell/page-header';

/** Raccordement guidé d'un compte WhatsApp (admin seulement : garde de `organisation/layout.tsx`). */
export default function RaccorderPage() {
  const t = useTranslations('connections.connectFlow');
  const tc = useTranslations('connections');
  const { refreshCounts } = useOrganisationCounts();
  const [created, setCreated] = useState<WhatsAppAccountCreated | null>(null);

  // En-tête (spec en-tête 2.2) : parents « Connexions », titre de la page, aucune action : « Annuler » et « Vérifier et
  // raccorder » restent au bas du formulaire.
  return (
    <PageContent>
      <PageHeader parents={[{ label: tc('title'), href: '/organisation/connexions' }]} title={t('title')} />
      <div className="max-w-[760px]">
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
    </PageContent>
  );
}
