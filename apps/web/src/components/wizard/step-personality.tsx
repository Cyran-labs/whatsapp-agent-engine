'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { state: WizardState; update: (p: Partial<WizardState>) => void; createdBotId: string | null; onCreated: (id: string) => void; onBack: () => void; }
export function StepPersonality(_props: Props) {
  return <div className="mx-auto max-w-xl px-5 pb-16"><div className="rounded-xl border border-border bg-surface p-8"><h1 className="font-serif text-2xl text-fg">La personnalité de votre agent</h1></div></div>;
}
