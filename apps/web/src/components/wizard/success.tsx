'use client';
import type { WizardState } from '@/lib/bot-draft';
interface Props { state: WizardState; onHome: () => void; onEdit: () => void; }
export function Success(_props: Props) { return <div className="mx-auto max-w-xl px-5 pb-16" />; }
