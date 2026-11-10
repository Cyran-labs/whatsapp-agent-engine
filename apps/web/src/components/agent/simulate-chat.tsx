'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InlineError } from '@/components/feedback/inline-error';
import { useMutate } from '@/components/feedback/use-mutate';
import { readJsonBody } from '@/lib/api-fetch';

interface Msg { id: number; role: 'bot' | 'me'; text: string; /** Envoi refusé : la bulle reste, marquée « Non envoyé ». */ failed?: boolean }

interface Props {
  botId: string;
  agentName?: string;
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

  const reset = () => { setMessages(initial); setSession(undefined); setFailure(null); };

  const mark = (id: number, failed: boolean) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, failed } : x)));

  /**
   * Envoie le texte d'une bulle. Un envoi refusé ne perd rien (audit R-9) : la bulle reste, marquée « Non envoyé », avec
   * « Renvoyer », et le texte revient dans le champ s'il est vide. Un agent IA supprimé (404) le dit.
   */
  const deliver = async (id: number, text: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    mark(id, false);
    try {
      const outcome = await mutate(`/api/bots/${encodeURIComponent(botId)}/simulate`, 'POST', {
        message: text,
        use_bot_config: false,
        ...(session ? { session_id: session } : {}),
      });
      if (outcome.status === 'changed') return;
      if (outcome.status === 'refused') {
        mark(id, true);
        setInput((current) => (current === '' ? text : current));
        const gone = outcome.httpStatus === 404;
        setFailure({ message: gone ? t('gone') : outcome.failure.message, reference: gone ? null : outcome.failure.reference });
        return;
      }
      const out = await readJsonBody<{ session_id: string; reply: string }>(outcome.res);
      if (out === null || typeof out.reply !== 'string') throw new Error('réponse inattendue');
      setSession(out.session_id);
      setMessages((m) => [...m, { id: nextId.current++, role: 'bot', text: out.reply }]);
    } catch {
      console.error('[Simulator] réponse illisible');
      mark(id, true);
      setInput((current) => (current === '' ? text : current));
      setFailure({ message: t('unreadable'), reference: null });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busyRef.current) return;
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

  const displayName = agentName ?? '?';
  const initial0 = displayName !== '?' ? displayName.charAt(0).toUpperCase() : '?';

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-3 bg-brand-deep px-4 py-3 text-[#E6EFEA]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-bold text-brand-mint">{initial0}</span>
          <span className="flex-1">
            <span className="block font-semibold">{displayName}</span>
            <span className="block text-[11px] text-brand-mint">{t('online')}</span>
          </span>
          <button onClick={reset} className="text-xs text-[#B6C5BC]">↻ {t('reset')}</button>
        </div>
        <div className="flex min-h-[320px] flex-col gap-2.5 bg-surface-subtle p-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex max-w-[75%] flex-col gap-1 ${m.role === 'bot' ? 'self-start' : 'self-end'}`}>
              <div className={`rounded-xl px-3 py-2 text-sm ${m.role === 'bot' ? 'rounded-tl-sm bg-white text-fg' : `rounded-tr-sm text-fg ${m.failed ? 'border border-danger bg-danger-soft' : 'bg-success-soft'}`}`}>{m.text}</div>
              {m.failed && (
                <div className="flex items-center justify-end gap-2 text-xs text-danger">
                  <span>{t('notSent')}</span>
                  <button type="button" disabled={busy} onClick={() => resend(m)} className="font-semibold underline disabled:opacity-50">{t('resend')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border bg-surface p-3">
          <input
            className="flex-1 rounded-full border border-border px-3.5 py-2.5 text-sm focus:border-accent-ink focus:outline-none"
            placeholder={t('placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          />
          <button onClick={() => void send()} disabled={busy} className="h-10 w-10 shrink-0 rounded-full bg-accent font-bold text-accent-fg disabled:opacity-50">➤</button>
        </div>
      </div>
      {failure && (
        <div className="mt-3">
          <InlineError message={failure.message} reference={failure.reference} />
        </div>
      )}
    </>
  );
}
