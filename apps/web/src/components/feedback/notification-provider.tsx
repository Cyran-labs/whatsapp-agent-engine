'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';

/** Durée d'affichage d'une notification de réussite (audit §5.2). */
export const SUCCESS_DURATION_MS = 5000;

export interface Notify {
  /** Réussite dont l'effet n'est pas sous les yeux, texte qui nomme l'objet (« Entité Nord archivée. ») : région polie, 5 s. */
  success(text: string): void;
  /** Erreur d'une action sans emplacement naturel (sélecteur d'organisation) : région assertive, jusqu'à fermeture. */
  error(text: string): void;
}

type Kind = 'success' | 'error';

interface Notification {
  id: number;
  kind: Kind;
  text: string;
}

const NotifyContext = createContext<Notify | null>(null);

/**
 * Notifications de l'application (audit §5.2). Un refus qui a un emplacement (champ, fenêtre, panneau, ligne) n'est
 * jamais notifié : il s'affiche là, avec `InlineError` ou `FieldError`.
 */
export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify doit être utilisé dans un NotificationProvider.');
  return notify;
}

function NotificationItem({ notification, onClose }: { notification: Notification; onClose: (id: number) => void }) {
  const t = useTranslations('notify');
  const { id, kind, text } = notification;
  useEffect(() => {
    if (kind !== 'success') return;
    const timer = setTimeout(() => onClose(id), SUCCESS_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, kind, onClose]);
  const tone = kind === 'success' ? 'border-success bg-success-soft text-success-ink' : 'border-danger bg-danger-soft text-danger-ink';
  return (
    // Aucun rôle sur l'élément : la région de sa politesse l'annonce (pas de région vivante imbriquée).
    <div className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-md ${tone}`}>
      <p className="min-w-0 flex-1">{text}</p>
      <button type="button" onClick={() => onClose(id)} aria-label={t('close')} className="shrink-0 text-base leading-none">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/**
 * Monté dans la mise en page de l'application, au-dessus des pages : une réussite reste lisible sur la page d'arrivée
 * après une navigation côté client. Une seule région `aria-live` par politesse pour toute l'application (`assertive`
 * pour les erreurs, `polite` pour les réussites), présentes avant toute notification (une région ajoutée avec son
 * contenu n'est pas toujours lue) ; les notifications n'ont pas de rôle propre (pas de région vivante imbriquée). Tout est effacé quand l'organisation affichée change : une notification
 * parlait de la précédente.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('notify');
  const { activeOrg } = useSession();
  const orgId = activeOrg?.client_id ?? null;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(1);
  // Organisation affichée changée : liste vidée pendant le rendu (état ajusté d'après le rendu précédent), pour
  // qu'aucune image ne montre une notification de l'organisation précédente avec la nouvelle.
  const [shownOrg, setShownOrg] = useState(orgId);
  if (shownOrg !== orgId) {
    setShownOrg(orgId);
    setNotifications([]);
  }

  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId.current++;
    setNotifications((list) => [...list, { id, kind, text }]);
  }, []);
  const close = useCallback((id: number) => {
    setNotifications((list) => list.filter((n) => n.id !== id));
  }, []);

  const notify = useMemo<Notify>(
    () => ({ success: (text) => push('success', text), error: (text) => push('error', text) }),
    [push],
  );

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <section
        aria-label={t('region')}
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {/* Une région vivante par politesse, montées une fois : erreurs annoncées sans attendre, réussites à la suite. */}
        <div aria-live="assertive" className="flex flex-col gap-2">
          {notifications.filter((n) => n.kind === 'error').map((n) => (
            <NotificationItem key={n.id} notification={n} onClose={close} />
          ))}
        </div>
        <div aria-live="polite" className="flex flex-col gap-2">
          {notifications.filter((n) => n.kind === 'success').map((n) => (
            <NotificationItem key={n.id} notification={n} onClose={close} />
          ))}
        </div>
      </section>
    </NotifyContext.Provider>
  );
}
