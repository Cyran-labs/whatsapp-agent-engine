'use client';

import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Store, UserRound } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HintBubble, useHint } from './coming-soon';
import { GuardedLink } from './navigation-guard';

/** Élément de la ligne des parents ; `label` nul : nom encore en lecture, un squelette tient sa place, sans lien. */
export interface ParentCrumb {
  label: string | null;
  href: string;
}

/** Objet que crée le bouton rond : son icône (C-2). */
export type CreateIcon = 'agent' | 'entity' | 'user' | 'whatsapp';

/**
 * Action de création d'une page (spec 2.1) : un lien, ou l'ouverture de la fenêtre que l'ancien bouton ouvrait
 * (Entités, Utilisateurs). `label` est à la fois le nom accessible et le texte de la bulle. `disabled` reprend les
 * conditions des boutons actuels (liste pas encore lue, lecture en échec) : bouton désactivé, sans lien.
 */
export type CreateAction = { label: string; icon: CreateIcon; disabled?: boolean } & ({ href: string } | { onClick: () => void });

/** Glyphe WhatsApp monochrome (couleur du texte), pour le bouton rond de Connexions. */
export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-create-icon="whatsapp" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

const ICON = 'h-5 w-5';

function CreateGlyph({ icon }: { icon: CreateIcon }) {
  switch (icon) {
    case 'agent':
      return <Bot className={ICON} aria-hidden="true" data-create-icon="agent" />;
    case 'entity':
      return <Store className={ICON} aria-hidden="true" data-create-icon="entity" />;
    case 'user':
      return <UserRound className={ICON} aria-hidden="true" data-create-icon="user" />;
    case 'whatsapp':
      return <WhatsAppGlyph className={ICON} />;
  }
}

const ROUND =
  'relative flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-md transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent';

/**
 * Bouton rond de création (C-2) : icône de l'objet et petit « + » en bas à droite, bulle sous le bouton au survol et
 * au focus. Une place de sa taille est gardée dans la zone des actions (le titre ne passe jamais dessous) ; le bouton
 * lui-même est dans une colonne en position absolue qui part de cette place et descend jusqu'au bas du contenu de la
 * page, et y est collant : il reste visible au défilement, aligné sur la ligne du titre au repos. Dans le DOM, il vient
 * après les actions du titre (P4).
 */
function CreateButton({ action }: { action: CreateAction }) {
  const hint = useHint<HTMLSpanElement>();
  const slotRef = useRef<HTMLSpanElement>(null);
  const columnRef = useRef<HTMLSpanElement>(null);

  // La colonne part de la hauteur de la place gardée, mesurée dans le bloc positionné qui la contient (contenu de la
  // page) : un bandeau au-dessus de l'en-tête peut la déplacer, d'où la nouvelle mesure à chaque changement de taille de
  // ce bloc. En largeur, la colonne garde sa position naturelle, celle de la place.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const column = columnRef.current;
    if (!slot || !column) return undefined;
    const place = () => {
      column.style.top = `${slot.offsetTop}px`;
    };
    place();
    const container = slot.offsetParent;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const content = (
    <>
      <CreateGlyph icon={action.icon} />
      <span aria-hidden="true" className="absolute bottom-[7px] right-[7px] text-[12px] font-bold leading-none">
        +
      </span>
    </>
  );

  return (
    <span ref={slotRef} className="block h-11 w-11 shrink-0">
      {/* Avant la mesure (rendu serveur) : `top-7`, place attendue sans ligne des parents (`pt-7` du contenu). */}
      <span ref={columnRef} className="pointer-events-none absolute bottom-0 top-7 z-20 w-11">
        <span className="pointer-events-auto sticky top-3 block">
          {/* Survol et focus lus sur l'enveloppe : un bouton désactivé ne reçoit pas le survol, sa bulle s'affiche quand même. */}
          <span {...hint.triggerProps} aria-describedby={undefined} className="block">
            {'href' in action && !action.disabled ? (
              <Link href={action.href} aria-label={action.label} data-page-create="" className={ROUND}>
                {content}
              </Link>
            ) : (
              <button
                type="button"
                aria-label={action.label}
                data-page-create=""
                disabled={action.disabled}
                onClick={'onClick' in action ? action.onClick : undefined}
                className={ROUND}
              >
                {content}
              </button>
            )}
          </span>
        </span>
      </span>
      <HintBubble id={hint.id} open={hint.open} text={action.label} anchor={hint.anchorRef} placement="below-end" />
    </span>
  );
}

const PARENT = 'min-w-0 max-w-[260px] truncate';

/**
 * En-tête de page (spec en-tête de page, 2.1 ; C-1) : remplace la barre du haut. Ligne des parents facultative (liens
 * séparés par « › », sans le nom de l'organisation ni le titre de la page), titre en seul `h1`, ligne de description,
 * et une zone `data-page-action` alignée sur le bord droit du contenu : les actions du titre (Simuler, Quitter, période),
 * puis le bouton rond de création. À poser en premier dans `PageContent`, qui positionne la colonne du bouton rond.
 */
export function PageHeader({
  parents,
  title,
  titleAside,
  description,
  actions,
  create,
}: {
  parents?: ParentCrumb[];
  title: ReactNode;
  titleAside?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  create?: CreateAction | null;
}) {
  const t = useTranslations('shell.pageHeader');
  const hasParents = parents !== undefined && parents.length > 0;
  const hasActions = Boolean(actions) || Boolean(create);

  return (
    <header data-page-header="" className="mb-6 flex items-start gap-6">
      <div data-page-title-block="" className="min-w-0 flex-1">
        {hasParents && (
          <nav aria-label={t('label')} className="mb-2">
            <ol className="flex h-[18px] min-w-0 items-center gap-2 text-[13px] leading-[18px] text-muted">
              {parents.map((crumb, index) => (
                <Fragment key={`${index}-${crumb.href}`}>
                  {index > 0 && (
                    <li aria-hidden="true" className="shrink-0">
                      ›
                    </li>
                  )}
                  <li className="flex min-w-0">
                    {crumb.label === null ? (
                      <Skeleton className="h-3.5 w-24" />
                    ) : (
                      <GuardedLink href={crumb.href} title={crumb.label} className={`${PARENT} hover:text-fg hover:underline`}>
                        {crumb.label}
                      </GuardedLink>
                    )}
                  </li>
                </Fragment>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex min-h-11 min-w-0 items-center gap-3">
          <h1
            title={typeof title === 'string' ? title : undefined}
            className="min-w-0 truncate font-serif text-[26px] font-normal leading-[1.2] text-fg"
          >
            {title}
          </h1>
          {titleAside && <div className="flex shrink-0 items-center gap-2">{titleAside}</div>}
        </div>
        {description && <div className="mt-1 text-[12.5px] text-muted">{description}</div>}
      </div>
      {hasActions && (
        // Alignée sur la ligne du titre : décalée de la hauteur de la ligne des parents quand il y en a une.
        <div data-page-action="" className={cn('flex min-h-11 shrink-0 items-center gap-2', hasParents && 'mt-[26px]')}>
          {actions}
          {create && <CreateButton action={create} />}
        </div>
      )}
    </header>
  );
}

/**
 * Conteneur du contenu d'une page (C-3) : pleine largeur, sans largeur maximale (un formulaire ou un encart garde sa
 * propre largeur de lecture), et bloc positionné qui porte la colonne du bouton rond de l'en-tête jusqu'en bas de la page.
 */
export function PageContent({ children }: { children: ReactNode }) {
  return <div className="relative flex-1 px-8 pb-10 pt-7">{children}</div>;
}
