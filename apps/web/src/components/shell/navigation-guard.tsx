'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
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
  const pathname = usePathname();
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);
  // Demande de sortie en attente de la fenêtre : une seule à la fois, jamais laissée sans réponse.
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);
  const [asking, setAsking] = useState(false);

  /** Répond à la demande en attente (s'il y en a une) et ferme la fenêtre. */
  const settle = useCallback((ok: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setAsking(false);
    resolve?.(ok);
  }, []);

  const setGuard = useCallback(
    (next: boolean) => {
      activeRef.current = next;
      setActive(next);
      // Garde levée pendant que la fenêtre est ouverte : plus rien à confirmer, la sortie demandée n'a pas lieu
      // (relecture tâche 13, M-2).
      if (!next) settle(false);
    },
    [settle],
  );

  const confirmLeave = useCallback(() => {
    if (!activeRef.current) return Promise.resolve(true);
    // Une seconde demande remplace la première, qui reçoit « non » au lieu de rester en suspens.
    pendingRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setAsking(true);
    });
  }, []);

  // Page changée sans passer par la garde (Retour du navigateur) : la fenêtre ne survit pas à la page qui l'a ouverte.
  useEffect(() => {
    settle(false);
  }, [pathname, settle]);

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


  const value = useMemo<GuardContext>(
    () => ({ setGuard, confirmLeave, isActive: () => activeRef.current, navigate: (href) => router.push(href) }),
    [setGuard, confirmLeave, router],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {asking && <LeaveDialog onStay={() => settle(false)} onLeave={() => settle(true)} />}
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
