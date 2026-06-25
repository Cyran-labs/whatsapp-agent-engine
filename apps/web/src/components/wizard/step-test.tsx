'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { WizardState } from '@/lib/bot-draft';

interface Msg { role: 'bot' | 'me'; text: string }
interface Props { botId: string; state: WizardState; onFinish: () => void; onBack: () => void }

export function StepTest({ botId, state, onFinish, onBack }: Props) {
  const t = useTranslations('simulate');
  const welcome = state.welcomeEnabled ? state.welcome[state.defaultLanguage]?.trim() : '';
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

  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <div className="text-center text-xs font-semibold uppercase tracking-wider text-accent-hover">3 / 3</div>
      <h1 className="mt-1.5 text-center font-serif text-2xl text-fg">{t('title')}</h1>
      <p className="mt-1.5 mb-4 text-center text-muted">{t('lead')}</p>

      <div className="mb-4 rounded-lg border border-[#CFE3D8] bg-[#EAF2EE] px-3 py-2.5 text-center text-xs font-medium text-brand-deep">⚡ {t('freeBadge')}</div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-3 bg-brand-deep px-4 py-3 text-[#E6EFEA]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-bold text-brand-mint">{state.name.charAt(0).toUpperCase()}</span>
          <span className="flex-1"><span className="block font-semibold">{state.name}</span><span className="block text-[11px] text-brand-mint">{t('online')}</span></span>
          <button onClick={reset} className="text-xs text-[#B6C5BC]">↻ {t('reset')}</button>
        </div>
        <div className="flex min-h-[320px] flex-col gap-2.5 bg-[#E7EDE9] p-4">
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${m.role === 'bot' ? 'self-start rounded-tl-sm bg-white text-fg' : 'self-end rounded-tr-sm bg-[#DCF7E3] text-fg'}`}>{m.text}</div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border bg-surface p-3">
          <input className="flex-1 rounded-full border border-border px-3.5 py-2.5 text-sm focus:border-accent focus:outline-none"
            placeholder={t('placeholder')} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} />
          <button onClick={() => void send()} disabled={busy} className="h-10 w-10 shrink-0 rounded-full bg-accent font-bold text-accent-fg disabled:opacity-50">➤</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{t('sendError')}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="font-semibold text-muted hover:text-fg">← {t('back')}</button>
        <button onClick={onFinish} className="rounded-xl bg-success px-6 py-3 font-semibold text-white">{t('finish')} ✓</button>
      </div>
    </div>
  );
}
