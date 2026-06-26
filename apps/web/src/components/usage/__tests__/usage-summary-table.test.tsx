import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { UsageSummaryTable } from '../usage-summary-table';

const rows = [
  { bot_id: 'b1', name: 'Support', calls: 312, input_tokens: 184000, output_tokens: 39000, cost_usd: 1.84 },
  { bot_id: 'b2', name: 'Boutique', calls: 10, input_tokens: 5000, output_tokens: 1000, cost_usd: 0.1 },
];
const total = { calls: 322, input_tokens: 189000, output_tokens: 40000, cost_usd: 1.94 };
const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><UsageSummaryTable rows={rows} total={total} /></NextIntlClientProvider>);

test('une ligne par agent', () => { wrap(); expect(screen.getByText('Support')).toBeInTheDocument(); expect(screen.getByText('Boutique')).toBeInTheDocument(); });
test('ligne Total', () => { wrap(); expect(screen.getByText('Total')).toBeInTheDocument(); expect(screen.getByText(/1[.,]94/)).toBeInTheDocument(); });
