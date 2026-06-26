import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { UsageView } from '../usage-view';

const usage = {
  totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 },
  by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }],
  by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }],
};
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageView usage={usage} period={30} onPeriod={vi.fn()} /></NextIntlClientProvider>);

test('3 KPI rendus', () => { wrap(); expect(screen.getByText('Coût total')).toBeInTheDocument(); expect(screen.getByText('Tokens')).toBeInTheDocument(); expect(screen.getByText('Appels LLM')).toBeInTheDocument(); });
test('table par modèle + total', () => { wrap(); expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument(); expect(screen.getByText('Total')).toBeInTheDocument(); });
test('sélecteur de période', () => { wrap(); expect(screen.getByText('7 j')).toBeInTheDocument(); expect(screen.getByText('90 j')).toBeInTheDocument(); });
