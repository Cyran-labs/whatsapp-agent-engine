'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/feedback/inline-error';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { AllowlistEditor } from '@/components/numbers/allowlist-editor';
import { formatPhone } from '@/lib/whatsapp-display';
import { readJsonBody, sendMutation } from '@/lib/api-fetch';
import type { DescribedFailure } from '@/lib/describe-failure';
import { ACTION, Card } from './panel-ui';

interface Props {
  botId: string;
  /** Liste enregistrée dans le moteur (déjà normalisée par lui). */
  entries: string[];
  /** Admin hors lecture seule : le champ et « Enregistrer » ne s'affichent que pour lui. */
  canEdit: boolean;
  onChanged: () => void;
}

/** Le moteur désigne une entrée refusée par `entries.<i>`. */
const ROW_ERROR_PATH = /^entries\.(\d+)$/;

/** Messages par ligne d'un refus lu avec les champs `entries.<i>` de la liste envoyée. */
function rowErrors(failure: DescribedFailure): Record<number, string> {
  const perRow: Record<number, string> = {};
  for (const [path, message] of Object.entries(failure.fieldErrors)) {
    const match = ROW_ERROR_PATH.exec(path);
    if (match) perRow[Number(match[1])] = message;
  }
  return perRow;
}

/** Champs d'un refus de la liste : une entrée refusée est désignée par `entries.<i>`. */
const rowFields = (entries: readonly string[]): string[] => entries.map((_, index) => `entries.${index}`);

/** Identifiant du champ d'ajout d'un agent IA : l'encart Statut y ramène le curseur (« Ajouter un numéro »). */
export const allowlistInputId = (botId: string): string => `allowlist-input-${botId}`;

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((entry, i) => entry === b[i]);

/**
 * Whitelist : lue par tous les membres, éditée par l'admin ; le moteur normalise, fusionne et refuse. Pour un membre hors
 * de l'entité, le moteur envoie les entrées masquées (spec 9.2) : `formatPhone` ne met en forme qu'un numéro E.164
 * entier et laisse toute autre valeur telle que reçue.
 */
export function AllowlistPanel({ botId, entries, canEdit, onChanged }: Props) {
  const t = useTranslations('agentAllowlist');
  const describe = useDescribeFailure();
  const headingId = useId();
  const reasonId = useId();
  const [local, setLocal] = useState(entries);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<{ message: string; reference: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Liste connue du moteur à la dernière lecture, et liste locale à jour pour l'effet de relecture.
  const known = useRef(entries);
  const localRef = useRef(local);
  localRef.current = local;
  // Le moteur a changé la liste alors que l'admin avait des modifications non enregistrées.
  const [outdated, setOutdated] = useState(false);

  // La page se relit après chaque changement (statut, refus, branchement) avec un nouveau tableau : la liste locale
  // n'est remplacée que si le contenu du moteur a changé ET que l'admin n'a aucune modification non enregistrée.
  useEffect(() => {
    if (sameList(entries, known.current)) return;
    const unsaved = !sameList(localRef.current, known.current);
    known.current = entries;
    if (unsaved) {
      setOutdated(true);
      return;
    }
    setLocal(entries);
    setErrors({});
    setOutdated(false);
  }, [entries]);

  const changed = !sameList(local, entries);
  const reason = draft.trim() !== '' ? t('draftPending') : !changed ? t('unchanged') : null;
  // Après un enregistrement réussi, la confirmation remplace le rappel « aucune modification ».
  const note = saved && draft.trim() === '' ? t('saved') : reason;

  async function save() {
    if (busyRef.current || reason !== null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setErrors({});
    setSaved(false);
    const result = await sendMutation(`/api/bots/${encodeURIComponent(botId)}/allowlist`, 'PUT', { entries: local }, t('failed'), 'Agent');
    busyRef.current = false;
    setBusy(false);
    if ('res' in result) {
      // Le moteur a normalisé et fusionné la liste : c'est sa version qui fait foi.
      const body = await readJsonBody<{ allowlist?: unknown }>(result.res);
      const stored = Array.isArray(body?.allowlist) && body.allowlist.every((e) => typeof e === 'string') ? (body.allowlist as string[]) : null;
      if (stored !== null) {
        known.current = stored;
        setLocal(stored);
      } else {
        // Enregistrement réussi mais réponse illisible : la liste envoyée est la liste enregistrée. La relecture de la
        // page (`onChanged`) apporte la version normalisée ; elle ne doit pas passer pour un changement fait ailleurs.
        known.current = local;
      }
      setOutdated(false);
      setSaved(true);
      onChanged();
      return;
    }
    // Organisation changée dans un autre onglet : la page se recharge, rien à afficher.
    if (result.orgChanged) return;
    const failure = describe(result, t('failed'), rowFields(local));
    const perRow = rowErrors(failure);
    if (Object.keys(perRow).length > 0) setErrors(perRow);
    else setError({ message: failure.message, reference: failure.reference });
  }

  return (
    <Card title={t('title')} labelledBy={headingId}>
      {/* spec 10.3 : qui reçoit une réponse, puis le mot-clé « reset » à part, plus petit */}
      <p className="text-[12.5px] text-muted-2">{t('lead')}</p>
      <p className="mb-3 mt-1 text-[11.5px] text-muted-2">{t('reset')}</p>
      {canEdit ? (
        <>
          <AllowlistEditor
            entries={local}
            inputId={allowlistInputId(botId)}
            errors={errors}
            disabled={busy}
            onDraftChange={(value) => {
              setDraft(value);
              // Le refus du moteur portait sur la liste envoyée : il disparaît dès que l'admin reprend la saisie.
              setError(null);
            }}
            onChange={(next) => {
              setLocal(next);
              // Les indices des erreurs affichées ne valent que pour la liste envoyée.
              setErrors({});
              setError(null);
              setSaved(false);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy || reason !== null} aria-describedby={busy || reason === null ? undefined : reasonId} className={ACTION}>
              {busy ? t('saving') : t('save')}
            </button>
            {note !== null && <p id={reasonId} role={saved ? 'status' : undefined} className={`text-[12.5px] ${saved ? 'text-success-ink' : 'text-muted'}`}>{note}</p>}
          </div>
          {outdated && <p role="status" className="mt-2 text-[12.5px] text-warning-ink">{t('outdated')}</p>}
          {error && (
            <div className="mt-2">
              <InlineError message={error.message} reference={error.reference} />
            </div>
          )}
        </>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-muted">{t('empty')}</p>
      ) : (
        <ul aria-label={t('listLabel')} className="divide-y divide-border rounded-lg border border-border">
          {entries.map((entry, index) => (
            <li key={`${index}-${entry}`} className="break-all px-3 py-2 font-mono text-[13px] text-fg">{formatPhone(entry)}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
