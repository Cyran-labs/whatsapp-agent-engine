'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AllowlistEditor } from '@/components/numbers/allowlist-editor';
import { formatPhone } from '@/lib/whatsapp-display';
import { readJsonBody, sendMutation, type MutationFailure } from '@/lib/api-fetch';
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

function rowErrors(failure: MutationFailure): Record<number, string> {
  const perRow: Record<number, string> = {};
  for (const detail of failure.details) {
    const match = ROW_ERROR_PATH.exec(detail.path);
    if (match) perRow[Number(match[1])] = detail.message ?? failure.error;
  }
  return perRow;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((entry, i) => entry === b[i]);

/** Liste d'accès limité : lue par tous les membres, éditée par l'admin ; le moteur normalise, fusionne et refuse. */
export function AllowlistPanel({ botId, entries, canEdit, onChanged }: Props) {
  const t = useTranslations('agentAllowlist');
  const headingId = useId();
  const reasonId = useId();
  const [local, setLocal] = useState(entries);
  const [draft, setDraft] = useState('');
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
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
      }
      setOutdated(false);
      setSaved(true);
      onChanged();
      return;
    }
    // Organisation changée dans un autre onglet : la page se recharge, rien à afficher.
    if (result.orgChanged) return;
    const perRow = rowErrors(result);
    if (Object.keys(perRow).length > 0) setErrors(perRow);
    else setError(result.error);
  }

  return (
    <Card title={t('title')} labelledBy={headingId}>
      <p className="mb-3 text-[12.5px] text-muted-2">{t('lead')}</p>
      {canEdit ? (
        <>
          <AllowlistEditor
            entries={local}
            errors={errors}
            disabled={busy}
            onDraftChange={setDraft}
            onChange={(next) => {
              setLocal(next);
              // Les indices des erreurs affichées ne valent que pour la liste envoyée.
              setErrors({});
              setSaved(false);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy || reason !== null} aria-describedby={busy || reason === null ? undefined : reasonId} className={ACTION}>
              {busy ? t('saving') : t('save')}
            </button>
            {note !== null && <p id={reasonId} role={saved ? 'status' : undefined} className={`text-[12.5px] ${saved ? 'text-success-ink' : 'text-muted-2'}`}>{note}</p>}
          </div>
          {outdated && <p role="status" className="mt-2 text-[12.5px] text-warning-ink">{t('outdated')}</p>}
          {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
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
