'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, Bot, Building2, CircleHelp, Headset, MessagesSquare, UserRound, type LucideIcon } from 'lucide-react';
import { useSession } from '@/components/providers/session-provider';
import { initialsFromEmail } from '@/lib/organizations';
import { cn } from '@/lib/utils';
import { ComingSoon, HintBubble, useHint } from './coming-soon';
import { GuardedLink } from './navigation-guard';

/** Espaces du back-office : une entrée du rail chacun (spec 4). */
export type Space = 'organisation' | 'agents' | 'usage' | 'account';

const ENTRY = 'mx-2 my-0.5 flex flex-col items-center gap-[5px] rounded-lg px-0 pb-[7px] pt-[9px] text-center text-[10.5px] leading-tight';
const ICON = 'h-[18px] w-[18px]';

function entryClass(active: boolean): string {
  return cn(ENTRY, active ? 'bg-brand text-brand-on' : 'text-brand-on-2 hover:bg-brand-hover hover:text-brand-on');
}

/**
 * Entrée du rail qui mène à un espace, avec sa bulle à droite (C-17, recette 3.11) : le nom en gras, puis une phrase.
 * La bulle est reliée par `aria-describedby` : le nom accessible de l'entrée ne change pas. Visible au survol et au focus,
 * entrée active comprise.
 */
function RailLink({
  title,
  hint: hintText,
  children,
  ...rest
}: Omit<ComponentProps<typeof GuardedLink>, 'children'> & { title: string; hint: string; children: ReactNode }) {
  const hint = useHint<HTMLAnchorElement>();
  return (
    <>
      <GuardedLink {...rest} {...hint.triggerProps}>
        {children}
      </GuardedLink>
      <HintBubble id={hint.id} open={hint.open} title={title} text={hintText} anchor={hint.anchorRef} placement="right" />
    </>
  );
}

/** Compte affiché en bas du rail : adresse (initiales, nom accessible) et marque de l'opérateur de la plateforme. */
export interface RailAccount {
  email: string;
  platform: boolean;
}

/** Rail de la session ouverte (spec 5.1), rendu par `AppRailView` à partir de la session. */
export function AppRail({ active }: { active: Space | null }) {
  const { me, activeOrg, isAdmin, isPlatformAdmin } = useSession();
  return (
    <AppRailView
      active={active}
      withOrg={activeOrg !== null}
      isAdmin={isAdmin}
      account={{ email: me.email, platform: isPlatformAdmin }}
    />
  );
}

/**
 * Rail sombre à gauche (spec 5.1) : marque, espaces, entrées à venir grisées, Aide et Compte en bas. Chaque entrée sauf
 * la marque a sa bulle, le nom en gras puis une phrase (C-17). L'entrée active est marquée par son fond et son icône en
 * menthe clair (recette 3.11) ; aucune pastille. Sans organisation active : marque, Aide et Compte.
 * Sans session lue (`account` nul, cadre neutre d'une session illisible, C-8) : l'entrée Compte n'a qu'une icône et son
 * libellé, sans initiales ni adresse.
 */
export function AppRailView({
  active,
  withOrg,
  isAdmin,
  account,
}: {
  active: Space | null;
  withOrg: boolean;
  isAdmin: boolean;
  account: RailAccount | null;
}) {
  const t = useTranslations('shell.rail');
  const tc = useTranslations('common');

  const link = (space: Exclude<Space, 'account'>, href: string, Icon: LucideIcon) => {
    const isActive = active === space;
    return (
      <RailLink
        key={space}
        href={href}
        title={t(space)}
        hint={t(`${space}Hint`)}
        data-rail-entry={space}
        aria-current={isActive ? 'page' : undefined}
        className={entryClass(isActive)}
      >
        <Icon data-rail-icon="" className={cn(ICON, isActive && 'text-brand-mint')} aria-hidden="true" />
        <span className="max-w-full break-words hyphens-auto px-0.5">{t(space)}</span>
      </RailLink>
    );
  };

  const soon = (key: 'leads' | 'handover' | 'help', Icon: LucideIcon) => (
    <ComingSoon
      key={key}
      tooltip={t(`${key}Soon`)}
      tooltipTitle={t(key)}
      placement="right"
      className={cn(ENTRY, 'text-brand-on-2')}
    >
      {/* Grisé sur le contenu seul : la bulle, voisine, garde son contraste plein. */}
      <span data-rail-entry={key} className="flex flex-col items-center gap-[5px] opacity-55">
        <Icon className={ICON} aria-hidden="true" />
        <span>{t(key)}</span>
      </span>
    </ComingSoon>
  );

  const accountActive = active === 'account';

  return (
    <nav
      aria-label={t('label')}
      className="flex w-[84px] flex-shrink-0 flex-col bg-brand-deep pb-3 text-brand-on"
    >
      <GuardedLink
        href="/"
        data-rail-entry="brand"
        className="flex h-[84px] flex-col items-center justify-center gap-2 text-[10.5px] font-semibold tracking-[0.4px]"
      >
        <span className="h-[11px] w-[11px] rounded-full bg-brand-mint" aria-hidden="true" />
        {tc('appName')}
      </GuardedLink>

      {withOrg && (
        <>
          {isAdmin && link('organisation', '/organisation', Building2)}
          {link('agents', '/', Bot)}
          {isAdmin && link('usage', '/usage', BarChart3)}
          {soon('leads', MessagesSquare)}
          {soon('handover', Headset)}
        </>
      )}

      <div className="flex-1" />

      <div className="border-t border-brand pt-2.5">
        {soon('help', CircleHelp)}
        <RailLink
          href="/account/organisations"
          title={t('account')}
          hint={t('accountHint')}
          data-rail-entry="account"
          aria-label={account ? t('accountLabel', { email: account.email }) : undefined}
          aria-current={accountActive ? 'page' : undefined}
          className={entryClass(accountActive)}
        >
          <span
            data-rail-icon=""
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-pill bg-brand text-[11px] font-semibold text-brand-on',
              accountActive && 'bg-brand-deep text-brand-mint',
            )}
          >
            {account ? initialsFromEmail(account.email) : <UserRound className="h-4 w-4" aria-hidden="true" />}
            {account?.platform && (
              <span
                data-testid="platform-badge-dot"
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-brand-deep bg-brand-on text-[8px] font-extrabold text-brand-deep"
              >
                ★
              </span>
            )}
          </span>
          <span>{t('account')}</span>
        </RailLink>
      </div>
    </nav>
  );
}
