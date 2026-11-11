'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/feedback/inline-error';
import { useMutate } from '@/components/feedback/use-mutate';
import { readJsonBody } from '@/lib/api-fetch';

/**
 * `failed` : `notSent` (envoi refusé, la bulle reste marquée « Non envoyé » et peut être renvoyée) ou `unreadable` (le moteur
 * a répondu 200 mais la réponse est illisible : le message est parti, il n'y a rien à renvoyer).
 */
interface Msg { id: number; role: 'bot' | 'me'; text: string; failed?: 'notSent' | 'unreadable' }

interface Props {
  botId: string;
  /** Nom de l'agent IA simulé, affiché en tête du fil (recette 3.2 : jamais « ? »). */
  agentName: string;
  welcome?: string;
}

interface Failure { message: string; reference: string | null }

export function SimulateChat({ botId, agentName, welcome }: Props) {
  const t = useTranslations('simulate');
  const mutate = useMutate('Simulator');
  const nextId = useRef(1);
  const initial: Msg[] = welcome ? [{ id: 0, role: 'bot', text: welcome }] : [];
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [session, setSession] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // L'agent IA n'existe plus (404) : plus rien ne peut partir, et la raison reste affichée.
  const [gone, setGone] = useState(false);
  const goneId = useId();

  const reset = () => { setMessages(initial); setSession(undefined); setFailure(null); };
  const sendBlocked = busy || gone;

  const mark = (id: number, failed: Msg['failed']) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, failed } : x)));

  /**
   * Envoie le texte d'une bulle. Un envoi refusé ne perd rien (audit R-9) : la bulle reste, marquée « Non envoyé », avec
   * « Renvoyer », et le texte revient dans le champ s'il est vide. Un agent IA supprimé (404) le dit.
   */
  const deliver = async (id: number, text: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    mark(id, undefined);
    try {
      const outcome = await mutate(`/api/bots/${encodeURIComponent(botId)}/simulate`, 'POST', {
        message: text,
        use_bot_config: false,
        ...(session ? { session_id: session } : {}),
      });
      if (outcome.status === 'changed') return;
      if (outcome.status === 'refused') {
        mark(id, 'notSent');
        const missing = outcome.httpStatus === 404;
        if (missing) setGone(true);
        else setInput((current) => (current === '' ? text : current));
        setFailure({ message: missing ? t('gone') : outcome.failure.message, reference: missing ? null : outcome.failure.reference });
        return;
      }
      const out = await readJsonBody<{ session_id: string; reply: string }>(outcome.res);
      if (out === null || typeof out.reply !== 'string') throw new Error('réponse inattendue');
      setSession(out.session_id);
      setMessages((m) => [...m, { id: nextId.current++, role: 'bot', text: out.reply }]);
    } catch {
      // Le moteur a répondu 200 : le message est parti, il ne se renvoie pas (il serait compté deux fois).
      console.error('[Simulator] réponse illisible');
      mark(id, 'unreadable');
      setFailure({ message: t('unreadable'), reference: null });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busyRef.current || gone) return;
    // Le texte d'une bulle « Non envoyé » remis dans le champ : on renvoie cette bulle, on n'en crée pas une seconde.
    const previous = [...messages].reverse().find((m) => m.failed === 'notSent' && m.text === text);
    if (previous) {
      setInput('');
      await deliver(previous.id, text);
      return;
    }
    const id = nextId.current++;
    setInput('');
    setMessages((m) => [...m, { id, role: 'me', text }]);
    await deliver(id, text);
  };

  const resend = (message: Msg) => {
    // Le texte est de nouveau dans le champ : il ne doit pas partir une deuxième fois.
    setInput((current) => (current.trim() === message.text ? '' : current));
    void deliver(message.id, message.text);
  };

  const initial0 = Array.from(agentName.trim())[0]?.toUpperCase() ?? '';

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        <div data-testid="simulate-thread-header" className="flex items-center gap-3 bg-brand-deep px-4 py-3 text-brand-on">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-bold text-brand-mint">{initial0}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold" title={agentName}>{agentName}</span>
            <span className="block text-[11px] text-brand-mint">{t('simulationTag')}</span>
          </span>
          <button onClick={reset} className="text-xs text-brand-on-2">↻ {t('reset')}</button>
        </div>
        <div className="flex min-h-[320px] flex-col gap-2.5 bg-surface-subtle p-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex max-w-[75%] flex-col gap-1 ${m.role === 'bot' ? 'self-start' : 'self-end'}`}>
              <div className={`rounded-xl px-3 py-2 text-sm ${m.role === 'bot' ? 'rounded-tl-sm border border-border bg-surface text-fg' : `rounded-tr-sm ${m.failed ? 'border border-danger bg-danger-soft text-danger-ink' : 'bg-accent-soft text-fg'}`}`}>{m.text}</div>
              {m.failed && (
                <div className="flex items-center gap-2 self-end rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger-ink">
                  <span>{m.failed === 'unreadable' ? t('unreadableReply') : t('notSent')}</span>
                  {m.failed === 'notSent' && !gone && (
                    <button type="button" disabled={busy} onClick={() => resend(m)} className="font-semibold underline disabled:opacity-50">{t('resend')}</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border bg-surface p-3">
          <input
            className="flex-1 rounded-full border border-border bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-muted focus:border-accent-ink focus:outline-none"
            placeholder={t('placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          />
          <button
            type="button"
            aria-label={t('send')}
            aria-describedby={gone ? goneId : undefined}
            onClick={() => void send()}
            disabled={sendBlocked}
            className="h-10 w-10 shrink-0 rounded-full bg-accent font-bold text-accent-fg disabled:opacity-50"
          >
            ➤
          </button>
        </div>
      </div>
      {(failure || gone) && (
        <div id={gone ? goneId : undefined} className="mt-3">
          <InlineError message={gone ? t('gone') : failure!.message} reference={gone ? null : failure!.reference} />
        </div>
      )}
    </>
  );
}
