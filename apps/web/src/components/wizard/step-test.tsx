'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { botId: string; state: WizardState; onFinish: () => void; onBack: () => void; }
export function StepTest(_props: Props) { return <div className="mx-auto max-w-xl px-5 pb-16" />; }
