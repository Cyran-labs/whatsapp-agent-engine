import { useTranslations } from 'next-intl';
import { GuidePaths, type GuidePath } from './guide-paths';

/** Conseils du bloc « Recommandé », dans l'ordre de la spec R1 §6.1. */
const RECOMMENDED = ['publish', 'payment', 'verification', 'appSecretProof'] as const;

interface Props {
  /** Étape 1, le portefeuille Meta Business (`BusinessStep`), tenue par le formulaire. */
  businessStep: React.ReactNode;
  locked: boolean;
  path: GuidePath | null;
  onPathChange: (path: GuidePath) => void;
  choiceId: string;
  pathError: string | null;
  businessId: string | null;
  wabaId: string | null;
  fields: React.ComponentProps<typeof GuidePaths>['fields'];
}

/**
 * Guide du mode « API Meta directe » en deux temps (spec R2a §5.1, §7 ; maquettes 01, 02 et 03) : l'étape du
 * portefeuille, puis le choix du chemin et ses étapes, grisées tant que le portefeuille n'est pas reconnu, et en bas le
 * bloc « Recommandé » de R1, commun aux deux chemins. Aucune étape webhook : WABAGENT inscrit lui-même ses webhooks chez
 * Meta (spec R1 §6.1). Les libellés des pages Meta sont dans les messages : ils sont relevés en recette dans les vraies pages.
 */
export function ConnectGuideMeta({ businessStep, locked, path, onPathChange, choiceId, pathError, businessId, wabaId, fields }: Props) {
  const t = useTranslations('connections.connectFlow.guideMeta');
  return (
    <>
      {businessStep}
      <GuidePaths
        locked={locked}
        path={path}
        onPathChange={onPathChange}
        choiceId={choiceId}
        pathError={pathError}
        businessId={businessId}
        wabaId={wabaId}
        fields={fields}
      />
      <section className="mt-3 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-[13px] text-fg">
        <h3 className="font-semibold">{t('recommended.title')}</h3>
        <p className="mt-0.5 text-xs text-muted">{t('recommended.hint')}</p>
        <ul aria-label={t('recommended.title')} className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
          {RECOMMENDED.map((key) => <li key={key}>{t(`recommended.${key}`)}</li>)}
        </ul>
      </section>
    </>
  );
}
