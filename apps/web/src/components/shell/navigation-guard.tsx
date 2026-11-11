'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { LeaveDialog } from '@/components/wizard/leave-dialog';

export interface NavigationGuard {
  /** Pose ou lève la garde ; prend effet tout de suite (un rechargement lancé dans le même tour n'est pas retenu). */
  setGuard(active: boolean): void;
  /** `true` sans fenêtre quand aucune garde n'est posée ; sinon la réponse de la fenêtre de sortie. */
  confirmLeave(): Promise<boolean>;
}

interface GuardContext extends NavigationGuard {
  isActive(): boolean;
  navigate(href: string): void;
}

// amendement A-8 : sans fournisseur (tests, pages hors du gabarit), rien n'est gardé.
const DEFAULT: GuardContext = {
  setGuard: () => undefined,
  confirmLeave: () => Promise.resolve(true),
  isActive: () => false,
  navigate: () => undefined,
};

const Context = createContext<GuardContext>(DEFAULT);

/**
 * Garde de sortie (spec 12.4, choix P-8) : une page qui tient une saisie non enregistrée pose la garde ; le rail, les
 * liens de la colonne et du fil, le sélecteur d'organisation et « Quitter » demandent alors confirmation. La fermeture ou
 * le rechargement de l'onglet sont retenus par `beforeunload` tant que la garde est posée.
 */
export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null);

  const setGuard = useCallback((next: boolean) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const confirmLeave = useCallback(
    () => (activeRef.current ? new Promise<boolean>((resolve) => setPending(() => resolve)) : Promise.resolve(true)),
    [],
  );

  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Lu à l'événement : une garde levée juste avant un rechargement voulu (session) ne le retient pas.
      if (!activeRef.current) return;
      e.preventDefault();
      // Navigateurs plus anciens : la fenêtre native n'apparaît qu'avec une valeur de retour.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);

  const answer = (ok: boolean) => {
    pending?.(ok);
    setPending(null);
  };

  const value = useMemo<GuardContext>(
    () => ({ setGuard, confirmLeave, isActive: () => activeRef.current, navigate: (href) => router.push(href) }),
    [setGuard, confirmLeave, router],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {pending && <LeaveDialog onStay={() => answer(false)} onLeave={() => answer(true)} />}
    </Context.Provider>
  );
}

export function useNavigationGuard(): NavigationGuard {
  const { setGuard, confirmLeave } = useContext(Context);
  return useMemo(() => ({ setGuard, confirmLeave }), [setGuard, confirmLeave]);
}

/**
 * Lien de navigation de l'application qui passe par la garde : sans garde, c'est un lien ordinaire ; garde posée, le
 * clic ouvre la fenêtre de sortie et ne navigue qu'après « Quitter sans enregistrer ». Un clic avec modificateur (nouvel
 * onglet) n'est jamais retenu : la page courante reste ouverte.
 */
export function GuardedLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const guard = useContext(Context);
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !guard.isActive()) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void guard.confirmLeave().then((ok) => {
          if (ok) guard.navigate(href);
        });
      }}
      {...rest}
    />
  );
}
