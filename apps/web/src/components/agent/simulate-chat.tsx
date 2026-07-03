'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Msg { role: 'bot' | 'me'; text: string }

interface Props {
  botId: string;
  agentName?: string;
  welcome?: string;
}

export function SimulateChat({ botId, agentName, welcome }: Props) {
  const t = useTranslations('simulate');
  const initial: Msg[] = welcome ? [{ role: 'bot', text: welcome }] : [];
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [session, setSession] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const reset = () => { setMessages(initial); setSession(undefined); setError(false); };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(''); setError(false); setBusy(true);
    setMessages((m) => [...m, { role: 'me', text }]);
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/simulate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, use_bot_config: false, ...(session ? { session_id: session } : {}) }),
      });
      if (!res.ok) throw new Error('simulate');
      const out = await res.json() as { session_id: string; reply: string };
      setSession(out.session_id);
      setMessages((m) => [...m, { role: 'bot', text: out.reply }]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
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
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.role === 'bot' ? 'self-start rounded-tl-sm bg-white text-fg' : 'self-end rounded-tr-sm bg-success-soft text-fg'}`}>{m.text}</div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border bg-surface p-3">
          <input
            className="flex-1 rounded-full border border-border px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
            placeholder={t('placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          />
          <button onClick={() => void send()} disabled={busy} className="h-10 w-10 shrink-0 rounded-full bg-accent font-bold text-accent-fg disabled:opacity-50">➤</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{t('sendError')}</p>}
    </>
  );
}
